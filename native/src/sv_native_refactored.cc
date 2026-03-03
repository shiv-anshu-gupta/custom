/**
 * @file sv_native_refactored.cc
 * @brief SV Publisher - Main Entry Point for Tauri FFI
 * 
 * This module provides the main FFI interface for the Tauri application.
 * It orchestrates the SV publishing workflow using modular components:
 * 
 *   - sv_encoder_impl.cc      - Packet encoding
 *   - npcap_transmitter_impl.cc - Network transmission
 *   - sv_stats_impl.cc        - Statistics tracking
 *   - equation_processor.cc   - Waveform generation
 * 
 * Architecture:
 *   Tauri (Rust) → FFI → This Module → Encoder → Transmitter → Network
 */

#include "../include/sv_native.h"
#include "../include/npcap_transmitter.h"
#include "../include/sv_encoder.h"
#include "../include/sv_stats.h"
#include "equation_processor.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <new>
#include <atomic>
#include <thread>
#include <mutex>
#include <chrono>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>
#pragma comment(lib, "winmm.lib")
#ifdef _MSC_VER
#include <intrin.h>  /* _mm_pause() */
#endif
#else
/* Linux / macOS */
#include <unistd.h>
#include <pthread.h>
#include <sched.h>
#endif

/*============================================================================
 * Constants
 *============================================================================*/

#define MAX_PREBUILT_FRAMES 65536 /* Upper safety limit for frame cache */

/* Send mode: controls which publisher loop to use */
#define SEND_MODE_AUTO   0  /* Auto-detect: sendqueue if available, else single */
#define SEND_MODE_QUEUE  1  /* Force SendQueue (batch mode, PCIe NICs) */
#define SEND_MODE_PACKET 2  /* Force SendPacket (immediate mode, USB adapters) */
#define SEND_MODE_USB    3  /* USB-Optimized: immediate + forced SPIN pacing + min gap */

/*============================================================================
 * Module State
 *============================================================================*/

static char g_error_buffer[512] = {0};
static std::atomic<bool> g_running{false};
static std::thread g_thread;
static std::mutex g_mutex;

/* Publisher configuration */
struct Config {
    char svID[64];
    uint16_t appID;
    uint32_t confRev;
    uint8_t smpSynch;
    uint8_t srcMAC[6];
    uint8_t dstMAC[6];
    int vlanPriority;
    int vlanID;
    uint64_t sampleRate;
    double frequency;
    double voltageAmplitude;
    double currentAmplitude;
    uint8_t asduCount;
    uint8_t channelCount;  // 1-20 (default 8)
    uint32_t durationSeconds;
    uint32_t repeatCount;
    bool repeatEnabled;
    bool repeatInfinite;
    uint8_t sendMode;  // 0=auto, 1=sendqueue, 2=sendpacket, 3=usb-optimized
    int usbPadSize;    // Pad frames to this byte size in USB mode (0 = off)
    int usbMinGapUs;   // Minimum inter-packet gap in microseconds for USB mode (0 = use default 130)
};
static Config g_config;  // Will set channelCount=8 in configure if 0

/* Duration/Repeat state */
static std::atomic<uint32_t> g_repeat_cycle{0};
static std::atomic<bool> g_duration_complete{false};
static std::atomic<uint64_t> g_start_time_ms{0};

/* Equation processor */
static EquationProcessor g_eq_processor(50.0, 4800);
static std::mutex g_eq_mutex;

/* Pre-built frame cache (dynamically allocated) */
static uint8_t** g_frames = nullptr;
static size_t* g_frame_lens = nullptr;
static int g_frame_count = 0;
static int g_frame_capacity = 0;

static void free_frame_cache() {
    if (g_frames) {
        for (int i = 0; i < g_frame_capacity; i++) {
            delete[] g_frames[i];
        }
        delete[] g_frames;
        g_frames = nullptr;
    }
    if (g_frame_lens) {
        delete[] g_frame_lens;
        g_frame_lens = nullptr;
    }
    g_frame_count = 0;
    g_frame_capacity = 0;
}

static bool alloc_frame_cache(int count) {
    free_frame_cache();
    g_frames = new (std::nothrow) uint8_t*[count];
    if (!g_frames) return false;
    g_frame_lens = new (std::nothrow) size_t[count];
    if (!g_frame_lens) { delete[] g_frames; g_frames = nullptr; return false; }
    for (int i = 0; i < count; i++) {
        g_frames[i] = new (std::nothrow) uint8_t[1500];
        if (!g_frames[i]) {
            // Cleanup on failure
            for (int j = 0; j < i; j++) delete[] g_frames[j];
            delete[] g_frames; g_frames = nullptr;
            delete[] g_frame_lens; g_frame_lens = nullptr;
            return false;
        }
    }
    g_frame_capacity = count;
    return true;
}

/* Frame inspection */
static std::atomic<uint32_t> g_current_smp_cnt{0};
static int32_t g_channel_values[SV_MAX_CHANNELS] = {0};  // Support up to 20 channels
static std::mutex g_channel_mutex;

/*============================================================================
 * Helper Functions
 *============================================================================*/

static uint64_t get_time_ms() {
    return npcap_stats_get_time_ms();
}

static bool check_duration_elapsed() {
    if (g_config.durationSeconds == 0) return false;
    
    uint64_t elapsed = get_time_ms() - g_start_time_ms.load();
    return elapsed >= (uint64_t)g_config.durationSeconds * 1000ULL;
}

/*============================================================================
 * Frame Pre-building
 *============================================================================*/

static void prebuild_frames() {
    const double PI = 3.14159265358979323846;

    /* IEC 61850-9-2 §7.2.3: smpCnt must count 0 to (sampleRate-1) per second.
     * Pre-build one full second of frames so smpCnt covers the complete range.
     * packets_per_second = sampleRate / asduCount (for single ASDU = sampleRate). */
    int packets_per_second = (int)g_config.sampleRate;
    if (g_config.asduCount > 1)
        packets_per_second = (int)(g_config.sampleRate / g_config.asduCount);
    
    if (packets_per_second > MAX_PREBUILT_FRAMES) {
        printf("[publisher] WARNING: packets_per_second %d exceeds max %d, clamping\n",
               packets_per_second, MAX_PREBUILT_FRAMES);
        packets_per_second = MAX_PREBUILT_FRAMES;
    }
    if (packets_per_second < 1) packets_per_second = 1;
    
    if (!alloc_frame_cache(packets_per_second)) {
        printf("[publisher] ERROR: Failed to allocate frame cache for %d frames (%.1f MB)\n",
               packets_per_second, (double)packets_per_second * 1500.0 / (1024.0 * 1024.0));
        g_frame_count = 0;
        return;
    }
    g_frame_count = packets_per_second;
    
    printf("[publisher] Building %d frames (1 sec, smpCnt 0-%d), %d ASDUs, %d channels\n", 
           packets_per_second, packets_per_second - 1,
           g_config.asduCount, g_config.channelCount);
    
    /* Configure encoder */
    SvEncoderConfig enc = {0};
    strncpy(enc.svID, g_config.svID, sizeof(enc.svID) - 1);
    enc.appID = g_config.appID;
    enc.confRev = g_config.confRev;
    enc.smpSynch = g_config.smpSynch;
    memcpy(enc.srcMAC, g_config.srcMAC, 6);
    memcpy(enc.dstMAC, g_config.dstMAC, 6);
    enc.vlanPriority = g_config.vlanPriority;
    enc.vlanID = g_config.vlanID;
    enc.asduCount = g_config.asduCount;
    enc.channelCount = g_config.channelCount;
    sv_encoder_set_config(&enc);
    
    /* Build frames — one per packet for the full second.
     * smpCnt = i ranges 0 to (packets_per_second - 1), e.g. 0-3999 at 4000 Hz. */
    for (int i = 0; i < packets_per_second; i++) {
        double t = (double)i / (double)g_config.sampleRate;
        int32_t samples[SV_MAX_CHANNELS] = {0};  // Support up to 20 channels
        
        {
            std::lock_guard<std::mutex> lock(g_eq_mutex);
            g_eq_processor.generate9_2LESamples(t, samples, g_config.channelCount);
        }
        
        size_t size = 1500;
        sv_encoder_encode_packet(i, samples, g_frames[i], &size);
        g_frame_lens[i] = size;
    }
    
    printf("[publisher] Frame size: %zu bytes\n", g_frame_lens[0]);
}

/*============================================================================
 * Thread Priority Helpers (Windows)
 *============================================================================*/

static inline void spin_pause() {
#if defined(_MSC_VER)
    _mm_pause();
#elif defined(__GNUC__) || defined(__clang__)
    __builtin_ia32_pause();
#endif
}

static void elevate_thread_priority() {
#ifdef _WIN32
    timeBeginPeriod(1);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
    SetThreadAffinityMask(GetCurrentThread(), 1ULL << 1);
    printf("[publisher] Thread: TIME_CRITICAL, core 1, timeBeginPeriod(1)\n");
#else
    /* Linux/macOS: set real-time FIFO scheduling (requires root/CAP_SYS_NICE) */
    struct sched_param param;
    param.sched_priority = sched_get_priority_max(SCHED_FIFO);
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &param) == 0) {
        printf("[publisher] Thread: SCHED_FIFO priority %d\n", param.sched_priority);
    } else {
        /* Fallback: try highest normal priority */
        param.sched_priority = 0;
        nice(-20);
        printf("[publisher] Thread: nice(-20) fallback (no root for SCHED_FIFO)\n");
    }
    /* Pin to core 1 if available */
#ifdef __linux__
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(1, &cpuset);
    pthread_setaffinity_np(pthread_self(), sizeof(cpuset), &cpuset);
#endif
#endif
}

static void restore_thread_priority() {
#ifdef _WIN32
    timeEndPeriod(1);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_NORMAL);
    /* Restore full CPU affinity */
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    SetThreadAffinityMask(GetCurrentThread(), (1ULL << si.dwNumberOfProcessors) - 1);
    printf("[publisher] Thread priority and affinity restored\n");
#else
    struct sched_param param;
    param.sched_priority = 0;
    pthread_setschedparam(pthread_self(), SCHED_OTHER, &param);
#ifdef __linux__
    /* Restore full CPU affinity */
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    long nprocs = sysconf(_SC_NPROCESSORS_ONLN);
    for (long i = 0; i < nprocs; i++) CPU_SET(i, &cpuset);
    pthread_setaffinity_np(pthread_self(), sizeof(cpuset), &cpuset);
#endif
    printf("[publisher] Thread priority and affinity restored\n");
#endif
}

/*============================================================================
 * Publisher Loop — Batch Mode (sendqueue)
 *
 * Two-tier strategy for maximum throughput with minimal duplicate timestamps:
 *
 * TIER 1 — PRECISE (<=4800 pps, interval >=208us)
 *   1 packet per sendqueue, sync=1.  NdisMSleep works at these intervals.
 *
 * TIER 2 — HIGH-SPEED (>4800 pps, all rates up to line-rate)
 *   sync=0 blasts each batch at wire speed (no kernel NdisMSleep).
 *   Adaptive batch size targets ~500us of wire time per burst.
 *   Userspace QPC spin-wait between batches maintains target rate
 *   and creates inter-burst gaps for receiver NIC timestamp delineation.
 *   At near-line-rate the wire itself limits throughput; smaller batches
 *   create frequent micro-gaps from queue create/fill overhead (~10-30us)
 *   giving the receiver NIC more chances to fire separate interrupts.
 *   Thread is elevated to TIME_CRITICAL with CPU affinity to minimize jitter.
 *============================================================================*/

static void publisher_loop_batch() {
    printf("[publisher] Starting batch mode (sendqueue)\n");

batch_repeat_start:
    elevate_thread_priority();
    prebuild_frames();
    
    if (g_frame_count == 0) {
        printf("[publisher] ERROR: No frames built, aborting\n");
        restore_thread_priority();
        g_running.store(false);
        return;
    }
    
    npcap_stats_reset();
    npcap_stats_session_start();
    
    size_t frame_len = g_frame_lens[0];
    uint64_t total_packets = 0;
    
    /* Calculate timing parameters */
    uint64_t packets_per_sec = g_config.sampleRate / g_config.asduCount;
    double interval_us = (g_config.asduCount * 1000000.0) / (double)g_config.sampleRate;
    double expected_mbps = (double)packets_per_sec * frame_len * 8.0 / 1e6;
    
    /* Wire time per frame at 1 Gbps (frame + preamble/SFD/IFG = +20 bytes) */
    double wire_time_us = (double)(frame_len + 20) * 8.0 / 1000.0;
    
    printf("[publisher] Target: %llu pps, %.2f Mbps, interval %.2f us, wire %.2f us\n",
           (unsigned long long)packets_per_sec, expected_mbps, interval_us, wire_time_us);
    
    /* Persistent frame index across batches so smpCnt cycles through all frames */
    uint64_t frame_idx = 0;
    
    /*----------------------------------------------------------------------
     * TIER 1 — PRECISE: ≤4800 pps  (standard IEC 61850-9-2 rate)
     *   1 pkt/queue, sync=1.  NdisMSleep precision is adequate because
     *   the interval (≥208µs) is well above its ~15µs granularity.
     *----------------------------------------------------------------------*/
    if (packets_per_sec <= 4800) {
        printf("[publisher] Mode: PRECISE (1 pkt/queue, sync=1)\n");
        unsigned int queue_size = (unsigned int)(1 * (frame_len + 24) + 4096);
        uint64_t ts_accum = 0;
        
        while (g_running.load() && !check_duration_elapsed()) {
            void* queue = npcap_queue_create(queue_size);
            if (!queue) { std::this_thread::sleep_for(std::chrono::milliseconds(1)); continue; }
            
            npcap_queue_add(queue, g_frames[frame_idx % g_frame_count], frame_len, ts_accum);
            frame_idx++;
            ts_accum += (uint64_t)interval_us;
            
            unsigned int sent = npcap_queue_transmit(queue, 1);
            if (sent > 0) {
                total_packets++;
                npcap_stats_record_packet(frame_len);
            }
            npcap_queue_destroy(queue);
        }
    }
    /*----------------------------------------------------------------------
     * TIER 2 — HIGH-SPEED: >4800 pps (all rates up to line-rate)
     *
     *   sync=0 blasts each batch at wire speed (no NdisMSleep).
     *   Adaptive batch sizing targets ~500us of wire time:
     *     - Amortizes per-queue syscall overhead
     *     - Creates ~10-30us natural gaps from queue create/fill overhead
     *     - Gives receiver NIC time to raise interrupts between bursts
     *
     *   Userspace QPC spin-wait between batches maintains target rate.
     *   At near-line-rate (wire_util > 90%), spin-wait exits instantly
     *   and the wire itself is the rate limiter.  Throughput stays at
     *   maximum while the frequent micro-gaps from smaller batches
     *   minimize duplicate timestamps at the receiver.
     *----------------------------------------------------------------------*/
    else {
        /* Adaptive batch: target ~500us of wire time per burst.
         * Small enough for frequent micro-gaps, large enough to
         * amortize syscall overhead. */
        uint64_t batch = (uint64_t)(500.0 / wire_time_us);
        if (batch < 50) batch = 50;
        if (batch > 5000) batch = 5000;
        
        double batch_wire_us = batch * wire_time_us;
        double batch_target_us = batch * interval_us;
        bool wire_limited = (batch_target_us < batch_wire_us * 1.05);
        
        auto batch_duration = std::chrono::nanoseconds((int64_t)(batch_target_us * 1000.0));
        
        printf("[publisher] Mode: HIGH-SPEED (batch=%llu, sync=0%s)\n",
               (unsigned long long)batch,
               wire_limited ? ", wire-speed limited" : " + QPC pacing");
        printf("[publisher] batch_wire: %.0f us, target: %.0f us, util: %.0f%%\n",
               batch_wire_us, batch_target_us, expected_mbps / 10.0);
        
        if (wire_limited) {
            printf("[publisher] NOTE: Target %.0f Mbps saturates the link.\n", expected_mbps);
            printf("[publisher]       Micro-gaps from queue fill overhead (~10-30us)\n");
            printf("[publisher]       provide timestamp breaks at the receiver.\n");
        }
        
        unsigned int queue_size = (unsigned int)(batch * (frame_len + 24) + 4096);
        auto next_batch = std::chrono::high_resolution_clock::now();
        uint64_t batch_count = 0;
        
        while (g_running.load() && !check_duration_elapsed()) {
            void* queue = npcap_queue_create(queue_size);
            if (!queue) { std::this_thread::sleep_for(std::chrono::milliseconds(1)); continue; }
            
            for (uint64_t i = 0; i < batch; i++) {
                npcap_queue_add(queue, g_frames[frame_idx % g_frame_count], frame_len, 0);
                frame_idx++;
            }
            
            /* sync=0: blast batch at wire speed — no kernel pacing */
            unsigned int sent = npcap_queue_transmit(queue, 0);
            if (sent > 0) {
                uint32_t pkts = sent / (uint32_t)frame_len;
                total_packets += pkts;
                for (uint32_t i = 0; i < pkts; i++) npcap_stats_record_packet(frame_len);
            }
            npcap_queue_destroy(queue);
            
            /* QPC spin-wait: paces batches when target < wire speed.
             * At wire-saturated rates, next_batch falls behind so the
             * spin exits instantly — zero overhead, max throughput.
             * _mm_pause() reduces CPU power while spinning. */
            next_batch += batch_duration;
            while (std::chrono::high_resolution_clock::now() < next_batch) {
                spin_pause();
            }
            
            /* Re-anchor every 200 batches to prevent cumulative drift */
            batch_count++;
            if ((batch_count % 200) == 0) {
                next_batch = std::chrono::high_resolution_clock::now();
            }
        }
    }
    
    restore_thread_priority();
    
    /* Handle repeat — use ITERATIVE loop, not recursion.
     * Recursion would stack frames on every cycle and eventually
     * overflow the thread stack (STATUS_STACK_BUFFER_OVERRUN). */
    if (check_duration_elapsed() && g_config.repeatEnabled) {
        g_repeat_cycle.fetch_add(1);
        uint32_t cycle = g_repeat_cycle.load();
        
        if (g_config.repeatInfinite || cycle < g_config.repeatCount) {
            printf("[publisher] Repeat cycle %u\n", cycle + 1);
            g_start_time_ms.store(get_time_ms());
            g_duration_complete.store(false);
            goto batch_repeat_start;  /* iterate, don't recurse */
        }
    }
    
    npcap_stats_session_end();
    
    if (check_duration_elapsed()) {
        g_duration_complete.store(true);
        g_running.store(false);
    }
    
    printf("[publisher] Complete: %llu packets\n", (unsigned long long)total_packets);
}

/*============================================================================
 * Publisher Loop — Send Immediate (USB Adapter Friendly)
 *
 * Uses pcap_sendpacket for each individual packet.
 * Optimized for USB Ethernet adapters:
 *   - pcap_set_immediate_mode(1) disables driver buffering (in npcap_open)
 *   - TIME_CRITICAL thread prevents OS preemption during inter-packet gaps
 *   - timeBeginPeriod(1) gives 1ms sleep resolution for hybrid pacing
 *   - CPU affinity pins thread to avoid cross-core migration jitter
 *   - _mm_pause() spin-wait for sub-us precision without wasting power
 *
 * Pacing modes:
 *   - Low rates  (<=4800 pps): hybrid sleep + _mm_pause spin
 *   - Med rates  (<=50000 pps): pure _mm_pause spin loop
 *   - High rates (>50000 pps): no pacing, max throughput
 *
 * At 4800 Hz (208us interval) with USB 2.0 (125us microframe):
 *   Each packet lands in a separate USB microframe -> distinct timestamps.
 *============================================================================*/

static void publisher_loop_immediate() {
    printf("[publisher] Starting SEND-IMMEDIATE mode (pcap_sendpacket per packet)\n");
    
immediate_repeat_start:
    elevate_thread_priority();
    
    prebuild_frames();
    if (g_frame_count == 0) {
        printf("[publisher] ERROR: No frames built, aborting\n");
        restore_thread_priority();
        g_running.store(false);
        return;
    }
    
    npcap_stats_reset();
    npcap_stats_session_start();
    
    uint64_t total_packets = 0;
    uint64_t total_failures = 0;
    
    /* Calculate timing parameters */
    uint64_t packets_per_sec = g_config.sampleRate / g_config.asduCount;
    double interval_us = (g_config.asduCount * 1000000.0) / (double)g_config.sampleRate;
    double expected_mbps = (double)packets_per_sec * g_frame_lens[0] * 8.0 / 1e6;
    
    /* Choose pacing strategy */
    enum PacingMode { PACING_SLEEP, PACING_SPIN, PACING_NONE };
    PacingMode pacing;
    
    bool usbMode = (g_config.sendMode == SEND_MODE_USB);
    int usbPadSize = g_config.usbPadSize;
    int usbGapUs = (g_config.usbMinGapUs > 0) ? g_config.usbMinGapUs : 130;

    if (usbMode) {
        pacing = PACING_SPIN;
        printf("[publisher] Pacing: USB-OPTIMIZED (forced SPIN + %d us gap)\n", usbGapUs);
        if (usbPadSize > 0)
            printf("[publisher] USB frame padding: %d bytes\n", usbPadSize);
    } else if (packets_per_sec <= 4800) {
        pacing = PACING_SLEEP;
        printf("[publisher] Pacing: SLEEP+SPIN hybrid (low rate, USB friendly)\n");
    } else if (packets_per_sec <= 50000) {
        pacing = PACING_SPIN;
        printf("[publisher] Pacing: SPIN _mm_pause (medium rate, high precision)\n");
    } else {
        pacing = PACING_NONE;
        printf("[publisher] Pacing: NONE (max throughput)\n");
    }
    
    printf("[publisher] Target: %llu pps, %.2f Mbps, interval %.2f us\n",
           (unsigned long long)packets_per_sec, expected_mbps, interval_us);
    
    /* Persistent frame index cycles through pre-built cache */
    uint64_t frame_idx = 0;
    auto interval_dur = std::chrono::nanoseconds((int64_t)(interval_us * 1000.0));
    
    /* Epoch-based absolute scheduling (industry standard).
     *
     * target[N] = epoch + N * interval
     *
     * This ensures the average packet rate is EXACTLY correct regardless
     * of how long each pcap_sendpacket() call takes.
     *
     * If pcap_sendpacket takes longer than the interval, we fall behind
     * schedule. To handle this:
     *   - Small lag: send next packet immediately (natural catch-up)
     *   - Large lag (>3 intervals behind): re-anchor epoch to prevent
     *     unbounded bursts of back-to-back packets
     *
     * This is the same approach used by tcpreplay, Linux pktgen, and
     * professional traffic generators (DPDK TRex, MoonGen, etc.).
     */
    auto epoch = std::chrono::high_resolution_clock::now();
    uint64_t pkt_num = 0;
    
    while (g_running.load() && !check_duration_elapsed()) {
        /* Send packet immediately */
        int idx = (int)(frame_idx % g_frame_count);
        int result;
        if (usbMode && usbPadSize > 0 && usbPadSize > (int)g_frame_lens[idx]) {
            result = npcap_send_packet_padded(g_frames[idx], g_frame_lens[idx], (size_t)usbPadSize);
        } else {
            result = npcap_send_packet(g_frames[idx], g_frame_lens[idx]);
        }
        
        if (result == 0) {
            total_packets++;
            npcap_stats_record_packet(g_frame_lens[idx]);
        } else {
            total_failures++;
            npcap_stats_record_failure();
        }
        
        frame_idx++;
        pkt_num++;
        
        if (pacing == PACING_NONE)
            continue;
        
        /* Absolute target for the NEXT packet */
        auto target = epoch + pkt_num * interval_dur;
        auto now    = std::chrono::high_resolution_clock::now();
        
        if (target <= now) {
            /* Behind schedule — check how far */
            auto behind = std::chrono::duration_cast<
                std::chrono::nanoseconds>(now - target);
            if (behind > interval_dur) {
                /* Behind by >1 interval — re-anchor to prevent burst.
                 * Allows at most 1 catch-up packet (small lag < 1 interval)
                 * but prevents back-to-back bursts of 3-4 packets that
                 * appear as 0.000000 deltas in Wireshark. */
                epoch   = now;
                pkt_num = 0;
            }

            /* USB mode: even when behind, enforce minimum gap between
             * sends so the USB host controller doesn't batch packets
             * into the same microframe (125µs). Configurable gap. */
            if (usbMode) {
                auto minTarget = now + std::chrono::microseconds(usbGapUs);
                while (std::chrono::high_resolution_clock::now() < minTarget)
                    spin_pause();
            }
            continue;
        }
        
        /* Ahead of schedule — pace to exact target */
        switch (pacing) {
            case PACING_SLEEP: {
                auto remaining = std::chrono::duration_cast<
                    std::chrono::microseconds>(target - now);
                if (remaining.count() > 80) {
                    std::this_thread::sleep_for(
                        remaining - std::chrono::microseconds(80));
                }
                while (std::chrono::high_resolution_clock::now() < target) {
                    spin_pause();
                }
                break;
            }
            case PACING_SPIN:
                while (std::chrono::high_resolution_clock::now() < target) {
                    spin_pause();
                }
                break;
            default:
                break;
        }
    }
    
    restore_thread_priority();
    
    /* Handle repeat — use ITERATIVE loop, not recursion.
     * Recursion would stack frames on every cycle and eventually
     * overflow the thread stack (STATUS_STACK_BUFFER_OVERRUN). */
    if (check_duration_elapsed() && g_config.repeatEnabled) {
        g_repeat_cycle.fetch_add(1);
        uint32_t cycle = g_repeat_cycle.load();
        
        if (g_config.repeatInfinite || cycle < g_config.repeatCount) {
            printf("[publisher] Repeat cycle %u\n", cycle + 1);
            g_start_time_ms.store(get_time_ms());
            g_duration_complete.store(false);
            goto immediate_repeat_start;  /* iterate, don't recurse */
        }
    }
    
    npcap_stats_session_end();
    
    if (check_duration_elapsed()) {
        g_duration_complete.store(true);
        g_running.store(false);
    }
    
    printf("[publisher] Complete: %llu sent, %llu failed\n", 
           (unsigned long long)total_packets, (unsigned long long)total_failures);
}

static void publisher_loop_single() {
    printf("[publisher] Starting single-packet mode\n");
    
    npcap_stats_reset();
    npcap_stats_session_start();
    
    SvEncoderConfig enc = {0};
    strncpy(enc.svID, g_config.svID, sizeof(enc.svID) - 1);
    enc.appID = g_config.appID;
    enc.confRev = g_config.confRev;
    enc.smpSynch = g_config.smpSynch;
    memcpy(enc.srcMAC, g_config.srcMAC, 6);
    memcpy(enc.dstMAC, g_config.dstMAC, 6);
    enc.vlanPriority = g_config.vlanPriority;
    enc.vlanID = g_config.vlanID;
    enc.asduCount = 1;
    enc.channelCount = g_config.channelCount;
    sv_encoder_set_config(&enc);
    
    uint32_t smpCnt = 0;
    int samples_per_cycle = (int)(g_config.sampleRate / g_config.frequency);
    if (samples_per_cycle < 1) samples_per_cycle = 1;
    double interval_us = 1000000.0 / g_config.sampleRate;
    auto lastTime = std::chrono::high_resolution_clock::now();
    uint8_t packet[1500];
    
    while (g_running.load() && !check_duration_elapsed()) {
        double t = (double)smpCnt / (double)g_config.sampleRate;
        int32_t samples[SV_MAX_CHANNELS] = {0};  // Support up to 20 channels
        
        {
            std::lock_guard<std::mutex> lock(g_eq_mutex);
            g_eq_processor.generate9_2LESamples(t, samples, g_config.channelCount);
        }
        
        size_t size = sizeof(packet);
        sv_encoder_encode_packet(smpCnt % (uint32_t)g_config.sampleRate, samples, packet, &size);
        
        if (npcap_send_packet(packet, size) == 0) {
            npcap_stats_record_packet(size);
        } else {
            npcap_stats_record_failure();
        }
        
        smpCnt++;
        
        auto target = lastTime + std::chrono::microseconds((int64_t)interval_us);
        while (std::chrono::high_resolution_clock::now() < target) std::this_thread::yield();
        lastTime = target;
    }
    
    npcap_stats_session_end();
    
    if (check_duration_elapsed()) {
        g_duration_complete.store(true);
        g_running.store(false);
    }
}

/*============================================================================
 * FFI Exports
 *============================================================================*/

extern "C" {

const char* sv_get_last_error(void) {
    return g_error_buffer;
}

int npcap_publisher_configure(
    const char* svID, uint16_t appID, uint32_t confRev, uint8_t smpSynch,
    const uint8_t* srcMAC, const uint8_t* dstMAC,
    int vlanPriority, int vlanID,
    uint64_t sampleRate, double frequency,
    double voltageAmplitude, double currentAmplitude,
    uint8_t asduCount,
    uint8_t channelCount
) {
    printf("[publisher] Configure: svID=%s, rate=%llu Hz, channels=%d\n", svID, (unsigned long long)sampleRate, channelCount);
    
    std::lock_guard<std::mutex> lock(g_mutex);
    
    memset(g_config.svID, 0, sizeof(g_config.svID));
    if (svID && strlen(svID) > 0) {
        strncpy(g_config.svID, svID, sizeof(g_config.svID) - 1);
    } else {
        strncpy(g_config.svID, "MU01", sizeof(g_config.svID) - 1);
    }
    
    g_config.appID = appID;
    g_config.confRev = confRev;
    g_config.smpSynch = smpSynch;
    memcpy(g_config.srcMAC, srcMAC, 6);
    memcpy(g_config.dstMAC, dstMAC, 6);
    g_config.vlanPriority = vlanPriority;
    g_config.vlanID = vlanID;
    g_config.sampleRate = sampleRate;
    g_config.frequency = frequency;
    g_config.voltageAmplitude = voltageAmplitude;
    g_config.currentAmplitude = currentAmplitude;
    g_config.asduCount = (asduCount == 1 || asduCount == 4 || asduCount == 8) ? asduCount : 1;
    g_config.channelCount = (channelCount >= 1 && channelCount <= SV_MAX_CHANNELS) ? channelCount : 8;
    
    g_eq_processor.setDefaultFrequency(frequency);
    g_eq_processor.setSampleRate((uint32_t)sampleRate);
    
    return 0;
}

/* Forward declaration: multi-publisher running check (sv_controller.cc) */
extern "C" int sv_mp_is_running(void);

int npcap_publisher_start(void) {
    if (!npcap_is_open()) {
        snprintf(g_error_buffer, sizeof(g_error_buffer), "No interface open");
        return -1;
    }
    
    if (g_running.load()) return 0;

    if (sv_mp_is_running()) {
        snprintf(g_error_buffer, sizeof(g_error_buffer),
                 "Multi-publisher is already running. Stop it before using single-publisher.");
        return -1;
    }

    /* Safety: join any leftover thread from a previous session that ended
     * naturally (duration elapsed).  Without this, assigning a new thread
     * to g_thread crashes (std::terminate on joinable thread). */
    if (g_thread.joinable()) {
        printf("[publisher] Joining leftover thread before restart\n");
        g_thread.join();
    }
    
    g_start_time_ms.store(get_time_ms());
    g_duration_complete.store(false);
    g_running.store(true);
    
    /* Dispatch based on configured send mode */
    switch (g_config.sendMode) {
        case SEND_MODE_QUEUE:
            /* Force SendQueue (batch) mode */
            if (npcap_sendqueue_available()) {
                printf("[publisher] Mode: FORCED SendQueue (batch)\n");
                g_thread = std::thread(publisher_loop_batch);
            } else {
                printf("[publisher] WARNING: SendQueue requested but not available, falling back to single\n");
                g_thread = std::thread(publisher_loop_single);
            }
            break;
            
        case SEND_MODE_PACKET:
            /* Force SendPacket (immediate) mode */
            printf("[publisher] Mode: FORCED SendPacket (immediate)\n");
            g_thread = std::thread(publisher_loop_immediate);
            break;

        case SEND_MODE_USB:
            /* USB-Optimized: immediate + forced SPIN + minimum gap */
            printf("[publisher] Mode: USB-OPTIMIZED (spin pacing + min gap)\n");
            g_thread = std::thread(publisher_loop_immediate);
            break;
            
        case SEND_MODE_AUTO:
        default:
            /* Auto-detect: use SendQueue if available, else fall back to single */
            if (npcap_sendqueue_available()) {
                printf("[publisher] Mode: AUTO -> SendQueue (batch)\n");
                g_thread = std::thread(publisher_loop_batch);
            } else {
                printf("[publisher] Mode: AUTO -> single (no sendqueue)\n");
                g_thread = std::thread(publisher_loop_single);
            }
            break;
    }
    
    return 0;
}

int npcap_publisher_stop(void) {
    g_running.store(false);
    
    /* ALWAYS join if joinable — even if g_running was already false
     * (e.g., duration elapsed and the loop ended naturally). */
    if (g_thread.joinable()) g_thread.join();
    
    free_frame_cache();
    
    return 0;
}

int npcap_publisher_is_running(void) {
    return g_running.load() ? 1 : 0;
}

int npcap_set_duration_mode(uint32_t durationSeconds, int repeatEnabled, int repeatInfinite, uint32_t repeatCount) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    g_config.durationSeconds = durationSeconds;
    g_config.repeatEnabled = (repeatEnabled != 0);
    g_config.repeatInfinite = (repeatInfinite != 0);
    g_config.repeatCount = repeatCount;
    g_repeat_cycle.store(0);
    
    return 0;
}

uint32_t npcap_get_remaining_seconds(void) {
    if (g_config.durationSeconds == 0 || !g_running.load()) return g_config.durationSeconds;
    
    uint64_t elapsed = get_time_ms() - g_start_time_ms.load();
    uint64_t duration = (uint64_t)g_config.durationSeconds * 1000ULL;
    
    return (elapsed >= duration) ? 0 : (uint32_t)((duration - elapsed) / 1000);
}

uint32_t npcap_get_current_repeat_cycle(void) {
    return g_repeat_cycle.load();
}

int npcap_is_duration_complete(void) {
    return g_duration_complete.load() ? 1 : 0;
}

int npcap_set_equations(const char* equations) {
    if (!equations) {
        snprintf(g_error_buffer, sizeof(g_error_buffer), "Null equations");
        return -1;
    }
    
    g_eq_processor.setDefaultFrequency(g_config.frequency);
    g_eq_processor.setSampleRate((uint32_t)g_config.sampleRate);
    
    std::lock_guard<std::mutex> lock(g_eq_mutex);
    return (g_eq_processor.loadEquations(equations) < 0) ? -1 : 0;
}

int npcap_get_sample_frame(uint8_t* outBuffer, size_t bufferSize, size_t* outFrameSize, uint32_t smpCnt) {
    if (!outBuffer || !outFrameSize || bufferSize < 64) return -1;
    
    SvEncoderConfig enc;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        strncpy(enc.svID, g_config.svID, sizeof(enc.svID) - 1);
        enc.appID = g_config.appID;
        enc.confRev = g_config.confRev;
        enc.smpSynch = g_config.smpSynch;
        memcpy(enc.srcMAC, g_config.srcMAC, 6);
        memcpy(enc.dstMAC, g_config.dstMAC, 6);
        enc.vlanPriority = g_config.vlanPriority;
        enc.vlanID = g_config.vlanID;
        enc.asduCount = 1;
        enc.channelCount = g_config.channelCount;
    }
    sv_encoder_set_config(&enc);
    
    int32_t samples[SV_MAX_CHANNELS] = {0};  // Support up to 20 channels
    double t = (double)smpCnt / (double)g_config.sampleRate;
    {
        std::lock_guard<std::mutex> lock(g_eq_mutex);
        g_eq_processor.generate9_2LESamples(t, samples, g_config.channelCount);
    }
    
    *outFrameSize = bufferSize;
    int result = sv_encoder_encode_packet(smpCnt, samples, outBuffer, outFrameSize);
    
    g_current_smp_cnt.store(smpCnt);
    {
        std::lock_guard<std::mutex> lock(g_channel_mutex);
        memcpy(g_channel_values, samples, g_config.channelCount * sizeof(int32_t));
    }
    
    return result;
}

int npcap_get_current_channel_values(int32_t* outValues) {
    if (!outValues) return -1;
    
    std::lock_guard<std::mutex> lock(g_channel_mutex);
    memcpy(outValues, g_channel_values, g_config.channelCount * sizeof(int32_t));
    return (int)g_config.channelCount;  // Return channel count
}

uint32_t npcap_get_current_smp_cnt(void) {
    return g_current_smp_cnt.load();
}

int npcap_set_send_mode(int mode) {
    if (mode < 0 || mode > 3) {
        snprintf(g_error_buffer, sizeof(g_error_buffer), "Invalid send mode: %d (0=auto, 1=queue, 2=packet, 3=usb)", mode);
        return -1;
    }
    
    if (g_running.load()) {
        snprintf(g_error_buffer, sizeof(g_error_buffer), "Cannot change send mode while publishing");
        return -1;
    }
    
    std::lock_guard<std::mutex> lock(g_mutex);
    g_config.sendMode = (uint8_t)mode;
    
    const char* mode_names[] = { "AUTO", "SendQueue (batch)", "SendPacket (immediate)", "USB-Optimized (spin+gap)" };
    printf("[publisher] Send mode set to: %s (%d)\n", mode_names[mode], mode);
    
    return 0;
}

int npcap_get_send_mode(void) {
    return (int)g_config.sendMode;
}

void npcap_set_usb_pad_size(int bytes) {
    g_config.usbPadSize = (bytes >= 0 && bytes <= 1522) ? bytes : 0;
    printf("[publisher] USB pad size set to %d bytes\n", g_config.usbPadSize);
}

int npcap_get_usb_pad_size(void) {
    return g_config.usbPadSize;
}

void npcap_set_usb_min_gap_us(int us) {
    g_config.usbMinGapUs = (us >= 0 && us <= 5000) ? us : 0;
    printf("[publisher] USB min gap set to %d us\n", g_config.usbMinGapUs);
}

int npcap_get_usb_min_gap_us(void) {
    return g_config.usbMinGapUs;
}

} /* extern "C" */
