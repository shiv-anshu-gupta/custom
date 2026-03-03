/**
 * @file sv_stats_impl.cc
 * @brief Transmission Statistics Tracker
 * 
 * Thread-safe statistics tracking for SV packet transmission.
 * Tracks packets, bytes, rates (current and peak), and session timing.
 */

#include "../include/sv_stats.h"
#include <cstdio>
#include <cstring>
#include <mutex>
#include <chrono>

/*============================================================================
 * Module State
 *============================================================================*/

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
    memset(&g_stats, 0, sizeof(g_stats));
}

void npcap_stats_session_start(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    g_stats.session_start_ms = npcap_stats_get_time_ms();
    g_stats.session_end_ms = 0;
    g_stats.rate_window_start_ms = g_stats.session_start_ms;
    g_stats.rate_bytes_sent = 0;
    g_stats.rate_packets_sent = 0;
    g_stats.session_active = 1;
}

void npcap_stats_session_end(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    g_stats.session_end_ms = npcap_stats_get_time_ms();
    g_stats.session_active = 0;
}

void npcap_stats_update_rates(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    uint64_t now = npcap_stats_get_time_ms();
    uint64_t elapsed = now - g_stats.rate_window_start_ms;
    
    /* Update every 250ms */
    if (elapsed >= 250) {
        double seconds = elapsed / 1000.0;
        if (seconds > 0) {
            g_stats.current_bps = (g_stats.rate_bytes_sent * 8.0) / seconds;
            g_stats.current_pps = g_stats.rate_packets_sent / seconds;
            
            if (g_stats.current_bps > g_stats.peak_bps) g_stats.peak_bps = g_stats.current_bps;
            if (g_stats.current_pps > g_stats.peak_pps) g_stats.peak_pps = g_stats.current_pps;
        }
        
        /* Reset window */
        g_stats.rate_window_start_ms = now;
        g_stats.rate_bytes_sent = 0;
        g_stats.rate_packets_sent = 0;
    }
}

void npcap_stats_get(TransmitStats* stats) {
    std::lock_guard<std::mutex> lock(g_mutex);
    memcpy(stats, &g_stats, sizeof(TransmitStats));
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
    std::lock_guard<std::mutex> lock(g_mutex);
    
    g_stats.packets_sent++;
    g_stats.bytes_sent += bytes;
    g_stats.rate_packets_sent++;
    g_stats.rate_bytes_sent += bytes;
    g_stats.last_packet_ms = npcap_stats_get_time_ms();
    
    if (g_stats.packets_sent > 0) {
        g_stats.avg_packet_size = (double)g_stats.bytes_sent / g_stats.packets_sent;
    }
}

void npcap_stats_record_failure(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_stats.packets_failed++;
}

} /* extern "C" */
