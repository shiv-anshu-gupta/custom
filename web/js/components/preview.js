/**
 * @module Preview
 * @file components/preview.js
 * @description Packet Preview Module - Live SV Packet Structure Display.
 * Shows Ethernet Header, SV Header, and ASDU preview.
 * 
 * @author SV-PUB Team
 * @date 2025
 */

import store from '../store/index.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let _initialized = false;
const _elements = {};

// ============================================================================
// DOM TEMPLATE
// ============================================================================

/**
 * Get the HTML template for packet preview
 * @memberof module:Preview
 * @returns {string} HTML template string
 */
export function getTemplate() {
    return `
        <section class="card" id="preview-module">
            <div class="card-header">
                <h2>📦 Packet Preview</h2>
            </div>
            <div class="card-body">
                <div class="preview-section">
                    <h5>Ethernet Header</h5>
                    <div class="preview-row">
                        <span>Dest MAC:</span>
                        <code id="prevDestMac">01:0C:CD:04:00:00</code>
                    </div>
                    <div class="preview-row">
                        <span>Src MAC:</span>
                        <code id="prevSrcMac">00:00:00:00:00:01</code>
                    </div>
                    <div class="preview-row">
                        <span>EtherType:</span>
                        <code>0x88BA</code>
                    </div>
                </div>
                <div class="preview-section">
                    <h5>SV Header</h5>
                    <div class="preview-row">
                        <span>APPID:</span>
                        <code id="prevAppId">0x4000</code>
                    </div>
                </div>
                <div class="preview-section">
                    <h5>ASDU</h5>
                    <div class="preview-row">
                        <span>svID:</span>
                        <code id="prevSvId">MU01</code>
                    </div>
                    <div class="preview-row">
                        <span>smpCnt:</span>
                        <code id="prevSmpCnt">0</code>
                    </div>
                    <div class="preview-row">
                        <span>confRev:</span>
                        <code id="prevConfRev">1</code>
                    </div>
                    <div class="preview-row">
                        <span>smpSynch:</span>
                        <code id="prevSmpSynch">2</code>
                    </div>
                </div>
            </div>
        </section>
    `;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the Preview module
 * @memberof module:Preview
 * @param {HTMLElement} container - Container element to inject template
 */
export function init(container) {
    if (_initialized) {
        console.warn('[Preview] Already initialized');
        return;
    }
    
    console.log('[Preview] Initializing...');
    
    // Inject template
    container.innerHTML = getTemplate();
    
    // Cache elements
    _elements.destMac = document.getElementById('prevDestMac');
    _elements.srcMac = document.getElementById('prevSrcMac');
    _elements.appId = document.getElementById('prevAppId');
    _elements.svId = document.getElementById('prevSvId');
    _elements.smpCnt = document.getElementById('prevSmpCnt');
    _elements.confRev = document.getElementById('prevConfRev');
    _elements.smpSynch = document.getElementById('prevSmpSynch');
    
    // Subscribe to config changes
    _subscribeToStore();
    
    // Initial update
    updatePreview();
    
    _initialized = true;
    console.log('[Preview] ✅ Initialized');
}

// ============================================================================
// STORE SUBSCRIPTION
// ============================================================================

function _subscribeToStore() {
    // Subscribe to all config changes
    store.subscribe('config.*', () => {
        updatePreview();
    });
    
    // Also update when stats change (for smpCnt)
    store.subscribe('data.stats.smpCnt', () => {
        const smpCnt = store.get('data.stats.smpCnt') || 0;
        if (_elements.smpCnt) {
            _elements.smpCnt.textContent = smpCnt;
        }
    });
}

// ============================================================================
// UPDATE PREVIEW
// ============================================================================

/**
 * Update preview display from store values
 * @memberof module:Preview
 */
export function updatePreview() {
    const config = {
        dstMAC: store.get('config.dstMAC') || '01:0C:CD:04:00:00',
        srcMAC: store.get('config.srcMAC') || '00:00:00:00:00:01',
        appID: store.get('config.appID') || 0x4000,
        svID: store.get('config.svID') || 'MU01',
        confRev: store.get('config.confRev') || 1,
        smpSynch: store.get('config.smpSynch') || 2
    };
    
    // Update DOM elements
    if (_elements.destMac) _elements.destMac.textContent = config.dstMAC;
    if (_elements.srcMac) _elements.srcMac.textContent = config.srcMAC;
    if (_elements.appId) {
        const appIdNum = typeof config.appID === 'number' ? config.appID : parseInt(config.appID, 16);
        _elements.appId.textContent = `0x${appIdNum.toString(16).toUpperCase().padStart(4, '0')}`;
    }
    if (_elements.svId) _elements.svId.textContent = config.svID;
    if (_elements.confRev) _elements.confRev.textContent = config.confRev;
    if (_elements.smpSynch) _elements.smpSynch.textContent = config.smpSynch;
}

/**
 * Update smpCnt in preview
 * @memberof module:Preview
 * @param {number} smpCnt - Current sample count
 */
export function updatePreviewSmpCnt(smpCnt) {
    if (_elements.smpCnt) {
        _elements.smpCnt.textContent = smpCnt;
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export const Preview = {
    init,
    getTemplate,
    updatePreview,
    updatePreviewSmpCnt
};

export default Preview;
