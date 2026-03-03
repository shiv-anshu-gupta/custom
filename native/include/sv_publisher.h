/**
 * @file sv_publisher.h
 * @brief SV Publisher Module Header
 * 
 * High-level publisher functions for SV packet transmission.
 * Combines encoder, transmitter, and statistics modules.
 */

#ifndef SV_PUBLISHER_H
#define SV_PUBLISHER_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// PUBLISHER CONFIGURATION
// ============================================================================

/**
 * Configure the publisher
 * @param svID Stream identifier
 * @param appID Application ID
 * @param confRev Configuration revision
 * @param smpSynch Synchronization status
 * @param srcMAC Source MAC address (6 bytes)
 * @param dstMAC Destination MAC address (6 bytes)
 * @param vlanPriority VLAN priority (0-7)
 * @param vlanID VLAN ID (0 = no VLAN)
 * @param sampleRate Sample rate in Hz
 * @param frequency Power frequency (50 or 60 Hz)
 * @param voltageAmplitude Voltage amplitude
 * @param currentAmplitude Current amplitude
 * @param asduCount Number of ASDUs per frame (1, 4, or 8)
 * @return 0 on success
 */
int npcap_publisher_configure(
    const char* svID,
    uint16_t appID,
    uint32_t confRev,
    uint8_t smpSynch,
    const uint8_t* srcMAC,
    const uint8_t* dstMAC,
    int vlanPriority,
    int vlanID,
    uint64_t sampleRate,
    double frequency,
    double voltageAmplitude,
    double currentAmplitude,
    uint8_t asduCount
);

/**
 * Start publishing
 * @return 0 on success
 */
int npcap_publisher_start(void);

/**
 * Stop publishing
 * @return 0 on success
 */
int npcap_publisher_stop(void);

/**
 * Check if publisher is running
 * @return 1 if running, 0 if not
 */
int npcap_publisher_is_running(void);

// ============================================================================
// DURATION & REPEAT MODE
// ============================================================================

/**
 * Set duration and repeat mode
 * @param durationSeconds Duration in seconds (0 = continuous)
 * @param repeatEnabled Whether repeat mode is enabled
 * @param repeatInfinite If repeat, true = infinite loop
 * @param repeatCount Number of repeats (if not infinite)
 * @return 0 on success
 */
int npcap_set_duration_mode(
    uint32_t durationSeconds,
    int repeatEnabled,
    int repeatInfinite,
    uint32_t repeatCount
);

/**
 * Get remaining seconds in current cycle
 * @return Remaining seconds
 */
uint32_t npcap_get_remaining_seconds(void);

/**
 * Get current repeat cycle number
 * @return Cycle number (0-based)
 */
uint32_t npcap_get_current_repeat_cycle(void);

/**
 * Check if duration has completed
 * @return 1 if complete, 0 if running
 */
int npcap_is_duration_complete(void);

// ============================================================================
// EQUATIONS API
// ============================================================================

/**
 * Set channel equations
 * Format: "id1:equation1|id2:equation2|..."
 * @param equations Equation string
 * @return 0 on success
 */
int npcap_set_equations(const char* equations);

// ============================================================================
// FRAME INSPECTION
// ============================================================================

/**
 * Get a sample frame with specified smpCnt
 * @param outBuffer Output buffer
 * @param bufferSize Buffer size
 * @param outFrameSize Output: actual frame size
 * @param smpCnt Sample count value
 * @return 0 on success
 */
int npcap_get_sample_frame(
    uint8_t* outBuffer, 
    size_t bufferSize, 
    size_t* outFrameSize, 
    uint32_t smpCnt
);

/**
 * Get current channel values
 * @param outValues Array of 8 int32_t
 * @return 0 on success
 */
int npcap_get_current_channel_values(int32_t* outValues);

/**
 * Get current sample count
 * @return Current smpCnt
 */
uint32_t npcap_get_current_smp_cnt(void);

#ifdef __cplusplus
}
#endif

#endif // SV_PUBLISHER_H
