/**
 * @file configManager.js
 * @fileoverview Configuration Save/Load Plugin
 * @module configManager
 * @author SV-PUB Team
 * @description
 * Provides configuration persistence - save to JSON file, load from JSON file.
 * 
 * **Features:**
 * - Export current config to JSON file
 * - Import config from JSON file
 * - Apply config to UI elements
 * 
 * @example
 * import { initConfigButtons, saveConfig, loadConfig } from './plugins/configManager.js';
 * initConfigButtons(); // Setup save/load button handlers
 */

import { showToast } from './toast.js';
import { formatDateForFilename } from '../utils/formatters.js';
import { updatePreview } from '../components/preview.js';

/**
 * Initialize config save/load buttons
 * @memberof module:configManager
 */
export function initConfigButtons() {
    const saveBtn = document.getElementById('saveConfigBtn');
    const loadBtn = document.getElementById('loadConfigBtn');

    if (saveBtn) saveBtn.addEventListener('click', saveConfig);
    if (loadBtn) loadBtn.addEventListener('click', loadConfig);
}

/**
 * Save current configuration to a JSON file
 * @memberof module:configManager
 */
export function saveConfig() {
    // Gather all configuration values
    const config = {
        // Standard
        standard: document.querySelector('input[name="standard"]:checked')?.value,

        // Network Settings
        srcMac: document.getElementById('srcMac').value,
        destMac: document.getElementById('destMac').value,
        appId: document.getElementById('appId').value,
        vlanId: document.getElementById('vlanId').value,

        // SV Parameters
        svId: document.getElementById('svId').value,
        datSet: document.getElementById('datSet').value,
        frequency: document.getElementById('frequency').value,
        smpRate: document.getElementById('smpRate').value,
        confRev: document.getElementById('confRev').value,
        smpSynch: document.getElementById('smpSynch').value,

        // Equations
        equations: {
            Va: document.getElementById('eqVa').value,
            Vb: document.getElementById('eqVb').value,
            Vc: document.getElementById('eqVc').value,
            Vn: document.getElementById('eqVn').value,
            Ia: document.getElementById('eqIa').value,
            Ib: document.getElementById('eqIb').value,
            Ic: document.getElementById('eqIc').value,
            In: document.getElementById('eqIn').value
        },

        // Playback options
        loopPlayback: document.getElementById('loopPlayback')?.checked,
        playbackSpeed: document.getElementById('playbackSpeed')?.value,

        // Metadata
        savedAt: new Date().toISOString(),
        version: '1.0'
    };

    // Convert to JSON
    const configJson = JSON.stringify(config, null, 2);

    // Create download
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'sv-publisher-config-' + formatDateForFilename() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Configuration saved to file');
}

/**
 * Load configuration from a JSON file
 * @memberof module:configManager
 */
export function loadConfig() {
    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = function(event) {
            try {
                const config = JSON.parse(event.target.result);
                applyConfig(config);
                showToast('Configuration loaded: ' + file.name);
            } catch (error) {
                showToast('Invalid configuration file', 'error');
                console.error('Config load error:', error);
            }
        };

        reader.readAsText(file);
    });

    fileInput.click();
}

/**
 * Apply configuration object to form inputs
 * @memberof module:configManager
 * @param {Object} config - Configuration object
 */
export function applyConfig(config) {
    // Apply Standard
    if (config.standard) {
        const radioCards = document.querySelectorAll('.radio-card');
        radioCards.forEach(function(card) {
            const radio = card.querySelector('input[type="radio"]');
            if (radio.value === config.standard) {
                radioCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                radio.checked = true;
            }
        });
    }

    // Apply Network Settings
    if (config.srcMac) document.getElementById('srcMac').value = config.srcMac;
    if (config.destMac) document.getElementById('destMac').value = config.destMac;
    if (config.appId) document.getElementById('appId').value = config.appId;
    if (config.vlanId) document.getElementById('vlanId').value = config.vlanId;

    // Apply SV Parameters
    if (config.svId) document.getElementById('svId').value = config.svId;
    if (config.datSet) document.getElementById('datSet').value = config.datSet;
    if (config.frequency) document.getElementById('frequency').value = config.frequency;
    if (config.smpRate) document.getElementById('smpRate').value = config.smpRate;
    if (config.confRev) document.getElementById('confRev').value = config.confRev;
    if (config.smpSynch) document.getElementById('smpSynch').value = config.smpSynch;

    // Apply Equations
    if (config.equations) {
        if (config.equations.Va) document.getElementById('eqVa').value = config.equations.Va;
        if (config.equations.Vb) document.getElementById('eqVb').value = config.equations.Vb;
        if (config.equations.Vc) document.getElementById('eqVc').value = config.equations.Vc;
        if (config.equations.Vn) document.getElementById('eqVn').value = config.equations.Vn;
        if (config.equations.Ia) document.getElementById('eqIa').value = config.equations.Ia;
        if (config.equations.Ib) document.getElementById('eqIb').value = config.equations.Ib;
        if (config.equations.Ic) document.getElementById('eqIc').value = config.equations.Ic;
        if (config.equations.In) document.getElementById('eqIn').value = config.equations.In;
    }

    // Apply Playback options
    if (config.loopPlayback !== undefined) {
        const loopEl = document.getElementById('loopPlayback');
        if (loopEl) loopEl.checked = config.loopPlayback;
    }
    if (config.playbackSpeed) {
        const speedEl = document.getElementById('playbackSpeed');
        if (speedEl) speedEl.value = config.playbackSpeed;
    }

    // Update preview
    updatePreview();
}
