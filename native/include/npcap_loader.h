/**
 * @file npcap_loader.h
 * @brief Npcap DLL Loading Module
 * 
 * Handles dynamic loading of Npcap functions on Windows.
 * Provides unified interface for pcap operations.
 */

#ifndef NPCAP_LOADER_H
#define NPCAP_LOADER_H

#include <cstdint>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

// ============================================================================
// PCAP TYPES AND STRUCTURES
// ============================================================================

typedef void* pcap_t;
typedef struct pcap_if pcap_if_t;

struct pcap_if {
    struct pcap_if* next;
    char* name;
    char* description;
    void* addresses;
    unsigned int flags;
};

typedef struct pcap_send_queue {
    unsigned int maxlen;
    unsigned int len;
    char* buffer;
} pcap_send_queue;

typedef struct pcap_pkthdr {
    struct {
        long tv_sec;
        long tv_usec;
    } ts;
    unsigned int caplen;
    unsigned int len;
} pcap_pkthdr;

// ============================================================================
// FUNCTION POINTER TYPES
// ============================================================================

typedef int (*pcap_findalldevs_t)(pcap_if_t**, char*);
typedef void (*pcap_freealldevs_t)(pcap_if_t*);
typedef pcap_t* (*pcap_open_live_t)(const char*, int, int, int, char*);
typedef void (*pcap_close_t)(pcap_t*);
typedef int (*pcap_sendpacket_t)(pcap_t*, const unsigned char*, int);
typedef pcap_send_queue* (*pcap_sendqueue_alloc_t)(unsigned int memsize);
typedef int (*pcap_sendqueue_queue_t)(pcap_send_queue*, const pcap_pkthdr*, const unsigned char*);
typedef unsigned int (*pcap_sendqueue_transmit_t)(pcap_t*, pcap_send_queue*, int sync);
typedef void (*pcap_sendqueue_destroy_t)(pcap_send_queue*);

// ============================================================================
// NPCAP LOADER API
// ============================================================================

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Load Npcap DLL and get function pointers
 * @return true if successful, false otherwise
 */
bool npcap_loader_init(void);

/**
 * Unload Npcap DLL
 */
void npcap_loader_cleanup(void);

/**
 * Check if Npcap is loaded
 */
bool npcap_loader_is_loaded(void);

/**
 * Check if high-speed sendqueue API is available
 */
bool npcap_loader_has_sendqueue(void);

/**
 * Get last error message
 */
const char* npcap_loader_get_error(void);

// ============================================================================
// PCAP FUNCTION ACCESSORS
// ============================================================================

pcap_findalldevs_t npcap_get_findalldevs(void);
pcap_freealldevs_t npcap_get_freealldevs(void);
pcap_open_live_t npcap_get_open_live(void);
pcap_close_t npcap_get_close(void);
pcap_sendpacket_t npcap_get_sendpacket(void);
pcap_sendqueue_alloc_t npcap_get_sendqueue_alloc(void);
pcap_sendqueue_queue_t npcap_get_sendqueue_queue(void);
pcap_sendqueue_transmit_t npcap_get_sendqueue_transmit(void);
pcap_sendqueue_destroy_t npcap_get_sendqueue_destroy(void);

// ============================================================================
// PCAP HANDLE MANAGEMENT
// ============================================================================

/**
 * Get global pcap handle
 */
pcap_t* npcap_get_handle(void);

/**
 * Set global pcap handle
 */
void npcap_set_handle(pcap_t* handle);

#ifdef __cplusplus
}
#endif

#endif // NPCAP_LOADER_H
