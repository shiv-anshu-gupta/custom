/**
 * @file sv_stats_impl.cc
 * @brief Transmission Statistics Tracker
 * 
 * Thread-safe statistics tracking for SV packet transmission.
 * Hot-path counters use relaxed atomics (no mutex, no cache-line contention).
 * Derived fields (avg_packet_size, last_packet_ms) computed lazily on poll.
 */

#include "../include/sv_stats.h"
#include <cstdio>
#include <cstring>
#include <mutex>
#include <chrono>
#include <atomic>

/*============================================================================
 * Module State
 *============================================================================*/

/* Hot-path atomic counters — written by transmit thread, read by poll */
static std::atomic<uint64_t> g_packets_sent{0};
static std::atomic<uint64_t> g_bytes_sent{0};
static std::atomic<uint64_t> g_rate_packets{0};
static std::atomic<uint64_t> g_rate_bytes{0};
static std::atomic<uint64_t> g_packets_failed{0};

/* Cold-path state — mutex-protected, touched only on session start/end/poll */
static TransmitStats g_stats = {0};
static std::mutex g_mutex;

/*============================================================================
 * Time Helper
 *============================================================================*/

uint64_t npcap_stats_get_time_ms(void) {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

/*============================================================================
 * Statistics API
 *============================================================================*/

extern "C" {

void npcap_stats_reset(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_packets_sent.store(0, std::memory_order_relaxed);
    g_bytes_sent.store(0, std::memory_order_relaxed);
    g_rate_packets.store(0, std::memory_order_relaxed);
    g_rate_bytes.store(0, std::memory_order_relaxed);
    g_packets_failed.store(0, std::memory_order_relaxed);
    memset(&g_stats, 0, sizeof(g_stats));
}

void npcap_stats_session_start(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    g_stats.session_start_ms = npcap_stats_get_time_ms();
    g_stats.session_end_ms = 0;
    g_stats.rate_window_start_ms = g_stats.session_start_ms;
    g_rate_bytes.store(0, std::memory_order_relaxed);
    g_rate_packets.store(0, std::memory_order_relaxed);
    g_stats.session_active = 1;
}

void npcap_stats_session_end(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    g_stats.session_end_ms = npcap_stats_get_time_ms();
    g_stats.last_packet_ms = g_stats.session_end_ms;
    g_stats.session_active = 0;
}

void npcap_stats_update_rates(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    uint64_t now = npcap_stats_get_time_ms();
    uint64_t elapsed = now - g_stats.rate_window_start_ms;
    
    /* Update every 250ms */
    if (elapsed >= 250) {
        /* Atomically read and reset rate counters */
        uint64_t rp = g_rate_packets.exchange(0, std::memory_order_relaxed);
        uint64_t rb = g_rate_bytes.exchange(0, std::memory_order_relaxed);
        
        double seconds = elapsed / 1000.0;
        if (seconds > 0) {
            g_stats.current_bps = (rb * 8.0) / seconds;
            g_stats.current_pps = rp / seconds;
            
            if (g_stats.current_bps > g_stats.peak_bps) g_stats.peak_bps = g_stats.current_bps;
            if (g_stats.current_pps > g_stats.peak_pps) g_stats.peak_pps = g_stats.current_pps;
        }
        
        g_stats.rate_window_start_ms = now;
    }
}

void npcap_stats_get(TransmitStats* stats) {
    std::lock_guard<std::mutex> lock(g_mutex);
    memcpy(stats, &g_stats, sizeof(TransmitStats));
    
    /* Snapshot hot counters into output */
    uint64_t pkts = g_packets_sent.load(std::memory_order_relaxed);
    uint64_t bytes = g_bytes_sent.load(std::memory_order_relaxed);
    stats->packets_sent = pkts;
    stats->bytes_sent = bytes;
    stats->packets_failed = g_packets_failed.load(std::memory_order_relaxed);
    stats->rate_packets_sent = g_rate_packets.load(std::memory_order_relaxed);
    stats->rate_bytes_sent = g_rate_bytes.load(std::memory_order_relaxed);
    
    /* Compute derived fields lazily (only on poll, not per-packet) */
    if (pkts > 0) {
        stats->avg_packet_size = (double)bytes / pkts;
    }
    if (g_stats.session_active) {
        stats->last_packet_ms = npcap_stats_get_time_ms();
    }
}

uint64_t npcap_stats_get_duration_ms(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    if (g_stats.session_start_ms == 0) return 0;
    
    if (g_stats.session_active) {
        return npcap_stats_get_time_ms() - g_stats.session_start_ms;
    }
    if (g_stats.session_end_ms > 0) {
        return g_stats.session_end_ms - g_stats.session_start_ms;
    }
    return 0;
}

void npcap_stats_format_rate(double bps, char* buf, size_t buflen) {
    if (bps >= 1e9)      snprintf(buf, buflen, "%.2f Gbps", bps / 1e9);
    else if (bps >= 1e6) snprintf(buf, buflen, "%.2f Mbps", bps / 1e6);
    else if (bps >= 1e3) snprintf(buf, buflen, "%.2f Kbps", bps / 1e3);
    else                 snprintf(buf, buflen, "%.0f bps", bps);
}

void npcap_stats_record_packet(size_t bytes) {
    /* Relaxed atomics only — no mutex, no clock read, no division */
    g_packets_sent.fetch_add(1, std::memory_order_relaxed);
    g_bytes_sent.fetch_add(bytes, std::memory_order_relaxed);
    g_rate_packets.fetch_add(1, std::memory_order_relaxed);
    g_rate_bytes.fetch_add(bytes, std::memory_order_relaxed);
}

void npcap_stats_record_failure(void) {
    g_packets_failed.fetch_add(1, std::memory_order_relaxed);
}

} /* extern "C" */
