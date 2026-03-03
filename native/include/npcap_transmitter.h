/**
 * @file npcap_transmitter.h
 * @brief Npcap Network Transmitter Module
 * 
 * Handles raw Ethernet packet transmission using Npcap library.
 * Provides both single-packet and batch transmission modes.
 */

#ifndef NPCAP_TRANSMITTER_H
#define NPCAP_TRANSMITTER_H

#include "sv_native.h"  // For NpcapInterface struct

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// INTERFACE FUNCTIONS (NpcapInterface defined in sv_native.h)
// ============================================================================

/**
 * List available network interfaces
 * @param interfaces Array to store interface info
 * @param max_count Maximum number of interfaces to return
 * @return Number of interfaces found, or -1 on error
 */
int npcap_list_interfaces(NpcapInterface* interfaces, int max_count);

/**
 * Get last error message
 * @return Error string
 */
const char* npcap_get_last_error(void);

/**
 * Open a network interface for transmission
 * @param device_name Device name (e.g., "\\Device\\NPF_{GUID}")
 * @return 0 on success, -1 on error
 */
int npcap_open(const char* device_name);

/**
 * Close the currently open interface
 */
void npcap_close(void);

/**
 * Check if an interface is open
 * @return 1 if open, 0 if not
 */
int npcap_is_open(void);

// ============================================================================
// PACKET TRANSMISSION
// ============================================================================

/**
 * Send a single packet
 * @param data Packet data
 * @param len Packet length
 * @return 0 on success, -1 on error
 */
int npcap_send_packet(const uint8_t* data, size_t len);

// ============================================================================
// SENDQUEUE API (High-Speed Batch Transmission)
// ============================================================================

/**
 * Check if SendQueue API is available
 * @return 1 if available, 0 if not
 */
int npcap_sendqueue_available(void);

/**
 * Allocate a send queue
 * @param memsize Size of queue buffer in bytes
 * @return Queue handle, or NULL on error
 */
void* npcap_queue_create(unsigned int memsize);

/**
 * Add a packet to the queue
 * @param queue Queue handle
 * @param data Packet data
 * @param len Packet length
 * @param timestamp_us Timestamp in microseconds (for sync mode)
 * @return 0 on success, -1 on error
 */
int npcap_queue_add(void* queue, const uint8_t* data, size_t len, uint64_t timestamp_us);

/**
 * Transmit all packets in the queue
 * @param queue Queue handle
 * @param sync 1 = respect timestamps, 0 = send as fast as possible
 * @return Number of bytes sent
 */
unsigned int npcap_queue_transmit(void* queue, int sync);

/**
 * Destroy a send queue
 * @param queue Queue handle
 */
void npcap_queue_destroy(void* queue);

// ============================================================================
// INTERNAL FUNCTIONS (for sv_native.cc)
// ============================================================================

/**
 * Load Npcap DLL (Windows only)
 * @return true on success
 */
int npcap_load_dll(void);

/**
 * Get pcap handle for direct access
 * @return pcap_t* handle
 */
void* npcap_get_handle(void);

/**
 * Send a packet with trailing zero-padding.
 * Used to inflate frame size so USB-Ethernet adapters can't aggregate
 * many small frames into one USB bulk transfer.
 *
 * @param data   Original frame data
 * @param len    Original frame length
 * @param pad_to Total padded frame size (64-1522). If <= len, sends as-is.
 * @return 0 on success, -1 on error
 */
int npcap_send_packet_padded(const uint8_t* data, size_t len, size_t pad_to);

#ifdef __cplusplus
}
#endif

#endif // NPCAP_TRANSMITTER_H
