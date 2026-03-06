/**
 * @file sv_controller.h
 * @brief Main Controller + SharedBuffer for Multi-Publisher SV System
 *
 * Architecture:
 *
 *   SvController (Main Class)
 *       │
 *       ├── creates SvPublisherInstance 1  ──→  Internal Buffer 1
 *       ├── creates SvPublisherInstance 2  ──→  Internal Buffer 2
 *       └── creates SvPublisherInstance N  ──→  Internal Buffer N
 *                                                      │
 *                              ┌───────────────────────┘
 *                              ▼
 *                     SharedBuffer (merged schedule)
 *                     Sorted by timestamp, interleaved
 *                              │
 *                              ▼
 *                     Writer Thread (single)
 *                     TIME_CRITICAL priority
 *                     pcap_sendpacket / sendqueue
 *                              │
 *                              ▼
 *                         Network / NIC
 *
 * ## SharedBuffer
 * The SharedBuffer merges all publishers' internal buffers into a single
 * time-ordered interleaved schedule. Each entry points directly into the
 * publisher's pre-built frame cache (zero copy).
 *
 * This serves the same architectural role as SharedRingBuffer (teammate's
 * implementation), but optimized for the pre-built SV use case:
 *   - No Boost dependency
 *   - No locking at runtime (schedule is immutable once built)
 *   - Zero-copy (pointers into publishers' frame caches)
 *   - Timestamp-ordered (sorted during build)
 *
 * @note When SharedRingBuffer with Boost.Interprocess is available, the
 *       SharedBuffer can be replaced without changing the rest of the
 *       architecture.
 */

#ifndef SV_CONTROLLER_H
#define SV_CONTROLLER_H

#include "sv_publisher_instance.h"
#include "npcap_transmitter.h"
#include "sv_stats.h"

#include <vector>
#include <memory>
#include <thread>
#include <atomic>
#include <mutex>
#include <algorithm>
#include <cstdio>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>
#pragma comment(lib, "winmm.lib")
#ifdef _MSC_VER
#include <intrin.h>
#endif
#else
#include <sched.h>
#endif

/*============================================================================
 * ScheduleEntry — one slot in the shared buffer
 *============================================================================*/

struct ScheduleEntry {
    uint64_t timestamp_us;   /* When to transmit (relative to cycle start) */
    uint8_t* framePtr;       /* Direct pointer into publisher's frame cache */
    uint16_t frameLen;       /* Frame length in bytes */
    uint32_t publisherId;    /* Which publisher owns this frame */
};

/*============================================================================
 * SharedBuffer — merged interleaved schedule from all publishers
 *
 * This is the "shared buffer" in the architecture:
 *   Publisher internal buffers ──→ SharedBuffer ──→ npcap writer
 *============================================================================*/

class SharedBuffer {
public:
    void clear();

    /**
     * Build the interleaved schedule from all publishers.
     * Merges frames from every READY publisher, sorted by timestamp.
     * Publishers are staggered so their packets interleave evenly.
     */
    void buildFromPublishers(
        const std::vector<std::unique_ptr<SvPublisherInstance>>& publishers);

    size_t size()  const { return m_schedule.size(); }
    bool   empty() const { return m_schedule.empty(); }

    const ScheduleEntry& operator[](size_t idx) const { return m_schedule[idx]; }
    const ScheduleEntry* data()                  const { return m_schedule.data(); }

    /* Duration of one complete cycle in microseconds */
    uint64_t getCycleDuration() const { return m_cycleDuration_us; }

private:
    std::vector<ScheduleEntry> m_schedule;
    uint64_t m_cycleDuration_us = 0;
};

/*============================================================================
 * SvController — Main Class
 *
 * Responsibilities:
 *   1. Create/manage multiple SvPublisherInstance objects
 *   2. Pre-build frames for all publishers
 *   3. Build the SharedBuffer (merged interleaved schedule)
 *   4. Run the writer thread to transmit via npcap
 *   5. Handle duration/repeat/sendMode
 *============================================================================*/

class SvController {
public:
    static SvController& instance();

    /*--- Publisher Management ---*/
    uint32_t addPublisher();
    int      removePublisher(uint32_t id);
    int      removeAllPublishers();
    SvPublisherInstance* getPublisher(uint32_t id);
    uint32_t getPublisherCount() const;

    /*--- Publisher Configuration (convenience) ---*/
    int configurePublisher(uint32_t id, const PublisherConfig& config);
    int setPublisherEquations(uint32_t id, const char* equations);

    /*--- Lifecycle ---*/
    int  startAll();
    int  stopAll();
    int  resetAll();
    bool isRunning() const { return m_running.load(); }

    /*--- Global Settings ---*/
    int  setSendMode(int mode);
    int  getSendMode() const { return m_sendMode; }
    int  setDuration(uint32_t seconds, bool repeat, bool infinite, uint32_t count);

    /*--- Duration / Repeat Queries ---*/
    uint32_t getRemainingSeconds() const;
    uint32_t getCurrentRepeatCycle() const { return m_repeatCycle.load(); }
    bool     isDurationComplete()   const { return m_durationComplete.load(); }

    /*--- USB-Optimized Padding & Gap ---*/
    void setUsbPadSize(int bytes)  { m_usbPadSize = (bytes >= 0 && bytes <= 1522) ? bytes : 0; }
    int  getUsbPadSize() const     { return m_usbPadSize; }
    void setUsbMinGapUs(int us)    { m_usbMinGapUs = (us >= 0 && us <= 5000) ? us : 0; }
    int  getUsbMinGapUs() const    { return m_usbMinGapUs; }

    const char* getLastError() const { return m_errorBuf; }

private:
    SvController();
    ~SvController();
    SvController(const SvController&) = delete;
    SvController& operator=(const SvController&) = delete;

    /*--- Publishers ---*/
    std::vector<std::unique_ptr<SvPublisherInstance>> m_publishers;
    uint32_t m_nextId = 1;
    mutable std::mutex m_mutex;

    /*--- Shared Buffer ---*/
    SharedBuffer m_sharedBuffer;

    /*--- Writer Thread ---*/
    std::thread      m_writerThread;
    std::atomic<bool> m_running{false};

    /*--- Global Settings ---*/
    int      m_sendMode        = 0;  /* 0=auto, 1=batch, 2=immediate, 3=usb-optimized */
    uint32_t m_durationSeconds = 0;
    bool     m_repeatEnabled   = false;
    bool     m_repeatInfinite  = false;
    uint32_t m_repeatCount     = 0;
    std::atomic<uint32_t> m_repeatCycle{0};
    std::atomic<bool>     m_durationComplete{false};
    std::atomic<uint64_t> m_startTimeMs{0};

    int m_usbPadSize = 0;    /* Pad frames to this byte size (0 = off, max 1522) */
    int m_usbMinGapUs = 0;   /* Min inter-packet gap in microseconds (0 = default 130) */

    char m_errorBuf[512];

    /*--- Internal ---*/
    SvPublisherInstance* findPublisher(uint32_t id);
    bool checkDurationElapsed() const;
    void writerLoop();
    void writerLoopBatch();
    void writerLoopImmediate();

    static inline void spinPause() {
#if defined(_MSC_VER)
        _mm_pause();
#elif defined(__x86_64__) || defined(__i386__)
        __builtin_ia32_pause();
#elif defined(__aarch64__) || defined(__arm__)
        asm volatile("yield");
#else
        sched_yield();
#endif
    }

    void elevateThreadPriority();
    void restoreThreadPriority();
};

#endif /* SV_CONTROLLER_H */
