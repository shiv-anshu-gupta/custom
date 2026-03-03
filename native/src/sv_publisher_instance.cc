/**
 * @file sv_publisher_instance.cc
 * @brief Implementation of SvPublisherInstance
 *
 * Each instance represents one Merging Unit. It owns its config,
 * equations, and pre-built frame cache (internal buffer).
 *
 * The prebuildFrames() method is the key operation:
 *   1. Configure the encoder with this publisher's settings
 *   2. For each sample in one AC cycle:
 *      - Generate waveform values from equations
 *      - Encode a complete SV Ethernet frame
 *      - Store in internal buffer
 *   3. Mark state as READY
 *
 * After prebuild, the SvController merges all publishers' frames
 * into a SharedBuffer for transmission.
 */

#include "../include/sv_publisher_instance.h"
#include "../include/sv_encoder.h"

#include <cstdio>
#include <cstring>
#include <cmath>
#include <new>

/*============================================================================
 * Constructor / Destructor
 *============================================================================*/

SvPublisherInstance::SvPublisherInstance(uint32_t id)
    : m_id(id)
    , m_state(IDLE)
    , m_config{}
    , m_eqProcessor(50.0, 4800)
    , m_frames(nullptr)
    , m_frameLens(nullptr)
    , m_frameCount(0)
    , m_frameCapacity(0)
{
    m_errorBuf[0] = '\0';

    /* Sensible defaults */
    strncpy(m_config.svID, "MU01", sizeof(m_config.svID) - 1);
    m_config.appID         = 0x4000;
    m_config.confRev       = 1;
    m_config.smpSynch      = 0;
    m_config.vlanPriority  = 4;
    m_config.vlanID        = 0;
    m_config.sampleRate    = 4000;
    m_config.frequency     = 50.0;
    m_config.voltageAmplitude = 325.0;
    m_config.currentAmplitude = 100.0;
    m_config.asduCount     = 1;
    m_config.channelCount  = 8;

    /* Default destination MAC: IEC 61850 SV multicast
     * Per IEC 61850-8-1 §C.2: 01:0C:CD:04:xx:xx derived from APPID */
    m_config.dstMAC[0] = 0x01; m_config.dstMAC[1] = 0x0C;
    m_config.dstMAC[2] = 0xCD; m_config.dstMAC[3] = 0x04;
    m_config.dstMAC[4] = (uint8_t)((m_config.appID >> 8) & 0xFF);
    m_config.dstMAC[5] = (uint8_t)(m_config.appID & 0xFF);
}

SvPublisherInstance::~SvPublisherInstance()
{
    freeFrameCache();
}

/*============================================================================
 * Accessors
 *============================================================================*/

uint8_t* SvPublisherInstance::getFrame(int idx) const
{
    if (idx >= 0 && idx < m_frameCount && m_frames)
        return m_frames[idx];
    return nullptr;
}

size_t SvPublisherInstance::getFrameLen(int idx) const
{
    if (idx >= 0 && idx < m_frameCount && m_frameLens)
        return m_frameLens[idx];
    return 0;
}

uint64_t SvPublisherInstance::getPacketsPerSec() const
{
    if (m_config.asduCount == 0) return m_config.sampleRate;
    return m_config.sampleRate / m_config.asduCount;
}

int SvPublisherInstance::getSamplesPerCycle() const
{
    if (m_config.frequency <= 0.0) return 1;
    return (int)(m_config.sampleRate / m_config.frequency);
}

/*============================================================================
 * Configuration
 *============================================================================*/

int SvPublisherInstance::configure(const PublisherConfig& config)
{
    m_config = config;

    /* Validate & clamp */
    if (m_config.channelCount < 1)  m_config.channelCount = 1;
    if (m_config.channelCount > SV_MAX_CHANNELS) m_config.channelCount = SV_MAX_CHANNELS;
    if (m_config.asduCount != 1 && m_config.asduCount != 4 && m_config.asduCount != 8)
        m_config.asduCount = 1;
    if (m_config.sampleRate == 0)   m_config.sampleRate = 4000;
    if (m_config.frequency <= 0.0)  m_config.frequency = 50.0;

    /* Auto-derive multicast destination MAC from APPID per IEC 61850-8-1 §C.2.
     * Only when MAC uses the standard SV multicast prefix 01:0C:CD:04:xx:xx.
     * If user set a completely custom MAC, leave it untouched. */
    if (m_config.dstMAC[0] == 0x01 && m_config.dstMAC[1] == 0x0C &&
        m_config.dstMAC[2] == 0xCD && m_config.dstMAC[3] == 0x04) {
        m_config.dstMAC[4] = (uint8_t)((m_config.appID >> 8) & 0xFF);
        m_config.dstMAC[5] = (uint8_t)(m_config.appID & 0xFF);
    }

    /* Update equation processor */
    m_eqProcessor.setDefaultFrequency(m_config.frequency);
    m_eqProcessor.setSampleRate((uint32_t)m_config.sampleRate);

    m_state = CONFIGURED;
    printf("[publisher-%u] Configured: svID=%s, appID=0x%04X, rate=%llu Hz, "
           "freq=%.0f Hz, channels=%d, asdu=%d\n",
           m_id, m_config.svID, m_config.appID,
           (unsigned long long)m_config.sampleRate,
           m_config.frequency, m_config.channelCount, m_config.asduCount);
    return 0;
}

int SvPublisherInstance::setEquations(const char* equations)
{
    if (!equations) {
        snprintf(m_errorBuf, sizeof(m_errorBuf),
                 "Publisher %u: null equations string", m_id);
        return -1;
    }

    m_eqProcessor.setDefaultFrequency(m_config.frequency);
    m_eqProcessor.setSampleRate((uint32_t)m_config.sampleRate);

    int result = m_eqProcessor.loadEquations(equations);
    if (result < 0) {
        snprintf(m_errorBuf, sizeof(m_errorBuf),
                 "Publisher %u: failed to parse equations", m_id);
        return -1;
    }

    printf("[publisher-%u] Loaded %d channel equations\n", m_id, result);
    return 0;
}

/*============================================================================
 * Frame Pre-building (fills internal buffer)
 *
 * IMPORTANT: This function uses the global sv_encoder which is mutex-
 * protected. The SvController calls prebuildFrames() sequentially for
 * each publisher (not in parallel), so there is no contention.
 *============================================================================*/

int SvPublisherInstance::prebuildFrames()
{
    if (m_state < CONFIGURED) {
        snprintf(m_errorBuf, sizeof(m_errorBuf),
                 "Publisher %u: not configured", m_id);
        m_state = FAILED;
        return -1;
    }

    /* IEC 61850-9-2 §7.2.3: smpCnt must count 0 to (sampleRate-1) per second.
     * We pre-build one full second of frames so smpCnt covers the complete
     * range. The waveform naturally repeats every AC cycle, but each frame
     * carries a unique smpCnt value. */
    int packetsPerSecond = (int)getPacketsPerSec();
    if (packetsPerSecond > SV_PUB_MAX_PREBUILT_FRAMES)
        packetsPerSecond = SV_PUB_MAX_PREBUILT_FRAMES;
    if (packetsPerSecond < 1) packetsPerSecond = 1;

    printf("[publisher-%u] Building %d frames (1 sec, smpCnt 0-%d, %d ch, %d ASDU)...\n",
           m_id, packetsPerSecond, packetsPerSecond - 1,
           m_config.channelCount, m_config.asduCount);

    /* Allocate internal buffer */
    if (!allocFrameCache(packetsPerSecond)) {
        snprintf(m_errorBuf, sizeof(m_errorBuf),
                 "Publisher %u: failed to allocate %d frames (%.1f MB)",
                 m_id, packetsPerSecond,
                 (double)packetsPerSecond * SV_MAX_FRAME_SIZE / (1024.0 * 1024.0));
        m_state = FAILED;
        return -1;
    }

    /* Configure encoder for THIS publisher's settings */
    SvEncoderConfig enc = {};
    strncpy(enc.svID, m_config.svID, sizeof(enc.svID) - 1);
    enc.appID        = m_config.appID;
    enc.confRev      = m_config.confRev;
    enc.smpSynch     = m_config.smpSynch;
    memcpy(enc.srcMAC, m_config.srcMAC, 6);
    memcpy(enc.dstMAC, m_config.dstMAC, 6);
    enc.vlanPriority = m_config.vlanPriority;
    enc.vlanID       = m_config.vlanID;
    enc.asduCount    = m_config.asduCount;
    enc.channelCount = m_config.channelCount;
    sv_encoder_set_config(&enc);

    /* Build one frame per sample for the full second.
     * smpCnt = i ranges 0 to (packetsPerSecond - 1), e.g. 0-3999 at 4000 Hz.
     * Waveform repeats every AC cycle but smpCnt is unique per frame. */
    m_frameCount = packetsPerSecond;
    for (int i = 0; i < packetsPerSecond; i++) {
        double t = (double)i / (double)m_config.sampleRate;
        int32_t samples[SV_MAX_CHANNELS] = {0};

        m_eqProcessor.generate9_2LESamples(t, samples, m_config.channelCount);

        size_t size = SV_MAX_FRAME_SIZE;
        int ret = sv_encoder_encode_packet(
            (uint32_t)i, samples, m_frames[i], &size);

        if (ret != 0) {
            snprintf(m_errorBuf, sizeof(m_errorBuf),
                     "Publisher %u: encode failed at sample %d", m_id, i);
            m_state = FAILED;
            return -1;
        }
        m_frameLens[i] = size;
    }

    m_state = READY;
    printf("[publisher-%u] READY: %d frames, %zu bytes/frame\n",
           m_id, m_frameCount, m_frameLens[0]);
    return 0;
}

/*============================================================================
 * Internal Buffer Management
 *============================================================================*/

bool SvPublisherInstance::allocFrameCache(int count)
{
    freeFrameCache();

    m_frames = new (std::nothrow) uint8_t*[count];
    if (!m_frames) return false;

    m_frameLens = new (std::nothrow) size_t[count];
    if (!m_frameLens) {
        delete[] m_frames; m_frames = nullptr;
        return false;
    }

    for (int i = 0; i < count; i++) {
        m_frames[i] = new (std::nothrow) uint8_t[SV_MAX_FRAME_SIZE];
        if (!m_frames[i]) {
            for (int j = 0; j < i; j++) delete[] m_frames[j];
            delete[] m_frames;   m_frames = nullptr;
            delete[] m_frameLens; m_frameLens = nullptr;
            return false;
        }
    }

    m_frameCapacity = count;
    return true;
}

void SvPublisherInstance::freeFrameCache()
{
    if (m_frames) {
        for (int i = 0; i < m_frameCapacity; i++)
            delete[] m_frames[i];
        delete[] m_frames;
        m_frames = nullptr;
    }
    if (m_frameLens) {
        delete[] m_frameLens;
        m_frameLens = nullptr;
    }
    m_frameCount    = 0;
    m_frameCapacity = 0;
}
