/**
 * @module PublishMode
 * @file components/PublishMode.js
 * @description Toggle wrapper — switches between Single Stream and Multi Stream mode.
 * Renders a pill-toggle at the top, then shows the appropriate panel below.
 *
 * Single Stream → PublishPanel  (existing single-publisher)
 * Multi Stream  → MultiPublisher (multiple SV streams)
 *
 * @author SV-PUB Team
 * @date 2025
 */

import PublishPanel from './PublishPanel.js';
import MultiPublisher from './MultiPublisher.js';

let _initialized = false;
let _mode = 'single'; // 'single' | 'multi'

const _el = {};

function getTemplate() {
    return `
        <div class="publish-mode-wrapper">
            <!-- Toggle Switch -->
            <div class="pm-toggle">
                <button class="pm-toggle-btn pm-toggle-btn--active" data-mode="single">
                    Single Stream
                </button>
                <button class="pm-toggle-btn" data-mode="multi">
                    Multi Stream
                </button>
            </div>

            <!-- Panel containers — only one visible at a time -->
            <div class="pm-panel" id="pmSinglePanel"></div>
            <div class="pm-panel pm-panel--hidden" id="pmMultiPanel"></div>
        </div>
    `;
}

function switchMode(mode) {
    if (mode === _mode) return;
    _mode = mode;

    // Toggle active button
    _el.btns.forEach(btn => {
        btn.classList.toggle('pm-toggle-btn--active', btn.dataset.mode === mode);
    });

    // Show/hide panels
    _el.singlePanel.classList.toggle('pm-panel--hidden', mode !== 'single');
    _el.multiPanel.classList.toggle('pm-panel--hidden', mode !== 'multi');

    console.log(`[PublishMode] Switched to: ${mode}`);
}

function init(container) {
    if (_initialized) return;
    if (!container) return;

    container.innerHTML = getTemplate();

    _el.singlePanel = document.getElementById('pmSinglePanel');
    _el.multiPanel = document.getElementById('pmMultiPanel');
    _el.btns = container.querySelectorAll('.pm-toggle-btn');

    // Bind toggle clicks
    _el.btns.forEach(btn => {
        btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // Initialize both panels into their containers
    PublishPanel.init(_el.singlePanel);
    MultiPublisher.init(_el.multiPanel);

    _initialized = true;
    console.log('[PublishMode] ✅ Initialized (default: single)');
}

export const PublishMode = { init, getTemplate };
export default PublishMode;
