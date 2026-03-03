/**
 * @module Statistics
 * @file components/Statistics.js
 * @description Statistics Display Module for real-time network stats.
 * Shows packets sent, data rate, errors, uptime, and sample counter.
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

let initialized = false;
const elements = {};

// ============================================================================
// DOM TEMPLATE
// ============================================================================

/**
 * Get the HTML template for statistics display
 * @memberof module:Statistics
 * @returns {string} HTML template string
 */
export function getTemplate() {
    return `
        <section class="card" id="statistics-module">
            <div class="card-header">
                <h2>Statistics</h2>
                <button class="btn btn-small btn-outline" id="resetStatsBtn">Reset</button>
            </div>
            <div class="card-body">
                <!-- Primary Stats Grid -->
                <div class="stats-grid">
                    <div class="stat-box">
                        <span class="stat-value" id="stat-packetsSent">0</span>
                        <span class="stat-label">Packets Sent</span>
                    </div>
                    <div class="stat-box highlight">
                        <span class="stat-value" id="stat-dataRate">0 bps</span>
                        <span class="stat-label">Data Rate</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-value" id="stat-pps">0</span>
                        <span class="stat-label">Packets/sec</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-value" id="stat-duration">00:00:00</span>
                        <span class="stat-label">Duration</span>
                    </div>
                </div>

                <!-- Secondary Stats (Expanded Info) -->
                <div class="stats-details" id="statsDetails">
                    <div class="stats-row">
                        <span class="stats-label">Bytes Sent:</span>
                        <span class="stats-value" id="stat-bytesSent">0 B</span>
                    </div>
                    <div class="stats-row">
                        <span class="stats-label">Peak Rate:</span>
                        <span class="stats-value" id="stat-peakRate">0 bps</span>
                    </div>
                    <div class="stats-row">
                        <span class="stats-label">Avg Packet Size:</span>
                        <span class="stats-value" id="stat-avgPacketSize">0 B</span>
                    </div>
                    <div class="stats-row">
                        <span class="stats-label">Failed Packets:</span>
                        <span class="stats-value" id="stat-packetsFailed">0</span>
                    </div>
                </div>

                <!-- Sample Counter Progress -->
                <div class="sample-counter">
                    <div class="counter-header">
                        <span>Sample Counter (smpCnt)</span>
                        <span id="stat-smpCntValue">0 / 4000</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" id="stat-smpCntProgress"></div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

/**
 * Format bytes to human-readable string (B, KB, MB, GB)
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);
    
    return value.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

/**
 * Format bits per second to human-readable rate
 * Auto-scales: bps → Kbps → Mbps → Gbps
 * @param {number} bps - Bits per second
 * @returns {string} Formatted rate string
 */
function formatRate(bps) {
    if (bps === 0) return '0 bps';
    
    if (bps >= 1e9) {
        return (bps / 1e9).toFixed(2) + ' Gbps';
    } else if (bps >= 1e6) {
        return (bps / 1e6).toFixed(2) + ' Mbps';
    } else if (bps >= 1e3) {
        return (bps / 1e3).toFixed(2) + ' Kbps';
    }
    return bps.toFixed(0) + ' bps';
}

/**
 * Format duration in seconds to HH:MM:SS
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time string
 */
function formatDuration(seconds) {
    // Round to nearest second for better UX (7.9s shows as 8s, not 7s)
    const totalSeconds = Math.round(seconds);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    return [hrs, mins, secs]
        .map(v => v.toString().padStart(2, '0'))
        .join(':');
}

/**
 * Format large numbers with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
    return num.toLocaleString();
}

// ============================================================================
// DOM OPERATIONS
// ============================================================================

/**
 * Cache all DOM element references
 */
function cacheElements() {
    elements.container = document.getElementById('statistics-module');
    elements.resetBtn = document.getElementById('resetStatsBtn');
    elements.statsDetails = document.getElementById('statsDetails');
    
    // Primary stats
    elements.packetsSent = document.getElementById('stat-packetsSent');
    elements.dataRate = document.getElementById('stat-dataRate');
    elements.pps = document.getElementById('stat-pps');
    elements.duration = document.getElementById('stat-duration');
    
    // Secondary stats
    elements.bytesSent = document.getElementById('stat-bytesSent');
    elements.peakRate = document.getElementById('stat-peakRate');
    elements.avgPacketSize = document.getElementById('stat-avgPacketSize');
    elements.packetsFailed = document.getElementById('stat-packetsFailed');
    
    // Sample counter
    elements.smpCntValue = document.getElementById('stat-smpCntValue');
    elements.smpCntProgress = document.getElementById('stat-smpCntProgress');
}

/**
 * Update all stats display elements
 * @param {Object} stats - Statistics object from server
 */
function updateStatsDisplay(stats) {
    if (!elements.container) return;
    
    // Primary stats
    if (stats.packetsSent !== undefined && elements.packetsSent) {
        elements.packetsSent.textContent = formatNumber(stats.packetsSent);
    }
    
    // Data rate - prefer native formatted rate or calculate from bps
    if (elements.dataRate) {
        if (stats.rateFormatted) {
            elements.dataRate.textContent = stats.rateFormatted;
        } else if (stats.currentBps !== undefined) {
            elements.dataRate.textContent = formatRate(stats.currentBps);
        } else if (stats.currentMbps !== undefined) {
            elements.dataRate.textContent = stats.currentMbps.toFixed(2) + ' Mbps';
        }
    }
    
    // Packets per second
    if (stats.currentPps !== undefined && elements.pps) {
        elements.pps.textContent = formatNumber(Math.round(stats.currentPps));
    } else if (stats.currentRate !== undefined && elements.pps) {
        // Fallback to legacy currentRate
        elements.pps.textContent = formatNumber(stats.currentRate);
    }
    
    // Duration
    if (stats.durationSec !== undefined && elements.duration) {
        elements.duration.textContent = formatDuration(stats.durationSec);
    } else if (stats.uptime !== undefined && elements.duration) {
        // Fallback to legacy uptime (in ms)
        elements.duration.textContent = formatDuration(stats.uptime / 1000);
    }
    
    // Secondary stats
    if (stats.bytesSent !== undefined && elements.bytesSent) {
        elements.bytesSent.textContent = formatBytes(stats.bytesSent);
    }
    
    if (elements.peakRate) {
        if (stats.peakBps !== undefined) {
            elements.peakRate.textContent = formatRate(stats.peakBps);
        } else if (stats.peakMbps !== undefined) {
            elements.peakRate.textContent = stats.peakMbps.toFixed(2) + ' Mbps';
        }
    }
    
    if (stats.avgPacketSize !== undefined && elements.avgPacketSize) {
        elements.avgPacketSize.textContent = formatBytes(stats.avgPacketSize);
    }
    
    if (stats.packetsFailed !== undefined && elements.packetsFailed) {
        elements.packetsFailed.textContent = formatNumber(stats.packetsFailed);
        // Highlight if there are errors
        if (stats.packetsFailed > 0) {
            elements.packetsFailed.classList.add('error');
        } else {
            elements.packetsFailed.classList.remove('error');
        }
    }
    
    // Sample counter
    const smpCnt = stats.smpCnt || 0;
    const smpRate = stats.configuredRate || store.config.sampleRate || 4000;
    
    if (elements.smpCntValue) {
        elements.smpCntValue.textContent = `${formatNumber(smpCnt)} / ${formatNumber(smpRate)}`;
    }
    
    if (elements.smpCntProgress) {
        const progressPercent = (smpCnt / smpRate) * 100;
        elements.smpCntProgress.style.width = `${progressPercent}%`;
    }
}

/**
 * Reset all stats to zero
 */
function resetStatsDisplay() {
    updateStatsDisplay({
        packetsSent: 0,
        packetsFailed: 0,
        bytesSent: 0,
        currentBps: 0,
        currentPps: 0,
        peakBps: 0,
        avgPacketSize: 0,
        durationSec: 0,
        smpCnt: 0,
        configuredRate: store.config.sampleRate
    });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle reset button click
 */
function handleResetClick() {
    // Reset display immediately
    resetStatsDisplay();
    
    // Notify server to reset stats
    store.setData({ 
        stats: { 
            packetsSent: 0, 
            currentRate: 0, 
            errors: 0, 
            uptime: 0, 
            smpCnt: 0 
        } 
    });
    
    // Reset stats via Tauri (if available)
    if (window.__TAURI__) {
        window.__TAURI__.core.invoke('reset_stats').catch(err => {
            console.log('[Statistics] Reset stats error (may not be implemented):', err);
        });
    }
    
    showToast('Statistics reset', 'info');
    console.log('[Statistics] Stats reset');
}

/**
 * Bind all event listeners
 */
function bindEvents() {
    if (elements.resetBtn) {
        elements.resetBtn.addEventListener('click', handleResetClick);
    }
}

// ============================================================================
// STORE SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to store changes for stats updates
 */
function setupStoreSubscriptions() {
    // Subscribe to all data changes (including stats)
    // The store notifies 'data.*' subscribers when any data changes
    store.subscribe('data.*', (data, changedPath) => {
        // Only process if it's a stats-related change
        if (changedPath && changedPath.startsWith('data.stats')) {
            console.log('[Statistics] Stats changed:', changedPath, data.stats);
            if (data.stats) {
                updateStatsDisplay(data.stats);
            }
        }
    });
    
    // Also try direct subscription to specific stat paths
    const statPaths = [
        'data.stats.packetsSent',
        'data.stats.currentBps',
        'data.stats.currentPps',
        'data.stats.bytesSent',
        'data.stats.durationSec',
        'data.stats.smpCnt'
    ];
    
    statPaths.forEach(path => {
        store.subscribe(path, (value, changedPath) => {
            console.log(`[Statistics] ${changedPath} = ${value}`);
            // Get full stats object and update
            const stats = store.data.stats;
            if (stats) {
                updateStatsDisplay(stats);
            }
        });
    });
}

// ============================================================================
// TAURI MESSAGE HANDLER
// ============================================================================

/**
 * Handle incoming stats message from Tauri
 * @memberof module:Statistics
 * @param {Object} data - Stats data from server
 */
export function handleStatsMessage(data) {
    // Update store (which triggers UI update via subscription)
    store.setData({ stats: data });
    
    // Also update display directly for immediate feedback
    updateStatsDisplay(data);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the Statistics module
 * @memberof module:Statistics
 * @param {HTMLElement} container - Container element to render into
 */
export function init(container) {
    if (initialized) {
        console.warn('[Statistics] Already initialized');
        return;
    }
    
    // Render template
    if (container) {
        container.innerHTML = getTemplate();
    } else {
        // Try to find default container
        const defaultContainer = document.getElementById('statistics-container');
        if (defaultContainer) {
            defaultContainer.innerHTML = getTemplate();
        } else {
            console.error('[Statistics] No container found for Statistics module');
            return;
        }
    }
    
    // Cache elements
    cacheElements();
    
    // Bind events
    bindEvents();
    
    // Setup store subscriptions
    setupStoreSubscriptions();
    
    // Register for tauriClient stats events - THIS IS KEY!
    tauriClient.on('stats', (stats) => {
        console.log('[Statistics] Received stats from tauriClient:', stats);
        updateStatsDisplay(stats);
        // Also update store for other components
        store.setData({ stats });
    });
    
    // Initial display reset
    resetStatsDisplay();
    
    initialized = true;
    console.log('[Statistics] Module initialized');
}

/**
 * Destroy the module (cleanup)
 * @memberof module:Statistics
 */
export function destroy() {
    if (elements.resetBtn) {
        elements.resetBtn.removeEventListener('click', handleResetClick);
    }
    
    // Clear cached elements
    Object.keys(elements).forEach(key => delete elements[key]);
    
    initialized = false;
    console.log('[Statistics] Module destroyed');
}

// ============================================================================
// PUBLIC API
// ============================================================================

export default {
    init,
    destroy,
    getTemplate,
    handleStatsMessage,
    updateStatsDisplay,
    resetStatsDisplay,
    // Utilities
    formatBytes,
    formatRate,
    formatDuration
};
