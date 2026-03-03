/**
 * @module ChannelsDisplay
 * @file components/ChannelsDisplay.js
 * @description Active Channels Display Component.
 * Shows configured channels with equations, color-coded by type.
 * Supports mouse-based drag to FrameViewer.
 * 
 * @author SV-PUB Team
 * @date 2025
 */

import store from '../store/index.js';
import { startDrag } from '../utils/dragManager.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let _initialized = false;
const _elements = {};

// ============================================================================
// DOM TEMPLATE
// ============================================================================

/**
 * Get the HTML template for channels display
 * @memberof module:ChannelsDisplay
 * @returns {string} HTML template string
 */
export function getTemplate() {
    const channels = store.getChannels ? store.getChannels() : [];
    
    return `
        <section class="card channels-display-card" id="channels-display-module">
            <div class="card-header">
                <h2>Channels</h2>
            </div>
            <div class="card-body">
                <div class="channels-list" id="channelsList">
                    ${getChannelsListHTML(channels)}
                </div>
            </div>
        </section>
    `;
}

/**
 * Generate channels list HTML
 * - data-channel stores the channel ID for drag handling
 * - No draggable attribute - we use mouse events instead
 */
function getChannelsListHTML(channels) {
    if (!channels || channels.length === 0) {
        return `
            <div class="channels-empty">
                <span class="empty-icon">📭</span>
                <span>No channels configured</span>
            </div>
        `;
    }
    
    // Each channel item can be dragged using mouse events
    return channels.map(ch => `
        <div class="channel-item channel-draggable-source" 
             data-channel="${ch.id}"
             data-channel-type="${ch.type}">
            <span class="drag-indicator">⋮⋮</span>
            <span class="channel-color" style="background: ${ch.color || getDefaultColor(ch.type)}"></span>
            <span class="channel-name">${ch.id}</span>
            <span class="channel-equation" title="${ch.equation || ch.defaultEquation || ''}">${ch.equation || ch.defaultEquation || 'N/A'}</span>
            <span class="channel-type ${ch.type}">${ch.type}</span>
        </div>
    `).join('');
}

/**
 * Get default color based on channel type
 */
function getDefaultColor(type) {
    switch (type) {
        case 'voltage': return '#3b82f6';
        case 'current': return '#f97316';
        case 'computed': return '#8b5cf6';
        default: return '#6b7280';
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the Channels Display module
 * @memberof module:ChannelsDisplay
 * @param {HTMLElement} container - Container element to inject template
 */
export function init(container) {
    if (_initialized) {
        console.warn('[ChannelsDisplay] Already initialized');
        return;
    }
    
    if (!container) {
        console.warn('[ChannelsDisplay] Container not provided');
        return;
    }
    
    console.log('[ChannelsDisplay] Initializing...');
    
    // Inject template
    container.innerHTML = getTemplate();
    
    // Cache elements
    _elements.channelsList = document.getElementById('channelsList');
    
    // Setup drag events for channels
    _setupDragEvents();
    
    // Subscribe to store changes for channels
    if (store.onChange) {
        store.onChange(() => {
            _updateDisplay();
        });
    }
    
    // Also subscribe to specific channel changes
    store.subscribe('data.equations', _updateDisplay);
    store.subscribe('config.standard', _updateDisplay);
    
    _initialized = true;
    console.log('[ChannelsDisplay] ✅ Initialized');
}

// ============================================================================
// INTERNAL METHODS
// ============================================================================

/**
 * Setup mouse-based drag for channel items
 * 
 * We use mouse events instead of HTML5 Drag API because:
 * - HTML5 Drag API has issues with nested containers
 * - Mouse events work reliably across all elements
 * - Better control over visual feedback
 * 
 * Flow:
 * 1. User presses mousedown on channel item
 * 2. We call dragManager.startDrag() with channel data
 * 3. dragManager handles mousemove/mouseup at document level
 * 4. FrameViewer registers as drop zone and receives the drop
 */
function _setupDragEvents() {
    const channelsList = _elements.channelsList;
    if (!channelsList) return;
    
    // Event delegation - one listener for all channel items
    channelsList.addEventListener('mousedown', (e) => {
        // Only handle left mouse button
        if (e.button !== 0) return;
        
        const channelItem = e.target.closest('.channel-draggable-source');
        if (!channelItem) return;
        
        const channelId = channelItem.dataset.channel;
        const channelType = channelItem.dataset.channelType || 'unknown';
        
        // Prevent text selection during drag
        e.preventDefault();
        
        // Get color based on type for ghost element
        const color = channelType === 'voltage' ? '#3b82f6' : 
                      channelType === 'current' ? '#f97316' : '#6b7280';
        
        // Start drag using dragManager
        startDrag({
            data: channelId,
            type: 'channel',
            label: channelId,
            color: color,
            event: e
        });
        
        // Visual feedback on source element
        channelItem.classList.add('dragging');
        
        // Remove dragging class when mouse released
        const cleanup = () => {
            channelItem.classList.remove('dragging');
            document.removeEventListener('mouseup', cleanup);
        };
        document.addEventListener('mouseup', cleanup);
        
        console.log('[ChannelsDisplay] Mouse drag started:', channelId);
    });
}

function _updateDisplay() {
    const channels = store.getChannels ? store.getChannels() : [];
    
    // Update count badge
    const badge = document.querySelector('.channel-count-badge');
    if (badge) {
        badge.textContent = channels.length;
    }
    
    // Update channels list
    const listEl = document.getElementById('channelsList');
    if (listEl) {
        listEl.innerHTML = getChannelsListHTML(channels);
        // Re-setup drag events after DOM update (event delegation handles this automatically)
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    init,
    getTemplate
};
