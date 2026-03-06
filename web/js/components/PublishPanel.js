/**
 * @module PublishPanel
 * @file components/PublishPanel.js
 * @description Publish Controls Module for Start/Stop publishing.
 * Handles continuous/duration modes, ASDU count, and publish state.
 * 
 * @author SV-PUB Team
 * @date 2025
 */

import store from '../store/index.js';
import { showToast } from '../plugins/toast.js';
import * as tauriClient from '../utils/tauriClient.js';
import * as DataSource from './DataSource.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let _initialized = false;
let _isPublishing = false;
let _isConnected = false;
let _statusPollingInterval = null;  // Poll backend for duration/repeat status
const _elements = {};

// NOTE: Duration/Repeat timing is handled by C++ BACKEND, not JavaScript!
// Frontend only displays status received from backend polling

// ============================================================================
// DOM TEMPLATE
// ============================================================================

/**
 * Get the HTML template for publish controls
 * @memberof module:PublishPanel
 * @returns {string} HTML template string
 */
export function getTemplate() {
    return `
        <section class="card publish-card" id="publish-panel-module">
            <div class="card-header">
                <h2>Publish</h2>
            </div>
            <div class="card-body">
                <!-- Publishing Mode Selection -->
                <div class="publish-mode-section">
                    <label class="mode-label">Publishing Mode:</label>
                    <div class="mode-options">
                        <label class="mode-option">
                            <input type="radio" name="publishMode" value="continuous" checked>
                            <span class="mode-text">🔄 Continuous</span>
                        </label>
                        <label class="mode-option">
                            <input type="radio" name="publishMode" value="duration">
                            <span class="mode-text">⏱️ Duration</span>
                        </label>
                    </div>
                    <div class="duration-input-group" id="durationInputGroup" style="display: none;">
                        <input type="number" id="publishDuration" min="1" max="3600" value="5" class="duration-input">
                        <select id="durationUnit" class="duration-unit">
                            <option value="1">seconds</option>
                            <option value="60">minutes</option>
                        </select>
                    </div>
                    
                    <!-- Repeat Mode Section -->
                    <div class="repeat-mode-section" id="repeatModeSection" style="display: none;">
                        <div class="repeat-checkbox-row">
                            <label class="repeat-option">
                                <input type="checkbox" id="repeatEnabled">
                                <span class="repeat-text">🔁 Repeat</span>
                            </label>
                        </div>
                        <div class="repeat-options" id="repeatOptions" style="display: none;">
                            <div class="repeat-type-row">
                                <label class="repeat-type-option">
                                    <input type="radio" name="repeatType" value="infinite" checked>
                                    <span>♾️ Infinite Loop</span>
                                </label>
                                <label class="repeat-type-option">
                                    <input type="radio" name="repeatType" value="count">
                                    <span>🔢 Fixed Count</span>
                                </label>
                            </div>
                            <div class="repeat-count-row" id="repeatCountRow" style="display: none;">
                                <label>Repeat:</label>
                                <input type="number" id="repeatCount" min="1" max="100" value="3" class="repeat-count-input">
                                <span>times</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Send Mode Selection -->
                <div class="send-mode-section">
                    <label class="mode-label">Send Mechanism:</label>
                    <div class="send-mode-options">
                        <label class="send-mode-option" title="Auto-detect: use SendQueue if available, otherwise fall back to single-packet mode">
                            <input type="radio" name="sendMode" value="0" checked>
                            <span class="send-mode-text">⚡ Auto</span>
                        </label>
                        <label class="send-mode-option" title="SendQueue: batch mode using pcap_sendqueue API — best for PCIe NICs, high throughput">
                            <input type="radio" name="sendMode" value="1">
                            <span class="send-mode-text">📦 SendQueue</span>
                        </label>
                        <label class="send-mode-option" title="SendPacket: per-packet mode using pcap_sendpacket — best for USB Ethernet adapters">
                            <input type="radio" name="sendMode" value="2">
                            <span class="send-mode-text">📡 SendPacket</span>
                        </label>
                        <label class="send-mode-option" title="USB-Optimized: forced spin pacing + minimum inter-packet gap — fixes duplicate timestamps on USB Ethernet">
                            <input type="radio" name="sendMode" value="3">
                            <span class="send-mode-text">🔌 USB-Optimized</span>
                        </label>
                    </div>
                    <div class="send-mode-info" id="sendModeInfo">
                        <small>Auto-detect: selects optimal send mode for your platform</small>
                    </div>
                    <!-- USB Frame Padding (shown when USB-Optimized selected) -->
                    <div class="usb-pad-panel" id="usbPadPanel" style="display:none;">
                        <label title="Pad SV frames with trailing zeros so fewer fit per USB transfer. Boss says try 3x or 5x.">
                            Frame Padding:
                            <select id="usbPadSize" class="usb-pad-select">
                                <option value="0">Off (no padding)</option>
                                <option value="3">3x frame size (~381 bytes)</option>
                                <option value="5">5x frame size (~635 bytes)</option>
                                <option value="1024">1024 bytes (fixed)</option>
                                <option value="1514">1514 bytes / MTU (fixed)</option>
                            </select>
                        </label>
                        <small class="usb-pad-hint">Larger frames = fewer per USB transfer = less batching</small>
                    </div>
                    <!-- USB Min Gap (shown when USB-Optimized selected) -->
                    <div class="usb-pad-panel" id="usbGapPanel" style="display:none;">
                        <label title="Minimum gap between consecutive sends. Larger gap = less chance of USB batching.">
                            Min Inter-Packet Gap:
                            <select id="usbMinGapUs" class="usb-pad-select">
                                <option value="130" selected>130 µs (default)</option>
                                <option value="250">250 µs</option>
                                <option value="500">500 µs</option>
                                <option value="1000">1000 µs (1 ms)</option>
                                <option value="2000">2000 µs (2 ms)</option>
                                <option value="custom">Custom...</option>
                            </select>
                        </label>
                        <input type="number" id="usbMinGapCustom" class="usb-pad-select" style="display:none; margin-top:4px;" min="50" max="5000" step="10" placeholder="Enter µs (50-5000)">
                        <small class="usb-pad-hint">Larger gap = USB adapter has more time to flush each frame</small>
                    </div>
                </div>
                
                <div class="publish-buttons">
                    <button class="btn btn-success btn-large" id="startBtn">
                        <span class="icon">▶</span> START
                    </button>
                    <button class="btn btn-danger btn-large" id="stopBtn" disabled>
                        <span class="icon">⏹</span> STOP
                    </button>
                </div>
                <div class="status-display">
                    <span class="status-dot ready"></span>
                    <span class="status-text">Ready</span>
                </div>
                <div class="timer-display" id="timerDisplay" style="display: none;">
                    <span class="timer-icon">⏱️</span>
                    <span class="timer-text" id="timerText">5s remaining</span>
                    <span class="repeat-badge" id="repeatBadge" style="display: none;">Cycle 1/3</span>
                </div>
                <div class="source-display">
                    <span>Source:</span>
                    <strong id="activeSource">Equation</strong>
                </div>
            </div>
        </section>
    `;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the Publish Panel module
 * @memberof module:PublishPanel
 * @param {HTMLElement} container - Container element to inject template
 */
export function init(container) {
    if (_initialized) {
        console.warn('[PublishPanel] Already initialized');
        return;
    }
    
    console.log('[PublishPanel] Initializing...');
    
    // Inject template
    container.innerHTML = getTemplate();
    
    // Cache elements
    _elements.startBtn = document.getElementById('startBtn');
    _elements.stopBtn = document.getElementById('stopBtn');
    _elements.statusDot = container.querySelector('.status-dot');
    _elements.statusText = container.querySelector('.status-text');
    _elements.activeSource = document.getElementById('activeSource');
    _elements.durationGroup = document.getElementById('durationInputGroup');
    _elements.durationInput = document.getElementById('publishDuration');
    _elements.durationUnit = document.getElementById('durationUnit');
    _elements.repeatSection = document.getElementById('repeatModeSection');
    _elements.repeatEnabled = document.getElementById('repeatEnabled');
    _elements.repeatOptions = document.getElementById('repeatOptions');
    _elements.repeatCountRow = document.getElementById('repeatCountRow');
    _elements.repeatCountInput = document.getElementById('repeatCount');
    _elements.timerDisplay = document.getElementById('timerDisplay');
    _elements.timerText = document.getElementById('timerText');
    _elements.repeatBadge = document.getElementById('repeatBadge');
    _elements.sendModeInfo = document.getElementById('sendModeInfo');
    
    // Bind events
    _bindEvents();
    
    // Setup Tauri handlers
    _setupTauriHandlers();
    
    // Initialize from store
    _initFromStore();
    
    _initialized = true;
    console.log('[PublishPanel] ✅ Initialized');
}

// ============================================================================
// EVENT BINDING
// ============================================================================

function _bindEvents() {
    // Start/Stop buttons
    _elements.startBtn?.addEventListener('click', startPublishing);
    _elements.stopBtn?.addEventListener('click', stopPublishing);
    
    // Publishing mode toggle
    const modeRadios = document.querySelectorAll('input[name="publishMode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const showDuration = e.target.value === 'duration';
            if (_elements.durationGroup) {
                _elements.durationGroup.style.display = showDuration ? 'flex' : 'none';
            }
            if (_elements.repeatSection) {
                _elements.repeatSection.style.display = showDuration ? 'block' : 'none';
            }
        });
    });
    
    // Repeat checkbox toggle
    _elements.repeatEnabled?.addEventListener('change', (e) => {
        if (_elements.repeatOptions) {
            _elements.repeatOptions.style.display = e.target.checked ? 'block' : 'none';
        }
    });
    
    // Repeat type toggle (infinite vs fixed count)
    const repeatTypeRadios = document.querySelectorAll('input[name="repeatType"]');
    repeatTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (_elements.repeatCountRow) {
                _elements.repeatCountRow.style.display = e.target.value === 'count' ? 'flex' : 'none';
            }
        });
    });
    
    // Send mode toggle
    const sendModeRadios = document.querySelectorAll('input[name="sendMode"]');
    sendModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const mode = parseInt(e.target.value);
            _updateSendModeInfo(mode);
            // Send mode change to backend immediately
            tauriClient.setSendMode(mode).then(() => {
                console.log('[PublishPanel] Send mode set to:', mode);
            }).catch(err => {
                console.error('[PublishPanel] Failed to set send mode:', err);
                showToast('Failed to set send mode: ' + err, 'error');
            });
        });
    });

    // USB Min Gap: show/hide custom input
    const gapSelect = document.getElementById('usbMinGapUs');
    if (gapSelect) {
        gapSelect.addEventListener('change', () => {
            const customInput = document.getElementById('usbMinGapCustom');
            if (customInput) customInput.style.display = (gapSelect.value === 'custom') ? 'block' : 'none';
        });
    }
    
    // Subscribe to data source changes
    store.subscribe('data.activeTab', () => {
        _updateSourceDisplay();
    });
}

function _setupTauriHandlers() {
    tauriClient.on('connect', () => {
        _isConnected = true;
        _updateStatus('ready', 'Ready');
    });
    
    tauriClient.on('disconnect', () => {
        _isConnected = false;
        _updateStatus('disconnected', 'Disconnected');
    });
    
    tauriClient.on('status', (data) => {
        if (data.status === 'running') {
            _isPublishing = true;
            _updatePublishButtons(true);
            _updateStatus('publishing', 'Publishing...');
        } else if (data.status === 'stopped') {
            _isPublishing = false;
            _updatePublishButtons(false);
            _updateStatus('ready', 'Stopped');
        }
    });
    
    tauriClient.on('init', (data) => {
        _isPublishing = data.isPublishing;
        _updatePublishButtons(data.isPublishing);
        if (data.isPublishing) {
            _updateStatus('publishing', 'Publishing...');
        }
    });
    
    tauriClient.on('error', (err) => {
        _updateStatus('error', 'Error');
        showToast(err.message || 'An error occurred', 'error');
    });
    
    // Handle backend-controlled publishing stop (e.g., duration elapsed)
    tauriClient.on('publishingStopped', (data) => {
        console.log('[PublishPanel] 🛑 RECEIVED publishingStopped event:', data);
        console.log('[PublishPanel] 🛑 Reason:', data.reason);
        _isPublishing = false;
        _updatePublishButtons(false);
        
        if (data.reason === 'duration_elapsed') {
            _updateStatus('complete', 'Duration Complete');
            showToast('Publishing completed - duration elapsed', 'success');
        } else {
            _updateStatus('ready', 'Stopped');
        }
        console.log('[PublishPanel] ✅ UI updated after publishingStopped');
    });
}

function _initFromStore() {
    // Set ASDU count from store
    const noASDU = store.get('config.noASDU') || 1;
    console.log('[PublishPanel] Initial noASDU from store:', noASDU);
    if (_elements.asduSelect) {
        _elements.asduSelect.value = noASDU;
    }
    
    // Update source display
    _updateSourceDisplay();
}

// ============================================================================
// UI UPDATES
// ============================================================================

function _updatePublishButtons(isPublishing) {
    if (_elements.startBtn) {
        _elements.startBtn.disabled = isPublishing;
    }
    if (_elements.stopBtn) {
        _elements.stopBtn.disabled = !isPublishing;
    }
}

function _updateStatus(state, text) {
    if (_elements.statusDot) {
        _elements.statusDot.className = `status-dot ${state}`;
    }
    if (_elements.statusText) {
        _elements.statusText.textContent = text;
    }
}

function _updateSourceDisplay() {
    const activeTab = store.get('data.activeTab') || 'equation';
    if (_elements.activeSource) {
        _elements.activeSource.textContent = activeTab === 'pcap' ? 'PCAP File' : 'Equation';
    }
}

function _updateSendModeInfo(mode) {
    const descriptions = [
        'Auto-detect: selects optimal send mode for your platform',
        'SendQueue: batch mode — high throughput, best for PCIe NICs',
        'SendPacket: per-packet mode — best for USB Ethernet adapters',
        'USB-Optimized: spin pacing + min gap + frame padding — fixes duplicate timestamps on USB Ethernet'
    ];
    if (_elements.sendModeInfo) {
        _elements.sendModeInfo.innerHTML = `<small>${descriptions[mode] || descriptions[0]}</small>`;
    }
    // Show/hide USB padding panel
    const usbPanel = document.getElementById('usbPadPanel');
    if (usbPanel) {
        usbPanel.style.display = (mode === 3) ? 'block' : 'none';
    }
    // Show/hide USB gap panel
    const gapPanel = document.getElementById('usbGapPanel');
    if (gapPanel) {
        gapPanel.style.display = (mode === 3) ? 'block' : 'none';
    }
}

/**
 * Apply USB frame padding setting to backend.
 * Values "3" and "5" are multipliers of the typical SV frame size (~127 bytes).
 * Values >= 64 are treated as absolute byte sizes.
 */
async function _applyUsbPadding() {
    const sel = document.getElementById('usbPadSize');
    if (!sel) return;
    const val = parseInt(sel.value) || 0;
    let padBytes = 0;
    if (val === 3)       padBytes = 381;   // ~127 * 3
    else if (val === 5)  padBytes = 635;   // ~127 * 5
    else                 padBytes = val;    // 0, 1024, 1514 etc.
    try {
        await tauriClient.setUsbPadSize(padBytes);
        console.log(`[PublishPanel] USB padding: ${padBytes} bytes (selection=${val})`);
    } catch (err) {
        console.error('[PublishPanel] USB padding error:', err);
    }
}

/**
 * Apply USB min inter-packet gap setting to backend.
 */
async function _applyUsbMinGap() {
    const sel = document.getElementById('usbMinGapUs');
    if (!sel) return;
    let gapUs;
    if (sel.value === 'custom') {
        const customInput = document.getElementById('usbMinGapCustom');
        gapUs = parseInt(customInput?.value) || 130;
        gapUs = Math.max(50, Math.min(5000, gapUs));
    } else {
        gapUs = parseInt(sel.value) || 130;
    }
    try {
        await tauriClient.setUsbMinGapUs(gapUs);
        console.log(`[PublishPanel] USB min gap: ${gapUs} µs`);
    } catch (err) {
        console.error('[PublishPanel] USB gap error:', err);
    }
}

/**
 * Get current send mode from UI
 * @returns {number} 0=auto, 1=sendqueue, 2=sendpacket, 3=usb-optimized
 */
function _getSendMode() {
    const sendModeRadios = document.getElementsByName('sendMode');
    for (const radio of sendModeRadios) {
        if (radio.checked) {
            return parseInt(radio.value);
        }
    }
    return 0; // default: auto
}

// ============================================================================
// PUBLISHING ACTIONS (BACKEND CONTROLLED - NO JS TIMERS!)
// ============================================================================

/**
 * Get duration settings from UI
 * @returns {Object} { durationSeconds, repeatEnabled, repeatInfinite, repeatCount }
 */
function _getDurationSettings() {
    const modeRadios = document.getElementsByName('publishMode');
    let selectedMode = 'continuous';
    
    for (const radio of modeRadios) {
        if (radio.checked) {
            selectedMode = radio.value;
            break;
        }
    }
    
    // Continuous mode = duration 0
    if (selectedMode === 'continuous') {
        return {
            durationSeconds: 0,
            repeatEnabled: false,
            repeatInfinite: false,
            repeatCount: 0
        };
    }
    
    // Duration mode
    const value = parseInt(_elements.durationInput?.value) || 5;
    const multiplier = parseInt(_elements.durationUnit?.value) || 1;
    const durationSeconds = value * multiplier;
    
    // Repeat settings
    const repeatEnabled = _elements.repeatEnabled?.checked || false;
    let repeatInfinite = false;
    let repeatCount = 0;
    
    if (repeatEnabled) {
        const repeatTypeRadios = document.getElementsByName('repeatType');
        let repeatType = 'infinite';
        for (const radio of repeatTypeRadios) {
            if (radio.checked) {
                repeatType = radio.value;
                break;
            }
        }
        repeatInfinite = (repeatType === 'infinite');
        repeatCount = repeatInfinite ? 0 : (parseInt(_elements.repeatCountInput?.value) || 3);
    }
    
    return { durationSeconds, repeatEnabled, repeatInfinite, repeatCount };
}

/**
 * Start publishing SV data
 * @memberof module:PublishPanel
 * @async
 */
export async function startPublishing() {
    if (_isPublishing) return;
    if (!_isConnected) {
        showToast('Not connected to backend', 'error');
        return;
    }

    const activeTab = DataSource.getActiveTab();

    if (activeTab === 'pcap') {
        if (!DataSource.isPcapLoaded()) {
            showToast('Please load a PCAP file first', 'error');
            return;
        }
    }

    // Get COMPLETE data from store (config + channels)
    const serverData = store.getDataForServer();
    
    // DEBUG: Log config being sent
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  📤 CONFIG BEING SENT TO BACKEND                           ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  svId:', serverData.config.svId);
    console.log('║  sampleRate:', serverData.config.sampleRate);
    console.log('║  frequency:', serverData.config.frequency);
    console.log('║  noAsdu:', serverData.config.noAsdu, '← ASDU per frame');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    // DEBUG: Log equations being sent
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  📤 EQUATIONS BEING SENT TO BACKEND                        ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    serverData.channels.forEach((ch, i) => {
        console.log(`║  [${i}] ${ch.id.padEnd(8)} │ ${ch.equation.substring(0, 40).padEnd(40)} ║`);
    });
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    // Send config and channels BEFORE starting
    try {
        console.log('⏳ Sending config and channels to backend...');
        await tauriClient.updateData(serverData);
        console.log('✅ Config and channels sent to backend successfully!');
    } catch (err) {
        console.error('❌ Failed to send config/channels:', err);
        showToast('Failed to send configuration: ' + err.message, 'error');
        return;
    }

    // Handle based on active tab
    if (activeTab === 'pcap') {
        // Start PCAP replay
        const loopCheckbox = document.getElementById('loopPlayback');
        const loop = loopCheckbox ? loopCheckbox.checked : false;
        
        const speedSelect = document.getElementById('playbackSpeed');
        const syncMode = speedSelect ? parseInt(speedSelect.value) : 1;
        
        tauriClient.send({
            type: 'pcap_replay',
            data: {
                loop: loop,
                interfaceIndex: serverData.meta.interfaceIndex,
                syncMode: syncMode
            }
        });
        
        showToast(syncMode === 0 ? 'Starting PCAP replay (max speed)...' : 'Starting PCAP replay (real-time)...', 'info');
        
    } else if (activeTab === 'equation') {
        // ═══════════════════════════════════════════════════════════════════════════
        // BACKEND-CONTROLLED DURATION/REPEAT
        // All timing happens in C++, NOT JavaScript!
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Get duration settings from UI
        const durationSettings = _getDurationSettings();
        
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║  ⏱️ DURATION SETTINGS (Sending to C++ Backend!)            ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║  Duration: ${durationSettings.durationSeconds}s (${durationSettings.durationSeconds === 0 ? 'CONTINUOUS' : 'TIMED'})`);
        console.log(`║  Repeat: ${durationSettings.repeatEnabled ? 'YES' : 'NO'}`);
        if (durationSettings.repeatEnabled) {
            console.log(`║  Mode: ${durationSettings.repeatInfinite ? 'INFINITE' : `${durationSettings.repeatCount} times`}`);
        }
        console.log('╚════════════════════════════════════════════════════════════╝');
        
        // Send duration mode to C++ backend BEFORE starting
        try {
            await tauriClient.setDurationMode(durationSettings);
            console.log('✅ Duration settings sent to C++ backend');
        } catch (err) {
            console.error('❌ Failed to set duration mode:', err);
            showToast('Failed to set duration mode: ' + err, 'error');
            return;
        }
        
        // Send send mode to C++ backend BEFORE starting
        const sendMode = _getSendMode();
        const sendModeNames = ['Auto', 'SendQueue (batch)', 'SendPacket (immediate)', 'USB-Optimized'];
        console.log(`🔀 Send mode: ${sendModeNames[sendMode] || 'Unknown'} (${sendMode})`);
        try {
            await tauriClient.setSendMode(sendMode);
            console.log('✅ Send mode set in C++ backend');
            // Apply USB padding if USB-Optimized mode
            if (sendMode === 3) {
                await _applyUsbPadding();
                await _applyUsbMinGap();
            }
        } catch (err) {
            console.error('❌ Failed to set send mode:', err);
            showToast('Failed to set send mode: ' + err, 'error');
            return;
        }
        
        // Start publishing (C++ handles duration/repeat internally)
        tauriClient.start(0, { interfaceIndex: serverData.meta.interfaceIndex });
        
        // Show timer display for timed mode
        if (durationSettings.durationSeconds > 0) {
            _showTimerDisplay();
            _startStatusPolling(); // Poll backend for remaining time
            
            const repeatInfo = durationSettings.repeatEnabled 
                ? (durationSettings.repeatInfinite ? ' (∞ repeat)' : ` (${durationSettings.repeatCount}x repeat)`)
                : ' (one-time)';
            showToast(`Publishing for ${durationSettings.durationSeconds}s${repeatInfo}...`, 'info');
        }
    }
}

/**
 * Stop publishing SV data
 * @memberof module:PublishPanel
 */
export function stopPublishing() {
    if (!_isPublishing) return;
    
    // Stop status polling
    _stopStatusPolling();
    _hideTimerDisplay();
    
    tauriClient.stop();
}

/**
 * Start polling backend for duration/repeat status
 */
function _startStatusPolling() {
    _stopStatusPolling(); // Clear any existing
    
    _statusPollingInterval = setInterval(async () => {
        try {
            // Get remaining time from C++ backend
            const remaining = await tauriClient.getRemainingSeconds();
            const cycle = await tauriClient.getCurrentRepeatCycle();
            const complete = await tauriClient.isDurationComplete();
            
            // Update timer display with backend values
            _updateTimerText(remaining);
            
            // Update repeat badge
            if (_elements.repeatBadge && cycle > 0) {
                _elements.repeatBadge.style.display = 'inline';
                _elements.repeatBadge.textContent = `Cycle ${cycle}`;
            }
            
            // Check if backend says duration is complete
            if (complete && !_isPublishing) {
                _stopStatusPolling();
                _hideTimerDisplay();
            }
        } catch (err) {
            // Ignore polling errors
        }
    }, 500); // Poll every 500ms
}

/**
 * Stop status polling
 */
function _stopStatusPolling() {
    if (_statusPollingInterval) {
        clearInterval(_statusPollingInterval);
        _statusPollingInterval = null;
    }
}

/**
 * Show timer display
 */
function _showTimerDisplay() {
    if (_elements.timerDisplay) {
        _elements.timerDisplay.style.display = 'flex';
    }
}

/**
 * Update timer display text
 */
function _updateTimerText(seconds) {
    if (_elements.timerText) {
        if (seconds >= 60) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            _elements.timerText.textContent = `${mins}m ${secs}s remaining`;
        } else {
            _elements.timerText.textContent = `${seconds}s remaining`;
        }
    }
}

/**
 * Hide the timer display
 */
function _hideTimerDisplay() {
    if (_elements.timerDisplay) {
        _elements.timerDisplay.style.display = 'none';
    }
    if (_elements.repeatBadge) {
        _elements.repeatBadge.style.display = 'none';
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Check if currently publishing
 * @memberof module:PublishPanel
 * @returns {boolean}
 */
export function isPublishing() {
    return _isPublishing;
}

/**
 * Reset statistics
 * @memberof module:PublishPanel
 */
export function resetStats() {
    store.resetStats();
    showToast('Statistics reset');
}

// Export module
export const PublishPanel = {
    init,
    getTemplate,
    startPublishing,
    stopPublishing,
    isPublishing,
    resetStats
};

export default PublishPanel;
