/**
 * @file npcap_transmitter_impl.cc
 * @brief Npcap Network Transmitter
 * 
 * This module provides raw Ethernet packet transmission using the Npcap library.
 * Supports both single-packet and high-speed batch transmission modes.
 * 
 * Features:
 *   - Dynamic DLL loading (Windows)
 *   - Interface enumeration with MAC address detection
 *   - Single packet transmission
 *   - SendQueue batch transmission for high throughput
 */

#include "../include/npcap_transmitter.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <iphlpapi.h>
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "ws2_32.lib")

/*============================================================================
 * Npcap Function Types (for dynamic loading)
 *============================================================================*/

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
    struct { long tv_sec; long tv_usec; } ts;
    unsigned int caplen;
    unsigned int len;
} pcap_pkthdr;

/* Timestamp type constants (from pcap/pcap.h) */
#define PCAP_TSTAMP_HOST             0
#define PCAP_TSTAMP_HOST_LOWPREC     1
#define PCAP_TSTAMP_HOST_HIPREC      2
#define PCAP_TSTAMP_ADAPTER          3
#define PCAP_TSTAMP_ADAPTER_UNSYNCED 4

/* Function pointer types */
typedef int (*pcap_findalldevs_t)(pcap_if_t**, char*);
typedef void (*pcap_freealldevs_t)(pcap_if_t*);
typedef pcap_t* (*pcap_open_live_t)(const char*, int, int, int, char*);
typedef void (*pcap_close_t)(pcap_t*);
typedef int (*pcap_sendpacket_t)(pcap_t*, const unsigned char*, int);
typedef pcap_send_queue* (*pcap_sendqueue_alloc_t)(unsigned int);
typedef int (*pcap_sendqueue_queue_t)(pcap_send_queue*, const pcap_pkthdr*, const unsigned char*);
typedef unsigned int (*pcap_sendqueue_transmit_t)(pcap_t*, pcap_send_queue*, int);
typedef void (*pcap_sendqueue_destroy_t)(pcap_send_queue*);

/* pcap_create workflow for HOST_HIPREC timestamp support */
typedef pcap_t* (*pcap_create_t)(const char*, char*);
typedef int (*pcap_set_snaplen_t)(pcap_t*, int);
typedef int (*pcap_set_promisc_t)(pcap_t*, int);
typedef int (*pcap_set_timeout_t)(pcap_t*, int);
typedef int (*pcap_set_tstamp_type_t)(pcap_t*, int);
typedef int (*pcap_set_immediate_mode_t)(pcap_t*, int);
typedef int (*pcap_activate_t)(pcap_t*);

/*============================================================================
 * Module State
 *============================================================================*/

static HMODULE g_dll = nullptr;
static pcap_findalldevs_t g_findalldevs = nullptr;
static pcap_freealldevs_t g_freealldevs = nullptr;
static pcap_open_live_t g_open_live = nullptr;
static pcap_close_t g_close = nullptr;
static pcap_sendpacket_t g_sendpacket = nullptr;
static pcap_sendqueue_alloc_t g_queue_alloc = nullptr;
static pcap_sendqueue_queue_t g_queue_add = nullptr;
static pcap_sendqueue_transmit_t g_queue_transmit = nullptr;
static pcap_sendqueue_destroy_t g_queue_destroy = nullptr;

/* pcap_create workflow function pointers (for HOST_HIPREC) */
static pcap_create_t g_pcap_create = nullptr;
static pcap_set_snaplen_t g_set_snaplen = nullptr;
static pcap_set_promisc_t g_set_promisc = nullptr;
static pcap_set_timeout_t g_set_timeout = nullptr;
static pcap_set_tstamp_type_t g_set_tstamp_type = nullptr;
static pcap_set_immediate_mode_t g_set_immediate_mode = nullptr;
static pcap_activate_t g_activate = nullptr;

static pcap_t* g_handle = nullptr;
static char g_error[256] = {0};

#else
/* Linux/macOS — link against libpcap directly (no DLL loading needed) */
#include <pcap/pcap.h>
#ifdef __linux__
#include <sys/ioctl.h>
#include <net/if.h>
#include <unistd.h>
#include <time.h>
#endif
#ifdef __APPLE__
#include <net/if_dl.h>
#include <ifaddrs.h>
#include <time.h>
#endif
static pcap_t* g_handle = nullptr;
static char g_error[256] = {0};

/*============================================================================
 * Linux/macOS SendQueue Emulator
 *
 * Npcap's pcap_sendqueue_* API is Windows-only. This emulates it on
 * Linux/macOS by buffering packets in userspace memory and sending them
 * via pcap_sendpacket() in a tight loop on transmit.
 *
 * Buffer layout per entry:
 *   [uint32_t pkt_len][uint64_t timestamp_us][pkt_len bytes of data]
 *
 * sync=0: blast all packets as fast as possible (TIER 2 high-speed)
 * sync=1: pace packets using inter-packet timestamp deltas (TIER 1 precise)
 *============================================================================*/
typedef struct {
    unsigned int maxlen;   /* total buffer capacity in bytes */
    unsigned int len;      /* current used bytes */
    char* buffer;          /* packet data buffer */
} linux_send_queue_t;

#endif

/*============================================================================
 * DLL Loading (Windows)
 *============================================================================*/

#ifdef _WIN32
int npcap_load_dll(void) {
    if (g_dll) return 1;
    
    /* Try Npcap path first, then fallback to system path */
    char path[MAX_PATH];
    if (GetEnvironmentVariableA("SystemRoot", path, MAX_PATH)) {
        strcat(path, "\\System32\\Npcap\\wpcap.dll");
        g_dll = LoadLibraryA(path);
    }
    if (!g_dll) g_dll = LoadLibraryA("wpcap.dll");
    
    if (!g_dll) {
        snprintf(g_error, sizeof(g_error), 
            "Npcap not found. Install from https://npcap.com/");
        return 0;
    }
    
    /* Load required functions */
    g_findalldevs = (pcap_findalldevs_t)GetProcAddress(g_dll, "pcap_findalldevs");
    g_freealldevs = (pcap_freealldevs_t)GetProcAddress(g_dll, "pcap_freealldevs");
    g_open_live = (pcap_open_live_t)GetProcAddress(g_dll, "pcap_open_live");
    g_close = (pcap_close_t)GetProcAddress(g_dll, "pcap_close");
    g_sendpacket = (pcap_sendpacket_t)GetProcAddress(g_dll, "pcap_sendpacket");
    
    /* Optional: SendQueue for high-speed transmission */
    g_queue_alloc = (pcap_sendqueue_alloc_t)GetProcAddress(g_dll, "pcap_sendqueue_alloc");
    g_queue_add = (pcap_sendqueue_queue_t)GetProcAddress(g_dll, "pcap_sendqueue_queue");
    g_queue_transmit = (pcap_sendqueue_transmit_t)GetProcAddress(g_dll, "pcap_sendqueue_transmit");
    g_queue_destroy = (pcap_sendqueue_destroy_t)GetProcAddress(g_dll, "pcap_sendqueue_destroy");
    
    /* Optional: pcap_create workflow for HOST_HIPREC timestamp support */
    g_pcap_create = (pcap_create_t)GetProcAddress(g_dll, "pcap_create");
    g_set_snaplen = (pcap_set_snaplen_t)GetProcAddress(g_dll, "pcap_set_snaplen");
    g_set_promisc = (pcap_set_promisc_t)GetProcAddress(g_dll, "pcap_set_promisc");
    g_set_timeout = (pcap_set_timeout_t)GetProcAddress(g_dll, "pcap_set_timeout");
    g_set_tstamp_type = (pcap_set_tstamp_type_t)GetProcAddress(g_dll, "pcap_set_tstamp_type");
    g_set_immediate_mode = (pcap_set_immediate_mode_t)GetProcAddress(g_dll, "pcap_set_immediate_mode");
    g_activate = (pcap_activate_t)GetProcAddress(g_dll, "pcap_activate");
    
    if (!g_findalldevs || !g_freealldevs || !g_open_live || !g_close || !g_sendpacket) {
        FreeLibrary(g_dll);
        g_dll = nullptr;
        snprintf(g_error, sizeof(g_error), "Failed to load Npcap functions");
        return 0;
    }
    
    printf("[npcap] DLL loaded%s%s\n", 
           g_queue_alloc ? " (batch mode available)" : "",
           g_pcap_create ? " (HOST_HIPREC available)" : "");
    return 1;
}
#else
int npcap_load_dll(void) { return 1; }
#endif

/*============================================================================
 * Interface Functions
 *============================================================================*/

int npcap_list_interfaces(NpcapInterface* interfaces, int max_count) {
    printf("[npcap] Listing network interfaces...\n");
    
#ifdef _WIN32
    if (!npcap_load_dll()) return -1;
    
    pcap_if_t* alldevs = nullptr;
    char errbuf[256] = {0};
    
    if (g_findalldevs(&alldevs, errbuf) == -1) {
        snprintf(g_error, sizeof(g_error), "pcap_findalldevs failed: %s", errbuf);
        printf("[npcap] ERROR: %s\n", g_error);
        return -1;
    }
    
    if (!alldevs) {
        printf("[npcap] WARNING: No interfaces found by pcap_findalldevs\n");
        return 0;
    }
    
    int count = 0;
    for (pcap_if_t* d = alldevs; d && count < max_count; d = d->next) {
        NpcapInterface* iface = &interfaces[count];
        memset(iface, 0, sizeof(NpcapInterface));
        
        if (d->name) {
            strncpy(iface->name, d->name, sizeof(iface->name) - 1);
        }
        if (d->description) {
            strncpy(iface->description, d->description, sizeof(iface->description) - 1);
        }
        
        /* Get MAC address from Windows adapter info */
        PIP_ADAPTER_INFO adapterInfo = nullptr;
        ULONG bufLen = 0;
        
        if (GetAdaptersInfo(adapterInfo, &bufLen) == ERROR_BUFFER_OVERFLOW) {
            adapterInfo = (PIP_ADAPTER_INFO)malloc(bufLen);
            if (adapterInfo && GetAdaptersInfo(adapterInfo, &bufLen) == NO_ERROR) {
                for (PIP_ADAPTER_INFO ai = adapterInfo; ai; ai = ai->Next) {
                    printf("[npcap] Checking: pcap='%s' vs adapter='%s'\n", d->name, ai->AdapterName);
                    if (d->name && strstr(d->name, ai->AdapterName)) {
                        memcpy(iface->mac, ai->Address, 6);
                        iface->has_mac = 1;
                        printf("[npcap] MAC found: %02X:%02X:%02X:%02X:%02X:%02X\n",
                               iface->mac[0], iface->mac[1], iface->mac[2],
                               iface->mac[3], iface->mac[4], iface->mac[5]);
                        break;
                    }
                }
            }
            if (adapterInfo) free(adapterInfo);
        }
        
        printf("[npcap] Interface %d: %s (has_mac=%d)\n", count, 
               iface->description[0] ? iface->description : iface->name, iface->has_mac);
        count++;
    }
    
    g_freealldevs(alldevs);
    printf("[npcap] Total: %d interfaces found\n", count);
    return count;
#else
    pcap_if_t* alldevs;
    char errbuf[PCAP_ERRBUF_SIZE];
    
    if (pcap_findalldevs(&alldevs, errbuf) == -1) {
        snprintf(g_error, sizeof(g_error), "%s", errbuf);
        return -1;
    }
    
    int count = 0;
    for (pcap_if_t* d = alldevs; d && count < max_count; d = d->next) {
        NpcapInterface* iface = &interfaces[count];
        memset(iface, 0, sizeof(NpcapInterface));
        if (d->name) strncpy(iface->name, d->name, sizeof(iface->name) - 1);
        if (d->description) strncpy(iface->description, d->description, sizeof(iface->description) - 1);
        
        /* Get MAC address */
#ifdef __linux__
        int sock = socket(AF_INET, SOCK_DGRAM, 0);
        if (sock >= 0 && d->name) {
            struct ifreq ifr;
            memset(&ifr, 0, sizeof(ifr));
            strncpy(ifr.ifr_name, d->name, IFNAMSIZ - 1);
            if (ioctl(sock, SIOCGIFHWADDR, &ifr) == 0) {
                memcpy(iface->mac, ifr.ifr_hwaddr.sa_data, 6);
                iface->has_mac = 1;
                printf("[pcap] MAC for %s: %02X:%02X:%02X:%02X:%02X:%02X\n",
                       d->name,
                       iface->mac[0], iface->mac[1], iface->mac[2],
                       iface->mac[3], iface->mac[4], iface->mac[5]);
            }
            close(sock);
        }
#elif defined(__APPLE__)
        struct ifaddrs *ifap, *ifa;
        if (getifaddrs(&ifap) == 0) {
            for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
                if (d->name && strcmp(ifa->ifa_name, d->name) == 0 &&
                    ifa->ifa_addr && ifa->ifa_addr->sa_family == AF_LINK) {
                    struct sockaddr_dl *sdl = (struct sockaddr_dl *)ifa->ifa_addr;
                    if (sdl->sdl_alen == 6) {
                        memcpy(iface->mac, LLADDR(sdl), 6);
                        iface->has_mac = 1;
                    }
                    break;
                }
            }
            freeifaddrs(ifap);
        }
#endif
        
        printf("[pcap] Interface %d: %s (has_mac=%d)\n", count,
               iface->description[0] ? iface->description : iface->name, iface->has_mac);
        count++;
    }
    pcap_freealldevs(alldevs);
    printf("[pcap] Total: %d interfaces found\n", count);
    return count;
#endif
}

const char* npcap_get_last_error(void) {
    return g_error;
}

int npcap_open(const char* device_name) {
    printf("[npcap] Opening: %s\n", device_name);
    
#ifdef _WIN32
    if (!npcap_load_dll()) return -1;
    
    if (g_handle) { g_close(g_handle); g_handle = nullptr; }
    
    char errbuf[256];
    
    /* Prefer pcap_create workflow to enable HOST_HIPREC timestamps.
     * HOST_HIPREC uses QPC internally in Npcap kernel driver for
     * microsecond-precision timestamps — no need for manual QPC. */
    if (g_pcap_create && g_set_snaplen && g_set_promisc && 
        g_set_timeout && g_set_tstamp_type && g_activate) {
        
        g_handle = g_pcap_create(device_name, errbuf);
        if (!g_handle) {
            snprintf(g_error, sizeof(g_error), "pcap_create: %s", errbuf);
            return -1;
        }
        
        g_set_snaplen(g_handle, 65536);
        g_set_promisc(g_handle, 1);
        g_set_timeout(g_handle, 1);
        
        /* Set high-precision timestamp type (HOST_HIPREC = QPC-based) */
        int tstamp_ret = g_set_tstamp_type(g_handle, PCAP_TSTAMP_HOST_HIPREC);
        if (tstamp_ret == 0) {
            printf("[npcap] HOST_HIPREC timestamp enabled\n");
        } else {
            printf("[npcap] HOST_HIPREC not supported (code=%d), using default\n", tstamp_ret);
        }
        
        /* Immediate mode: minimize driver-level send/receive buffering.
         * Critical for USB Ethernet adapters to reduce packet batching. */
        if (g_set_immediate_mode) {
            g_set_immediate_mode(g_handle, 1);
            printf("[npcap] Immediate mode enabled (reduced buffering)\n");
        }
        
        int activate_ret = g_activate(g_handle);
        if (activate_ret < 0) {
            snprintf(g_error, sizeof(g_error), "pcap_activate failed (code=%d)", activate_ret);
            g_close(g_handle);
            g_handle = nullptr;
            return -1;
        }
        if (activate_ret > 0) {
            printf("[npcap] pcap_activate warning (code=%d)\n", activate_ret);
        }
        
        printf("[npcap] Interface opened (pcap_create + HOST_HIPREC)\n");
    } else {
        /* Fallback to pcap_open_live if pcap_create not available */
        g_handle = g_open_live(device_name, 65536, 1, 1, errbuf);
        if (!g_handle) {
            snprintf(g_error, sizeof(g_error), "pcap_open_live: %s", errbuf);
            return -1;
        }
        printf("[npcap] Interface opened (pcap_open_live fallback)\n");
    }
#else
    if (g_handle) { pcap_close(g_handle); g_handle = nullptr; }
    
    char errbuf[PCAP_ERRBUF_SIZE];
    
    /* Use pcap_create workflow for immediate_mode support.
     * pcap_set_immediate_mode(1) disables driver-level buffering,
     * critical for USB Ethernet adapters to avoid packet batching.
     * Available in libpcap >= 1.5 (standard on modern Linux). */
    g_handle = pcap_create(device_name, errbuf);
    if (!g_handle) {
        snprintf(g_error, sizeof(g_error), "pcap_create: %s", errbuf);
        return -1;
    }
    
    pcap_set_snaplen(g_handle, 65536);
    pcap_set_promisc(g_handle, 1);
    pcap_set_timeout(g_handle, 1);
    
    /* Immediate mode: reduce driver-level send/receive buffering.
     * Critical for USB Ethernet adapters. */
    pcap_set_immediate_mode(g_handle, 1);
    printf("[pcap] Immediate mode enabled (reduced buffering)\n");
    
    int activate_ret = pcap_activate(g_handle);
    if (activate_ret < 0) {
        snprintf(g_error, sizeof(g_error), "pcap_activate failed (code=%d): %s",
                 activate_ret, pcap_geterr(g_handle));
        pcap_close(g_handle);
        g_handle = nullptr;
        return -1;
    }
    if (activate_ret > 0) {
        printf("[pcap] pcap_activate warning (code=%d): %s\n",
               activate_ret, pcap_geterr(g_handle));
    }
    
    printf("[pcap] Interface opened (pcap_create + immediate mode)\n");
#endif
    
    return 0;
}

void npcap_close(void) {
#ifdef _WIN32
    if (g_handle && g_close) { g_close(g_handle); g_handle = nullptr; }
#else
    if (g_handle) { pcap_close(g_handle); g_handle = nullptr; }
#endif
    printf("[npcap] Interface closed\n");
}

int npcap_is_open(void) {
    return g_handle ? 1 : 0;
}

/*============================================================================
 * Packet Transmission
 *============================================================================*/

int npcap_send_packet(const uint8_t* data, size_t len) {
#ifdef _WIN32
    if (!g_handle || !g_sendpacket) return -1;
    return g_sendpacket(g_handle, data, (int)len);
#else
    if (!g_handle) return -1;
    return pcap_sendpacket(g_handle, data, (int)len);
#endif
}

/*============================================================================
 * SendQueue API (High-Speed Batch Transmission)
 *============================================================================*/

int npcap_sendqueue_available(void) {
#ifdef _WIN32
    return (g_queue_alloc && g_queue_add && g_queue_transmit && g_queue_destroy) ? 1 : 0;
#else
    /* Linux/macOS: sendqueue is emulated via pcap_sendpacket loop */
    return 1;
#endif
}

void* npcap_queue_create(unsigned int memsize) {
#ifdef _WIN32
    return g_queue_alloc ? g_queue_alloc(memsize) : nullptr;
#else
    linux_send_queue_t* q = (linux_send_queue_t*)malloc(sizeof(linux_send_queue_t));
    if (!q) return nullptr;
    q->buffer = (char*)malloc(memsize);
    if (!q->buffer) { free(q); return nullptr; }
    q->maxlen = memsize;
    q->len = 0;
    return q;
#endif
}

int npcap_queue_add(void* queue, const uint8_t* data, size_t len, uint64_t timestamp_us) {
#ifdef _WIN32
    if (!queue || !g_queue_add) return -1;
    
    pcap_pkthdr hdr;
    hdr.ts.tv_sec = (long)(timestamp_us / 1000000);
    hdr.ts.tv_usec = (long)(timestamp_us % 1000000);
    hdr.caplen = (unsigned int)len;
    hdr.len = (unsigned int)len;
    
    return g_queue_add((pcap_send_queue*)queue, &hdr, data);
#else
    if (!queue || !data) return -1;
    linux_send_queue_t* q = (linux_send_queue_t*)queue;
    /* Entry layout: [uint32_t pkt_len][uint64_t timestamp_us][pkt_len bytes data] */
    uint32_t entry_size = (uint32_t)(4 + 8 + len);
    if (q->len + entry_size > q->maxlen) return -1;
    
    char* p = q->buffer + q->len;
    uint32_t pkt_len = (uint32_t)len;
    memcpy(p, &pkt_len, 4);        p += 4;
    memcpy(p, &timestamp_us, 8);   p += 8;
    memcpy(p, data, len);
    q->len += entry_size;
    return 0;
#endif
}

unsigned int npcap_queue_transmit(void* queue, int sync) {
#ifdef _WIN32
    if (!queue || !g_handle || !g_queue_transmit) return 0;
    return g_queue_transmit(g_handle, (pcap_send_queue*)queue, sync);
#else
    /*
     * Linux SendQueue Emulator — transmit all buffered packets.
     *
     * sync=0: Blast all packets via pcap_sendpacket() with no delay.
     *         Used by TIER 2 (>4800 pps) where the caller handles
     *         pacing via spin-wait between batches.
     *
     * sync=1: Pace packets using timestamp deltas relative to first packet.
     *         Uses CLOCK_MONOTONIC + hybrid nanosleep/spin for precision.
     *         Used by TIER 1 (<=4800 pps) for kernel-like pacing.
     */
    if (!queue || !g_handle) return 0;
    linux_send_queue_t* q = (linux_send_queue_t*)queue;
    
    char* p = q->buffer;
    char* end = q->buffer + q->len;
    unsigned int total_sent = 0;
    uint64_t first_ts = 0;
    int first_pkt = 1;
    struct timespec start_time;
    
    if (sync) {
        clock_gettime(CLOCK_MONOTONIC, &start_time);
    }
    
    while (p < end) {
        uint32_t pkt_len;
        uint64_t ts;
        memcpy(&pkt_len, p, 4);  p += 4;
        memcpy(&ts, p, 8);       p += 8;
        
        if (first_pkt) {
            first_ts = ts;
            first_pkt = 0;
        }
        
        /* sync=1: pace using timestamp deltas relative to first packet.
         * Hybrid: nanosleep for bulk of the wait, spin for last ~50us. */
        if (sync && ts > first_ts) {
            uint64_t delay_us = ts - first_ts;
            struct timespec target;
            target.tv_sec  = start_time.tv_sec  + (long)(delay_us / 1000000);
            target.tv_nsec = start_time.tv_nsec + (long)((delay_us % 1000000) * 1000);
            if (target.tv_nsec >= 1000000000L) {
                target.tv_sec++;
                target.tv_nsec -= 1000000000L;
            }
            struct timespec now;
            clock_gettime(CLOCK_MONOTONIC, &now);
            long remaining_us = (long)((target.tv_sec - now.tv_sec) * 1000000 +
                                       (target.tv_nsec - now.tv_nsec) / 1000);
            if (remaining_us > 80) {
                struct timespec sleep_req;
                long sleep_us = remaining_us - 50;
                sleep_req.tv_sec  = sleep_us / 1000000;
                sleep_req.tv_nsec = (sleep_us % 1000000) * 1000;
                nanosleep(&sleep_req, NULL);
            }
            /* Spin-wait for remaining time (sub-50us precision) */
            do {
                clock_gettime(CLOCK_MONOTONIC, &now);
            } while (now.tv_sec < target.tv_sec ||
                     (now.tv_sec == target.tv_sec && now.tv_nsec < target.tv_nsec));
        }
        
        if (pcap_sendpacket(g_handle, (const unsigned char*)p, (int)pkt_len) == 0) {
            total_sent += pkt_len;
        }
        p += pkt_len;
    }
    return total_sent;
#endif
}

void npcap_queue_destroy(void* queue) {
#ifdef _WIN32
    if (queue && g_queue_destroy) g_queue_destroy((pcap_send_queue*)queue);
#else
    if (queue) {
        linux_send_queue_t* q = (linux_send_queue_t*)queue;
        if (q->buffer) free(q->buffer);
        free(q);
    }
#endif
}

void* npcap_get_handle(void) {
    return g_handle;
}

/*============================================================================
 * Frame Padding for USB-Ethernet
 *
 * Pad each SV frame with trailing zeros so fewer frames fit per USB bulk
 * transfer, forcing the adapter driver to submit URBs sooner.
 * IEC 61850-9-2 subscribers parse by PDU length fields, so trailing
 * padding zeros are safely ignored by compliant devices.
 *============================================================================*/

int npcap_send_packet_padded(const uint8_t* data, size_t len, size_t pad_to) {
#ifdef _WIN32
    if (!g_handle || !g_sendpacket) return -1;

    if (pad_to <= len || pad_to > 1522) {
        return g_sendpacket(g_handle, data, (int)len);
    }

    uint8_t padded[1522];
    memcpy(padded, data, len);
    memset(padded + len, 0, pad_to - len);
    return g_sendpacket(g_handle, padded, (int)pad_to);
#else
    if (!g_handle) return -1;
    if (pad_to <= len || pad_to > 1522) {
        return pcap_sendpacket(g_handle, data, (int)len);
    }
    uint8_t padded[1522];
    memcpy(padded, data, len);
    memset(padded + len, 0, pad_to - len);
    return pcap_sendpacket(g_handle, padded, (int)pad_to);
#endif
}
