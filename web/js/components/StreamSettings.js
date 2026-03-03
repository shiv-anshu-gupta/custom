/**
 * @module StreamSettings
 * @file components/StreamSettings.js
 * @description Stream & Timing Settings for SV publishing.
 * Handles network interface, frequency, samples per cycle, and timing.
 * 
 * @author SV-PUB Team
 * @date 2025
 */

import store from '../store/index.js';
import { showToast } from '../plugins/toast.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let initialized = false;
const elements = {};

// ============================================================================
// DOM TEMPLATE
// ============================================================================

/**
 * Get the HTML template for this module
 * @memberof module:StreamSettings
 * @returns {string} HTML template string
 */
export function getTemplate() {
    return `
        <section class="card" id="stream-settings-module">
            <div class="card-header">
                <h2>Stream Settings</h2>
                <span class="card-subtitle">Publishing & Timing</span>
            </div>
            <div class="card-body">
                <div class="form-grid stream-settings-grid">
                    <!-- Network Interface - Full Width -->
                    <div class="form-group full-width">
                        <label for="networkInterface">
                            <span class="label-icon">🔌</span>
                            Network Interface
                        </label>
                        <select id="networkInterface">
                            <option value="">Loading interfaces...</option>
                        </select>
                        <span class="input-hint">Ethernet adapter for packet transmission</span>
                    </div>

                    <!-- Frequency -->
                    <div class="form-group">
                        <label for="frequency">
                            <span class="label-icon">〰️</span>
                            System Frequency
                        </label>
                        <select id="frequency">
                            <option value="50">50 Hz (Europe, Asia)</option>
                            <option value="60" selected>60 Hz (Americas)</option>
                        </select>
                        <span class="input-hint">Power system frequency</span>
                    </div>

                    <!-- Samples per Cycle -->
                    <div class="form-group">
                        <label for="samplesPerCycleSelect">
                            <span class="label-icon">📊</span>
                            Samples / Cycle
                        </label>
                        <div class="samples-per-cycle-wrapper">
                            <select id="samplesPerCycleSelect">
                                <option value="80" selected>80 (Protection)</option>
                                <option value="256">256 (Metering)</option>
                            </select>
                            <input type="number" id="samplesPerCycleInput" value="80" min="1" max="50001" class="hidden" placeholder="Custom value">
                        </div>
                        <span class="input-hint" id="samplesPerCycleHint">IEC 9-2LE standard</span>
                    </div>

                    <!-- Sample Rate (Read-only, calculated) -->
                    <div class="form-group">
                        <label for="smpRate">
                            <span class="label-icon">⏱️</span>
                            Sample Rate
                        </label>
                        <div class="input-with-unit">
                            <input type="number" id="smpRate" value="4800" readonly>
                            <span class="unit">smp/s</span>
                        </div>
                        <span class="input-hint" id="smpRateHint">= <span id="smpRateFormula">80 × 60</span></span>
                    </div>

                    <!-- datSet (Optional) -->
                    <div class="form-group full-width">
                        <label for="datSet">
                            <span class="label-icon">📑</span>
                            datSet <span class="label-optional">(Optional)</span>
                        </label>
                        <input type="text" id="datSet" placeholder="Not required for IEC 9-2LE">
                        <span class="input-hint">Dataset reference - leave empty for 9-2 LE</span>
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
 * Initialize the module
 * @memberof module:StreamSettings
 * @param {HTMLElement} container - Container element to render into (optional)
 */
export function init(container = null) {
    if (initialized) {
        console.warn('[StreamSettings] Already initialized');
        return;
    }

    // If container provided, inject template
    if (container) {
        container.innerHTML = getTemplate();
    }

    // Cache DOM elements
    elements.interfaceSelect = document.getElementById('networkInterface');
    elements.frequency = document.getElementById('frequency');
    elements.samplesPerCycleSelect = document.getElementById('samplesPerCycleSelect');
    elements.samplesPerCycleInput = document.getElementById('samplesPerCycleInput');
    elements.samplesPerCycleHint = document.getElementById('samplesPerCycleHint');
    elements.smpRate = document.getElementById('smpRate');
    elements.smpRateFormula = document.getElementById('smpRateFormula');
    elements.datSet = document.getElementById('datSet');

    // Bind events
    bindEvents();

    // Load network interfaces from backend
    loadNetworkInterfaces();

    // Build samples per cycle dropdown for current standard
    rebuildSamplesPerCycleDropdown();

    // Set initial values from store
    syncFromStore();

    // Subscribe to store changes
    store.subscribe([
        'config.interfaceIndex',
        'config.frequency',
        'config.samplesPerCycle',
        'config.sampleRate',
        'config.datSet',
        'config.standard'
    ], syncFromStore);

    initialized = true;
    console.log('[StreamSettings] Initialized');
}

// ============================================================================
// EVENT BINDING
// ============================================================================

function bindEvents() {
    // Network interface change
    elements.interfaceSelect?.addEventListener('change', (e) => {
        const index = parseInt(e.target.value) || 0;
        const option = e.target.options[e.target.selectedIndex];
        store.setConfig({ 
            interfaceIndex: index,
            interfaceName: option?.textContent || ''
        });
        
        // Auto-detect and set source MAC from selected interface
        if (option?.dataset.mac) {
            console.log('[StreamSettings] Interface changed, setting srcMAC:', option.dataset.mac);
            store.setConfig({ srcMAC: option.dataset.mac });
        } else {
            console.warn('[StreamSettings] No MAC address for selected interface');
        }
    });

    // Frequency change
    elements.frequency?.addEventListener('change', (e) => {
        const freq = parseInt(e.target.value);
        store.setConfig({ frequency: freq });
        updateSampleRate();
    });

    // Samples per cycle change
    elements.samplesPerCycleSelect?.addEventListener('change', (e) => {
        const value = e.target.value;
        
        if (value === 'custom') {
            // Show custom input field
            elements.samplesPerCycleInput?.classList.remove('hidden');
            elements.samplesPerCycleInput?.focus();
        } else {
            // Hide custom input and update store
            elements.samplesPerCycleInput?.classList.add('hidden');
            const spc = parseInt(value);
            store.setConfig({ samplesPerCycle: spc });
            updateSampleRate();
        }
    });

    // Custom samples per cycle input
    elements.samplesPerCycleInput?.addEventListener('change', (e) => {
        const value = parseInt(e.target.value);
        if (value && value >= 1 && value <= 50001) {
            store.setConfig({ samplesPerCycle: value });
            updateSampleRate();
        } else {
            showToast('Samples per cycle must be between 1 and 50001', 'error');
            e.target.value = store.get('config.samplesPerCycle') || 80;
        }
    });

    // datSet change
    elements.datSet?.addEventListener('change', (e) => {
        store.setConfig({ datSet: e.target.value.trim() });
    });
}

// ============================================================================
// NETWORK INTERFACES
// ============================================================================

/**
 * Load network interfaces from Tauri backend
 */
async function loadNetworkInterfaces() {
    if (!elements.interfaceSelect) return;

    try {
        let interfaces = [];
        if (window.__TAURI__) {
            interfaces = await window.__TAURI__.core.invoke('get_interfaces');
        } else {
            // Fallback for development without Tauri
            const response = await fetch('/api/interfaces');
            const data = await response.json();
            interfaces = data.interfaces || data;
        }
        
        elements.interfaceSelect.innerHTML = '';
        
        if (!interfaces || interfaces.length === 0) {
            elements.interfaceSelect.innerHTML = '<option value="">No interfaces found</option>';
            return;
        }

        let selectedIndex = 0;
        interfaces.forEach((iface, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = iface.description || iface.displayName || iface.name;
            
            // Auto-select Ethernet interface
            if (iface.description?.toLowerCase().includes('ethernet')) {
                option.selected = true;
                selectedIndex = index;
            }
            
            // Store MAC address as data attribute
            if (iface.mac) {
                option.dataset.mac = iface.mac;
            }
            
            elements.interfaceSelect.appendChild(option);
        });

        // Update store with selected interface
        const selectedOption = elements.interfaceSelect.options[elements.interfaceSelect.selectedIndex];
        store.setConfig({
            interfaceIndex: selectedIndex,
            interfaceName: selectedOption?.textContent || ''
        });

        // Auto-set source MAC from selected interface
        if (selectedOption?.dataset.mac) {
            store.setConfig({ srcMAC: selectedOption.dataset.mac });
        }

        // Debug: Log full interface data from backend
        console.log('[StreamSettings] Loaded interfaces:', interfaces);
        interfaces.forEach((iface, i) => {
            console.log(`[StreamSettings] Interface ${i}: name="${iface.name}", desc="${iface.description}", mac="${iface.mac}"`);
        });
    } catch (err) {
        console.error('[StreamSettings] Failed to load interfaces:', err);
        elements.interfaceSelect.innerHTML = '<option value="">Failed to load interfaces</option>';
    }
}

// ============================================================================
// SAMPLES PER CYCLE DROPDOWN
// ============================================================================

/**
 * Rebuild samples per cycle dropdown based on current standard
 * 
 * Different standards have different allowed values:
 * - 9-2LE: Fixed values (80, 256) - NO custom allowed
 * - 9-2: More options + Custom allowed
 * - 61869: Flexible options + Custom allowed
 */
function rebuildSamplesPerCycleDropdown() {
    if (!elements.samplesPerCycleSelect) return;

    const standard = store.get('config.standard') || '9-2LE';
    const currentValue = store.get('config.samplesPerCycle') || 80;

    // Clear current options
    elements.samplesPerCycleSelect.innerHTML = '';

    // Options and settings based on standard
    let options = [];
    let allowCustom = false;
    let hintText = '';

    if (standard === '9-2LE') {
        // 9-2 LE: Fixed options only (80 for protection, 256 for metering)
        options = [
            { value: 80, label: '80 (Protection)' },
            { value: 256, label: '256 (Metering)' }
        ];
        allowCustom = false;
        hintText = 'Fixed for IEC 9-2LE';
    } else if (standard === '9-2') {
        // 9-2: More flexible options + custom
        options = [
            { value: 80, label: '80 (Protection)' },
            { value: 96, label: '96 (Alternative)' },
            { value: 256, label: '256 (Metering)' },
            { value: 512, label: '512' },
            { value: 1024, label: '1024' },
            { value: 2048, label: '2048' }
        ];
        allowCustom = true;
        hintText = 'Configurable for IEC 9-2';
    } else {
        // IEC 61869-9: Flexible options including power quality + custom
        options = [
            { value: 80, label: '80 (Protection)' },
            { value: 96, label: '96' },
            { value: 256, label: '256 (Metering)' },
            { value: 512, label: '512' },
            { value: 1024, label: '1024' },
            { value: 2048, label: '2048' },
            { value: 4000, label: '4000 (Power Quality)' },
            { value: 4800, label: '4800' }
        ];
        allowCustom = true;
        hintText = 'Flexible for IEC 61869-9 - custom values allowed';
    }

    // Check if current value is in predefined options
    const currentInOptions = options.find(o => o.value === currentValue);

    // Add predefined options to select
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === currentValue) {
            option.selected = true;
        }
        elements.samplesPerCycleSelect.appendChild(option);
    });

    // Add "Custom..." option for flexible standards
    if (allowCustom) {
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom...';
        
        // If current value is custom (not in predefined), select custom
        if (!currentInOptions) {
            customOption.selected = true;
        }
        elements.samplesPerCycleSelect.appendChild(customOption);
    }

    // Update hint text
    if (elements.samplesPerCycleHint) {
        elements.samplesPerCycleHint.textContent = hintText;
        if (allowCustom) {
            elements.samplesPerCycleHint.classList.remove('hint-locked');
        } else {
            elements.samplesPerCycleHint.classList.add('hint-locked');
        }
    }

    // Handle custom input visibility
    if (elements.samplesPerCycleInput) {
        if (allowCustom && !currentInOptions) {
            // Show custom input with current value
            elements.samplesPerCycleInput.classList.remove('hidden');
            elements.samplesPerCycleInput.value = currentValue;
        } else {
            // Hide custom input
            elements.samplesPerCycleInput.classList.add('hidden');
        }
    }

    // If current value not in options and custom not allowed, reset to first option
    if (!currentInOptions && !allowCustom) {
        elements.samplesPerCycleSelect.value = options[0].value;
        store.setConfig({ samplesPerCycle: options[0].value });
        updateSampleRate();
    } else if (currentInOptions) {
        // Set the select to current value
        elements.samplesPerCycleSelect.value = currentValue;
    } else if (allowCustom && !currentInOptions) {
        // Custom value selected
        elements.samplesPerCycleSelect.value = 'custom';
    }

    console.log(`[StreamSettings] Dropdown rebuilt for ${standard}, current: ${currentValue}, options: ${options.map(o => o.value).join(',')}`);
}

// ============================================================================
// SAMPLE RATE CALCULATION
// ============================================================================

/**
 * Update sample rate based on frequency and samples per cycle
 */
function updateSampleRate() {
    const frequency = store.get('config.frequency') || 60;
    const samplesPerCycle = store.get('config.samplesPerCycle') || 80;
    const sampleRate = frequency * samplesPerCycle;

    store.setConfig({ sampleRate });

    if (elements.smpRate) {
        elements.smpRate.value = sampleRate;
    }
    if (elements.smpRateFormula) {
        elements.smpRateFormula.textContent = `${samplesPerCycle} × ${frequency}`;
    }
}

// ============================================================================
// SYNC FROM STORE
// ============================================================================

function syncFromStore() {
    if (elements.interfaceSelect) {
        elements.interfaceSelect.value = store.get('config.interfaceIndex') || 0;
    }
    if (elements.frequency) {
        elements.frequency.value = store.get('config.frequency') || 60;
    }
    if (elements.datSet) {
        elements.datSet.value = store.get('config.datSet') || '';
    }

    // IMPORTANT: Rebuild dropdown FIRST when standard changes
    // This ensures the dropdown has correct options before setting value
    rebuildSamplesPerCycleDropdown();

    // Update sample rate display
    updateSampleRate();
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get current stream settings
 * @memberof module:StreamSettings
 * @returns {Object} Stream settings object
 */
export function getSettings() {
    return {
        interfaceIndex: store.get('config.interfaceIndex'),
        interfaceName: store.get('config.interfaceName'),
        frequency: store.get('config.frequency'),
        samplesPerCycle: store.get('config.samplesPerCycle'),
        sampleRate: store.get('config.sampleRate'),
        datSet: store.get('config.datSet')
    };
}

/**
 * Refresh network interfaces list
 * @memberof module:StreamSettings
 */
export function refreshInterfaces() {
    loadNetworkInterfaces();
}

/**
 * Destroy module (cleanup)
 * @memberof module:StreamSettings
 */
export function destroy() {
    initialized = false;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
    init,
    getTemplate,
    getSettings,
    refreshInterfaces,
    destroy
};
