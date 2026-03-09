/**
 * @file sv_publisher_instance.h
 * @brief Single SV Publisher Instance (one Merging Unit)
 *
 * Each SvPublisherInstance represents one simulated Merging Unit with:
 *   - Its own configuration (svID, appID, MAC, channels, sample rate)
 *   - Its own EquationProcessor (generates waveform samples)
 *   - Its own internal buffer (pre-built frames for one AC cycle)
 *
 * Architecture:
 *   SvController creates multiple SvPublisherInstance objects.
 *   Each instance pre-builds its frames. The controller then merges
 *   all frames into a SharedBuffer for transmission.
 *
 *   ┌─────────────────────┐
 *   │  SvPublisherInstance │
 *   │  ┌───────────────┐  │
 *   │  │EquationProc.  │──┼──→ Internal Buffer (pre-built frames)
 *   │  │(own instance) │  │         │
 *   │  └───────────────┘  │         ▼
 *   │  Config: svID, etc. │    SharedBuffer (merged schedule)
 *   └─────────────────────┘         │
 *                                   ▼
 *                              npcap writer
 */

#ifndef SV_PUBLISHER_INSTANCE_H
#define SV_PUBLISHER_INSTANCE_H

#include "sv_encoder.h"
#include "equation_processor.h"

#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <new>

#define SV_PUB_MAX_PREBUILT_FRAMES 65536

/*============================================================================
 * Publisher Configuration — all settings for one Merging Unit
 *============================================================================*/

struct PublisherConfig {
    char     svID[64];
    uint16_t appID;
    uint32_t confRev;
    uint8_t  smpSynch;
    uint8_t  srcMAC[6];
    uint8_t  dstMAC[6];
    int      vlanPriority;
    int      vlanID;
    uint64_t sampleRate;
    double   frequency;
    double   voltageAmplitude;
    double   currentAmplitude;
    uint8_t  asduCount;
    uint8_t  channelCount;   /* 1-20 */
};

/*============================================================================
 * SvPublisherInstance Class
 *============================================================================*/

class SvPublisherInstance {
public:
    enum State { IDLE, CONFIGURED, READY, FAILED };

    explicit SvPublisherInstance(uint32_t id);
    ~SvPublisherInstance();

    /* Non-copyable */
    SvPublisherInstance(const SvPublisherInstance&) = delete;
    SvPublisherInstance& operator=(const SvPublisherInstance&) = delete;

    /*--- Configuration ---*/
    int configure(const PublisherConfig& config);
    int setEquations(const char* equations);

    /*--- Frame building (fills internal buffer) ---*/
    int prebuildFrames();

    /*--- Accessors ---*/
    uint32_t             getId()        const { return m_id; }
    State                getState()     const { return m_state; }
    const PublisherConfig& getConfig()  const { return m_config; }
    const char*          getLastError() const { return m_errorBuf; }

    int      getFrameCount()          const { return m_frameCount; }
    uint8_t* getFrame(int idx)        const;
    size_t   getFrameLen(int idx)     const;
    uint64_t getPacketsPerSec()       const;
    int      getSamplesPerCycle()     const;

private:
    uint32_t           m_id;
    State              m_state;
    PublisherConfig    m_config;
    EquationProcessor  m_eqProcessor;

    /* Internal buffer — pre-built frames for one AC cycle */
    uint8_t*  m_frameData;    // flat contiguous buffer: capacity * SV_MAX_FRAME_SIZE
    uint8_t** m_frames;       // array of pointers into m_frameData
    size_t*   m_frameLens;
    int       m_frameCount;
    int       m_frameCapacity;

    char m_errorBuf[256];

    bool allocFrameCache(int count);
    void freeFrameCache();
};

#endif /* SV_PUBLISHER_INSTANCE_H */
