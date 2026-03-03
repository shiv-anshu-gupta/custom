/**
 * @module MultiPublisher
 * @file components/MultiPublisher.js
 * @description Multi-Publisher Management Panel.
 * 
 * Allows creating multiple SV publisher instances, each with its own
 * svID, appID, and channel configuration. All publishers share the same
 * network interface (from StreamSettings) and equations (from DataSource).
 * 
 * KEY DESIGN: Publishers are managed LOCALLY in this component.
 * No backend calls happen until "Start All" is clicked.
 * This makes the UI responsive and avoids silent failures.
 * 
 * Flow on "Start All":
 *   1. For each local publisher → mp_add_publisher (get C++ ID)
 *   2. For each → mp_configure_publisher (send config + equations)
 *   3. mp_start_all → C++ prebuild frames → transmit
 * 
 * @author SV-PUB Team
 * @date 2025
 */

import store from '../store/index.js';
import { showToast } from '../plugins/toast.js';
import * as tauriClient from '../utils/tauriClient.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let _initialized = false;
let _isRunning = false;
let _pollTimer = null;

/** Auto-incrementing local ID (only for UI tracking) */
let _nextLocalId = 1;

/**
 * Local publisher list. Managed entirely in the frontend.
 * Backend IDs are assigned only when "Start All" is clicked.
 * @type {Array<{localId:number, backendId:number|null, svId:string, appId:number, confRev:number, smpSynch:number, channelCount:number, expanded:boolean}>}
 */
let _publishers = [];

/** Cached DOM references */
const _el = {};

// ============================================================================
// HELPERS
// ============================================================================

function macToBytes(mac) {
    return mac.split(':').map(hex => parseInt(hex, 16));
}

// ============================================================================
// TEMPLATE
// ============================================================================

function getTemplate() {
    return `
        <section class="card" id="multi-publisher-module">
            <div class="card-header">
                <h2>Multi-Publisher</h2>
                <span class="card-subtitle">Simulate Multiple Merging Units</span>
            </div>
            <div class="card-body">

                <!-- Send Mechanism -->
                <div class="mp-setting-section" id="mpSendModeSection">
                    <label class="mode-label">Send Mechanism:</label>
                    <div class="mp-radio-group">
                        <label><input type="radio" name="mpSendMode" value="0" checked> ⚡ Auto</label>
                        <label><input type="radio" name="mpSendMode" value="1"> 📦 SendQueue (batch)</label>
                        <label><input type="radio" name="mpSendMode" value="2"> 📡 SendPacket (immediate)</label>
                        <label><input type="radio" name="mpSendMode" value="3"> 🔌 USB-Optimized</label>
                    </div>
                    <!-- USB Frame Padding (shown when USB-Optimized selected) -->
                    <div class="usb-pad-panel" id="mpUsbPadPanel" style="display:none;">
                        <label>Frame Padding:
                            <select id="mpUsbPadSize" class="usb-pad-select">
                                <option value="0">Off</option>
                                <option value="3">3x (~381B)</option>
                                <option value="5">5x (~635B)</option>
                                <option value="1024">1024B</option>
                                <option value="1514">1514B (MTU)</option>
                            </select>
                        </label>
                        <small class="usb-pad-hint">Larger = fewer frames per USB transfer</small>
                    </div>
                    <!-- USB Min Gap (shown when USB-Optimized selected) -->
                    <div class="usb-pad-panel" id="mpUsbGapPanel" style="display:none;">
                        <label>Min Gap:
                            <select id="mpUsbMinGapUs" class="usb-pad-select">
                                <option value="130" selected>130 µs (default)</option>
                                <option value="250">250 µs</option>
                                <option value="500">500 µs</option>
                                <option value="1000">1000 µs (1 ms)</option>
                                <option value="2000">2000 µs (2 ms)</option>
                                <option value="custom">Custom...</option>
                            </select>
                        </label>
                        <input type="number" id="mpUsbMinGapCustom" class="usb-pad-select" style="display:none; margin-top:4px;" min="50" max="5000" step="10" placeholder="Enter µs (50-5000)">
                        <small class="usb-pad-hint">Larger gap = less USB batching</small>
                    </div>
                </div>

                <!-- Publishing Mode -->
                <div class="mp-setting-section" id="mpPublishModeSection">
                    <label class="mode-label">Publishing Mode:</label>
                    <div class="mp-radio-group">
                        <label><input type="radio" name="mpPublishMode" value="continuous" checked> 🔄 Continuous</label>
                        <label><input type="radio" name="mpPublishMode" value="duration"> ⏱️ Duration</label>
                    </div>
                    <div class="mp-duration-settings" id="mpDurationSettings" style="display:none;">
                        <div class="mp-field mp-field--inline">
                            <label>Duration</label>
                            <input type="number" id="mpDurationValue" value="10" min="1" max="3600" style="width:70px">
                            <select id="mpDurationUnit">
                                <option value="seconds">Seconds</option>
                                <option value="minutes">Minutes</option>
                            </select>
                        </div>
                        <div class="mp-field mp-field--inline">
                            <label><input type="checkbox" id="mpRepeatEnabled"> Repeat</label>
                            <input type="number" id="mpRepeatCount" value="1" min="1" max="999" style="width:60px" disabled>
                            <label><input type="checkbox" id="mpRepeatInfinite" disabled> Infinite</label>
                        </div>
                    </div>
                </div>

                <!-- Add Publisher Button — PRIMARY and prominent -->
                <button class="btn btn-primary mp-add-btn" id="mpAddBtn">
                    <span class="icon">＋</span> Add Publisher
                </button>

                <!-- Publisher Cards List -->
                <div class="mp-list" id="mpList"></div>

                <!-- Start / Stop / Reset All — only visible when publishers exist -->
                <div class="mp-controls" id="mpControls" style="display:none;">
                    <button class="btn btn-success" id="mpStartBtn">
                        ▶ Start All
                    </button>
                    <button class="btn btn-danger" id="mpStopBtn" disabled>
                        ⏹ Stop All
                    </button>
                    <button class="btn btn-warning" id="mpResetBtn" title="Stop + clear all publishers, buffers, stats — fresh start without restarting app">
                        ⟳ Reset All
                    </button>
                </div>

                <!-- Status -->
                <div class="mp-status" id="mpStatus">
                    <span class="status-dot ready"></span>
                    <span class="status-text">Click "Add Publisher" to create SV streams</span>
                </div>
            </div>
        </section>
    `;
}

// ============================================================================
// RENDER
// ============================================================================

function render() {
    const list = _el.list;
    if (!list) return;

    // Clear previous cards
    list.innerHTML = '';

    // Show/hide controls — always show if publishers exist OR running state
    // Reset button should always be accessible
    if (_el.controls) {
        _el.controls.style.display = 'flex';
    }

    // Render each publisher as a card
    _publishers.forEach((pub, idx) => {
        const card = document.createElement('div');
        card.className = 'mp-pub' + (pub.expanded ? ' mp-pub--expanded' : '');

        card.innerHTML = `
            <div class="mp-pub-header">
                <span class="mp-pub-num">#${idx + 1}</span>
                <span class="mp-pub-title">${pub.svId}</span>
                <span class="mp-pub-badge">0x${pub.appId.toString(16).toUpperCase().padStart(4, '0')}</span>
                <span class="mp-pub-badge">${pub.channelCount}ch</span>
                <button class="mp-expand-btn" title="${pub.expanded ? 'Collapse' : 'Edit'}">${pub.expanded ? '▲' : '▼'}</button>
                <button class="mp-del-btn" title="Remove publisher">✕</button>
            </div>
            ${pub.expanded ? `
            <div class="mp-pub-body">
                <div class="mp-field">
                    <label>svID</label>
                    <input type="text" data-field="svId" value="${pub.svId}" maxlength="65"
                        ${_isRunning ? 'disabled' : ''}>
                </div>
                <div class="mp-field">
                    <label>AppID (hex)</label>
                    <input type="number" data-field="appId" value="${pub.appId}" min="0" max="16383"
                        ${_isRunning ? 'disabled' : ''}>
                </div>
                <div class="mp-field">
                    <label>Channels</label>
                    <select data-field="channelCount" ${_isRunning ? 'disabled' : ''}>
                        ${Array.from({length: 20}, (_, i) => i + 1).map(n =>
                            `<option value="${n}" ${pub.channelCount === n ? 'selected' : ''}>${n}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="mp-field">
                    <label>confRev</label>
                    <input type="number" data-field="confRev" value="${pub.confRev}" min="1" max="65535"
                        ${_isRunning ? 'disabled' : ''}>
                </div>
                <p class="mp-field-hint">Equations are shared from the Data Source panel (left column).</p>
            </div>` : ''}
        `;

        // --- Event bindings for this card ---

        // Toggle expand/collapse
        card.querySelector('.mp-expand-btn').addEventListener('click', () => {
            if (_isRunning) return;
            pub.expanded = !pub.expanded;
            render();
        });

        // Delete
        card.querySelector('.mp-del-btn').addEventListener('click', () => {
            if (_isRunning) {
                showToast('Stop publishing first', 'error');
                return;
            }
            _publishers.splice(idx, 1);
            render();
            showToast(`Removed ${pub.svId}`);
        });

        // Field changes (only if expanded)
        if (pub.expanded) {
            card.querySelectorAll('[data-field]').forEach(input => {
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    let val = e.target.value;
                    if (field === 'appId' || field === 'channelCount' || field === 'confRev') {
                        val = parseInt(val) || 0;
                    }
                    pub[field] = val;
                    render(); // re-render to update header badges
                });
            });
        }

        list.appendChild(card);
    });

    // Update button states
    updateButtonStates();
}

function updateButtonStates() {
    if (_el.addBtn) _el.addBtn.disabled = _isRunning;
    if (_el.startBtn) _el.startBtn.disabled = _isRunning || _publishers.length === 0;
    if (_el.stopBtn) _el.stopBtn.disabled = !_isRunning;
    // Reset is always enabled — it works in any state
    if (_el.resetBtn) _el.resetBtn.disabled = false;

    // Disable send mode & publish mode controls while running
    document.querySelectorAll('input[name="mpSendMode"]').forEach(r => r.disabled = _isRunning);
    document.querySelectorAll('input[name="mpPublishMode"]').forEach(r => r.disabled = _isRunning);
    if (_el.durationValue) _el.durationValue.disabled = _isRunning;
    if (_el.durationUnit) _el.durationUnit.disabled = _isRunning;
    if (_el.repeatEnabled) _el.repeatEnabled.disabled = _isRunning;
    if (_el.repeatCount) _el.repeatCount.disabled = _isRunning;
    if (_el.repeatInfinite) _el.repeatInfinite.disabled = _isRunning;

    // Status text
    const dot = _el.status?.querySelector('.status-dot');
    const text = _el.status?.querySelector('.status-text');
    if (dot && text) {
        if (_isRunning) {
            dot.className = 'status-dot publishing';
            text.textContent = `Publishing ${_publishers.length} stream${_publishers.length !== 1 ? 's' : ''}...`;
        } else if (_publishers.length > 0) {
            dot.className = 'status-dot ready';
            text.textContent = `${_publishers.length} publisher${_publishers.length !== 1 ? 's' : ''} configured`;
        } else {
            dot.className = 'status-dot ready';
            text.textContent = 'Click "Add Publisher" to create SV streams';
        }
    }
}

// ============================================================================
// ADD PUBLISHER (local only — no backend call)
// ============================================================================

function addPublisher() {
    if (_isRunning) {
        showToast('Stop publishing first', 'error');
        return;
    }

    const idx = _publishers.length + 1;
    // Default channelCount to the actual number of selected channels in the store
    const storeSelectedCount = store.get('config')?.selectedChannels?.length
                             || store.getChannelsForServer()?.length
                             || 8;
    _publishers.push({
        localId: _nextLocalId++,
        backendId: null,              // assigned on Start All
        svId: `MU${String(idx).padStart(2, '0')}`,
        appId: 0x4000 + (idx - 1),
        confRev: 1,
        smpSynch: 2,
        channelCount: storeSelectedCount,
        expanded: true,
    });

    render();
    console.log(`[MultiPublisher] Added publisher #${idx} locally`);
}

// ============================================================================
// USB PADDING — apply multi-publisher USB padding setting
// ============================================================================

async function _applyMpUsbPadding() {
    const sel = document.getElementById('mpUsbPadSize');
    if (!sel) return;
    const val = parseInt(sel.value) || 0;
    let padBytes = 0;
    if (val === 3)       padBytes = 381;
    else if (val === 5)  padBytes = 635;
    else                 padBytes = val;
    try {
        await tauriClient.mpSetUsbPadSize(padBytes);
        console.log(`[MultiPublisher] USB padding: ${padBytes} bytes`);
    } catch (err) {
        console.error('[MultiPublisher] USB padding error:', err);
    }
}

async function _applyMpUsbMinGap() {
    const sel = document.getElementById('mpUsbMinGapUs');
    if (!sel) return;
    let gapUs;
    if (sel.value === 'custom') {
        const customInput = document.getElementById('mpUsbMinGapCustom');
        gapUs = parseInt(customInput?.value) || 130;
        gapUs = Math.max(50, Math.min(5000, gapUs));
    } else {
        gapUs = parseInt(sel.value) || 130;
    }
    try {
        await tauriClient.mpSetUsbMinGapUs(gapUs);
        console.log(`[MultiPublisher] USB min gap: ${gapUs} µs`);
    } catch (err) {
        console.error('[MultiPublisher] USB gap error:', err);
    }
}

// ============================================================================
// START ALL — sends everything to backend in one go
// ============================================================================

async function startAll() {
    if (_isRunning || _publishers.length === 0) return;

    const storeConfig = store.get('config');
    const storeChannels = store.getChannelsForServer();

    // Step 0: Open interface if needed
    try {
        const isOpen = await tauriClient.isInterfaceOpen();
        if (!isOpen) {
            const interfaces = await tauriClient.getInterfaces();
            const iface = interfaces[storeConfig.interfaceIndex || 0];
            if (iface) {
                await tauriClient.openInterface(iface.name);
            } else {
                showToast('No network interface found', 'error');
                return;
            }
        }
    } catch (err) {
        showToast('Failed to open interface: ' + err, 'error');
        return;
    }

    // Step 1: RESET backend — remove stale publishers from previous session
    try {
        await tauriClient.mpRemoveAllPublishers();
        console.log('[MultiPublisher] Backend reset: all old publishers removed');
    } catch (err) {
        showToast('Failed to reset backend: ' + err, 'error');
        return;
    }

    // Step 2: Add all publishers in backend
    let addedCount = 0;
    for (const pub of _publishers) {
        try {
            const backendId = await tauriClient.mpAddPublisher();
            pub.backendId = backendId;
            addedCount++;
        } catch (err) {
            showToast(`Backend error adding ${pub.svId}: ${err}`, 'error');
            // Rollback: remove all publishers we just added
            try { await tauriClient.mpRemoveAllPublishers(); } catch (_) {}
            _publishers.forEach(p => p.backendId = null);
            return;
        }
    }

    // Step 3: Configure each publisher
    for (const pub of _publishers) {
        const channels = storeChannels.slice(0, pub.channelCount);
        const config = {
            svId: pub.svId,
            appId: pub.appId,
            confRev: pub.confRev,
            smpSynch: pub.smpSynch,
            sampleRate: storeConfig.sampleRate,
            frequency: storeConfig.frequency,
            srcMac: macToBytes(storeConfig.srcMAC),
            dstMac: macToBytes(storeConfig.dstMAC),
            vlanId: storeConfig.vlanID || 0,
            vlanPriority: storeConfig.vlanPriority || 4,
            noAsdu: storeConfig.noASDU || 1,
            channelCount: channels.length,
            channels: channels,
        };

        try {
            await tauriClient.mpConfigurePublisher(pub.backendId, config);
        } catch (err) {
            showToast(`Failed to configure ${pub.svId}: ${err}`, 'error');
            // Rollback: remove all publishers on config failure
            try { await tauriClient.mpRemoveAllPublishers(); } catch (_) {}
            _publishers.forEach(p => p.backendId = null);
            return;
        }
    }

    // Step 4: Read user selections for send mode & duration
    const selectedSendMode = parseInt(
        document.querySelector('input[name="mpSendMode"]:checked')?.value || '0');
    const selectedPublishMode =
        document.querySelector('input[name="mpPublishMode"]:checked')?.value || 'continuous';

    let durationSec = 0;
    let repeatOn = false;
    let repeatInf = false;
    let repeatCnt = 0;

    if (selectedPublishMode === 'duration') {
        let val = parseInt(_el.durationValue?.value) || 10;
        if ((_el.durationUnit?.value) === 'minutes') val *= 60;
        durationSec = val;
        repeatOn = _el.repeatEnabled?.checked || false;
        repeatInf = _el.repeatInfinite?.checked || false;
        repeatCnt = parseInt(_el.repeatCount?.value) || 1;
    }

    try {
        await tauriClient.mpSetSendMode(selectedSendMode);
        // Apply USB padding if USB-Optimized mode
        if (selectedSendMode === 3) {
            await _applyMpUsbPadding();
            await _applyMpUsbMinGap();
        }
        await tauriClient.mpSetDuration(durationSec, repeatOn, repeatInf, repeatCnt);
        await tauriClient.mpStartAll();
    } catch (err) {
        showToast('Failed to start: ' + err, 'error');
        return;
    }

    _isRunning = true;
    render();
    showToast(`${_publishers.length} publisher(s) started`, 'success');

    // Bug #7: Start polling backend to detect duration completion
    startStatusPoll();
}

// ============================================================================
// STOP ALL
// ============================================================================

async function stopAll() {
    if (!_isRunning) return;

    stopStatusPoll();

    try {
        await tauriClient.mpStopAll();
    } catch (err) {
        showToast('Failed to stop: ' + err, 'error');
    }

    // Clear backend IDs — they'll be re-assigned on next Start All
    _publishers.forEach(pub => pub.backendId = null);
    _isRunning = false;
    render();
    showToast('All publishers stopped');
}

// ============================================================================
// RESET ALL — complete fresh start without restarting app
// ============================================================================

async function resetAll() {
    // Stop polling
    stopStatusPoll();

    try {
        // Backend: stop transmit, free all publishers, clear buffers, reset stats
        await tauriClient.mpResetAll();
        console.log('[MultiPublisher] Backend fully reset');
    } catch (err) {
        showToast('Backend reset failed: ' + err, 'error');
        return;
    }

    // Frontend: clear all local state
    _publishers = [];
    _nextLocalId = 1;
    _isRunning = false;

    render();
    showToast('Full reset complete — ready for new configuration', 'success');
}

// ============================================================================
// STATUS POLLING — detects when backend stops (duration elapsed, etc.)
// ============================================================================

function startStatusPoll() {
    stopStatusPoll();
    _pollTimer = setInterval(async () => {
        try {
            const running = await tauriClient.mpIsRunning();
            if (!running && _isRunning) {
                console.log('[MultiPublisher] Backend stopped (duration complete)');
                _publishers.forEach(pub => pub.backendId = null);
                _isRunning = false;
                stopStatusPoll();
                render();
                showToast('Publishing completed (duration elapsed)');
            }
        } catch (e) {
            console.error('[MultiPublisher] Poll error:', e);
        }
    }, 1500);
}

function stopStatusPoll() {
    if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init(container) {
    if (_initialized) return;
    if (!container) {
        console.warn('[MultiPublisher] No container provided');
        return;
    }

    container.innerHTML = getTemplate();

    _el.addBtn = document.getElementById('mpAddBtn');
    _el.list = document.getElementById('mpList');
    _el.controls = document.getElementById('mpControls');
    _el.startBtn = document.getElementById('mpStartBtn');
    _el.stopBtn = document.getElementById('mpStopBtn');
    _el.resetBtn = document.getElementById('mpResetBtn');
    _el.status = document.getElementById('mpStatus');

    // Send Mechanism & Publishing Mode controls
    _el.sendModeSection = document.getElementById('mpSendModeSection');
    _el.publishModeSection = document.getElementById('mpPublishModeSection');
    _el.durationSettings = document.getElementById('mpDurationSettings');
    _el.durationValue = document.getElementById('mpDurationValue');
    _el.durationUnit = document.getElementById('mpDurationUnit');
    _el.repeatEnabled = document.getElementById('mpRepeatEnabled');
    _el.repeatCount = document.getElementById('mpRepeatCount');
    _el.repeatInfinite = document.getElementById('mpRepeatInfinite');

    // Publishing Mode toggle: show/hide duration settings
    document.querySelectorAll('input[name="mpPublishMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            _el.durationSettings.style.display =
                e.target.value === 'duration' ? 'block' : 'none';
        });
    });

    // Repeat checkbox logic
    _el.repeatEnabled.addEventListener('change', () => {
        const on = _el.repeatEnabled.checked;
        _el.repeatCount.disabled = !on || _el.repeatInfinite.checked;
        _el.repeatInfinite.disabled = !on;
    });
    _el.repeatInfinite.addEventListener('change', () => {
        _el.repeatCount.disabled = _el.repeatInfinite.checked;
    });

    // Send mode radio: show/hide USB padding panel
    document.querySelectorAll('input[name="mpSendMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const mode = parseInt(e.target.value);
            const panel = document.getElementById('mpUsbPadPanel');
            if (panel) panel.style.display = (mode === 3) ? 'block' : 'none';
            const gapPanel = document.getElementById('mpUsbGapPanel');
            if (gapPanel) gapPanel.style.display = (mode === 3) ? 'block' : 'none';
        });
    });

    // MP USB Min Gap: show/hide custom input
    const mpGapSelect = document.getElementById('mpUsbMinGapUs');
    if (mpGapSelect) {
        mpGapSelect.addEventListener('change', () => {
            const customInput = document.getElementById('mpUsbMinGapCustom');
            if (customInput) customInput.style.display = (mpGapSelect.value === 'custom') ? 'block' : 'none';
        });
    }

    // Bind top-level buttons
    _el.addBtn.addEventListener('click', addPublisher);
    _el.startBtn.addEventListener('click', startAll);
    _el.stopBtn.addEventListener('click', stopAll);
    _el.resetBtn.addEventListener('click', resetAll);

    // Listen for backend stop events (duration elapsed, etc.)
    tauriClient.on('publishingStopped', () => {
        if (_isRunning) {
            _publishers.forEach(pub => pub.backendId = null);
            _isRunning = false;
            render();
        }
    });

    _initialized = true;
    console.log('[MultiPublisher] Initialized');

    // Bug #8: Sync _isRunning with backend on page load/refresh
    tauriClient.mpIsRunning().then(running => {
        if (running) {
            console.log('[MultiPublisher] Backend is running — syncing UI state');
            _isRunning = true;
            render();
            startStatusPoll();
        }
    }).catch(() => {});
}

// ============================================================================
// EXPORT
// ============================================================================

export const MultiPublisher = { init, getTemplate };
export default MultiPublisher;
