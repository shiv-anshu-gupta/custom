/**
 * @file tauriClient.js
 * @fileoverview Tauri Backend Communication Client
 * @module tauriClient
 * @author SV-PUB Team
 * @description
 * Provides communication with the Tauri/Rust backend using invoke() API.
 * Replaces WebSocket-based communication for desktop app version.
 * 
 * **Features:**
 * - Direct Rust command invocation
 * - Event-based communication with multiple listeners
 * - Automatic stats polling during publishing
 * - Publishing state detection
 * 
 * **Events:**
 * | Event | Data | Description |
 * |-------|------|-------------|
 * | connect | - | Backend connected |
 * | disconnect | - | Backend disconnected |
 * | stats | {packetsSent, ...} | Real-time statistics |
 * | status | {isPublishing} | Publishing status |
 * | error | {message} | Error occurred |
 * | publishingStopped | - | Publishing ended |
 * 
 * @example
 * import * as tauriClient from './utils/tauriClient.js';
 * await tauriClient.connect();
 * tauriClient.on('stats', (stats) => console.log(stats));
 * await tauriClient.startPublishing(config);
 */

import { resolveChannelEquations, hasComputedChannels } from './equationResolver.js';

/** @private */
const getTauriInvoke = () => {
    // Tauri 2.x uses window.__TAURI__.core.invoke
    if (window.__TAURI__?.core?.invoke) {
        return window.__TAURI__.core.invoke;
    }
    // Tauri 1.x fallback
    if (window.__TAURI__?.invoke) {
        return window.__TAURI__.invoke;
    }
    console.error('[tauriClient] window.__TAURI__ =', window.__TAURI__);
    throw new Error('Tauri not available');
};

/** @private */
const invoke = async (cmd, args) => {
    const fn = getTauriInvoke();
    return await fn(cmd, args);
};

/** @private */
const handlers = {
    connect: [],
    disconnect: [],
    stats: [],
    status: [],
    error: [],
    init: [],
    publishingStopped: []
};

/** @private */
function emit(event, data) {
    const listeners = handlers[event];
    if (listeners && listeners.length > 0) {
        listeners.forEach(fn => {
            try { fn(data); } catch (e) { console.error(`[tauriClient] Handler error for ${event}:`, e); }
        });
    }
}

/** @private */
let _isConnected = false;
/** @private */
let statsInterval = null;

/**
 * Connect to Tauri backend
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 * @fires connect - When connection successful
 * @fires error - When connection fails
 */
export async function connect() {
    try {
        console.log('[tauriClient] Connecting to Tauri backend...');
        
        // Check if native is available
        const available = await invoke('is_native_available');
        console.log('[tauriClient] Native available:', available);
        
        if (available) {
            _isConnected = true;
            emit('connect');
            
            // Get initial state
            const state = await invoke('get_initial_state');
            console.log('[tauriClient] Initial state:', state);
            emit('init', state);
            
            // Start stats polling
            startStatsPolling();
            
            console.log('[tauriClient] ✅ Connected to Tauri backend');
        } else {
            throw new Error('Native module not available');
        }
    } catch (err) {
        console.error('[tauriClient] Connection failed:', err);
        emit('error', { message: err.message || 'Connection failed' });
    }
}

/** @private */
let wasPublishing = false;

/**
 * Start polling for stats every 250ms
 * @private
 */
function startStatsPolling() {
    if (statsInterval) return;
    
    statsInterval = setInterval(async () => {
        try {
            const status = await invoke('get_publish_status');
            
            if (status.isPublishing) {
                wasPublishing = true;
                const stats = await invoke('get_stats');
                console.log('[tauriClient] Stats:', stats);
                emit('stats', stats);
                
                // Check if backend reports duration complete (should stop soon)
                if (stats.durationComplete) {
                    console.log('[tauriClient] 📍 Duration elapsed, backend stopping...');
                }
            } else if (wasPublishing) {
                // Publishing just stopped! Fetch final stats and emit stop event
                wasPublishing = false;
                
                const stats = await invoke('get_stats');
                console.log('[tauriClient] 🛑 Publishing stopped. Final stats:', stats);
                
                // Emit final stats
                emit('stats', stats);
                
                // Emit stop event so UI can update
                console.log('[tauriClient] 📢 Emitting publishingStopped event...');
                emit('publishingStopped', {
                    reason: stats.durationComplete ? 'duration_elapsed' : 'user_stopped',
                    stats: stats
                });
                console.log('[tauriClient] ✅ publishingStopped event emitted');
            }
        } catch (err) {
            // Ignore polling errors
        }
    }, 250);
}

/**
 * Stop stats polling
 * @private
 */
function stopStatsPolling() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
}

/**
 * Disconnect from backend
 * @memberof module:tauriClient
 */
export function disconnect() {
    _isConnected = false;
    stopStatsPolling();
    emit('disconnect');
}

/**
 * Check if connected to backend
 * @memberof module:tauriClient
 * @returns {boolean} Connection state
 */
export function isConnected() {
    return _isConnected;
}

/**
 * Register event handler (supports multiple listeners per event)
 * @memberof module:tauriClient
 * @param {string} event - Event name (connect, disconnect, stats, status, error, publishingStopped)
 * @param {Function} handler - Callback function
 */
export function on(event, handler) {
    if (handlers.hasOwnProperty(event)) {
        handlers[event].push(handler);
        console.log(`[tauriClient] Registered handler for '${event}' (${handlers[event].length} total)`);
    } else {
        console.warn(`[tauriClient] Unknown event: ${event}`);
    }
}

// ============================================================================
// INTERFACE COMMANDS
// ============================================================================

/**
 * Get list of available network interfaces
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<Array>} Array of interface objects
 */
export async function getInterfaces() {
    return await invoke('get_interfaces');
}

/**
 * Open a network interface for publishing
 * @memberof module:tauriClient
 * @async
 * @param {string} name - Interface name
 * @returns {Promise<void>}
 */
export async function openInterface(name) {
    return await invoke('open_interface', { name });
}

/**
 * Close the currently open interface
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 */
export async function closeInterface() {
    return await invoke('close_interface');
}

/**
 * Check if an interface is currently open
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<boolean>}
 */
export async function isInterfaceOpen() {
    return await invoke('is_interface_open');
}

// ============================================================================
// PUBLISHING COMMANDS
// ============================================================================

/**
 * Set duration and repeat mode (BACKEND CONTROLLED - NOT JS TIMER!)
 * All timing happens in C++, ensuring accuracy and security.
 * @memberof module:tauriClient
 * @async
 * @param {Object} settings - Duration settings
 * @param {number} settings.durationSeconds - Duration in seconds
 * @param {boolean} settings.repeatEnabled - Enable repeat mode
 * @param {boolean} settings.repeatInfinite - Infinite repeat
 * @param {number} settings.repeatCount - Number of repeats
 * @returns {Promise<void>}
 */
export async function setDurationMode(settings) {
    console.log('[tauriClient] ⏱️ Setting duration mode (BACKEND CONTROLLED):', settings);
    return await invoke('set_duration_mode', { settings });
}

/**
 * Get remaining seconds from C++ backend
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<number>} Remaining seconds
 */
export async function getRemainingSeconds() {
    return await invoke('get_remaining_seconds');
}

/**
 * Get current repeat cycle from C++ backend
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<number>} Current cycle number
 */
export async function getCurrentRepeatCycle() {
    return await invoke('get_current_repeat_cycle');
}

/**
 * Check if duration completed in C++ backend
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<boolean>}
 */
export async function isDurationComplete() {
    return await invoke('is_duration_complete');
}

/**
 * Start SV publishing
 * @memberof module:tauriClient
 * @async
 * @param {number} [duration=0] - Duration in seconds (0 for infinite)
 * @param {Object} [options={}] - Options
 * @param {number} [options.interfaceIndex] - Interface index to use
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function start(duration = 0, options = {}) {
    try {
        // Open interface if needed
        const isOpen = await invoke('is_interface_open');
        
        if (!isOpen && options.interfaceIndex !== undefined) {
            const interfaces = await invoke('get_interfaces');
            const iface = interfaces[options.interfaceIndex];
            if (iface) {
                console.log('[tauriClient] Opening interface:', iface.name);
                await invoke('open_interface', { name: iface.name });
            }
        }
        
        // Start publishing
        await invoke('start_publishing');
        
        emit('status', { status: 'running' });
        return { success: true };
    } catch (err) {
        console.error('[tauriClient] Start failed:', err);
        emit('error', { message: err });
        return { success: false, error: err };
    }
}

/**
 * Stop SV publishing
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function stop() {
    try {
        await invoke('stop_publishing');
        emit('status', { status: 'stopped' });
        return { success: true };
    } catch (err) {
        console.error('[tauriClient] Stop failed:', err);
        return { success: false, error: err };
    }
}

// ============================================================================
// CONFIG COMMANDS
// ============================================================================

/**
 * Get current configuration from backend
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<Object>} Configuration object
 */
export async function getConfig() {
    return await invoke('get_config');
}

/**
 * Update config only (backward compatibility)
 * @memberof module:tauriClient
 * @async
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function updateConfig(config) {
    console.log('[tauriClient] Sending config to Rust:', config);
    return await invoke('set_config', { config });
}

/**
 * Send complete data (config + channels) to backend
 * @memberof module:tauriClient
 * @async
 * @param {Object} data - Complete data object
 * @param {Object} data.config - Configuration
 * @param {Array} data.channels - Channel array
 * @param {Object} [data.meta] - Optional metadata
 * @returns {Promise<{success: boolean}>}
 */
export async function updateData(data) {
    console.log('==========================================');
    console.log('[tauriClient] updateData() CALLED');
    console.log('[tauriClient] Config keys:', Object.keys(data.config || {}));
    console.log('[tauriClient] Config svId:', data.config?.svId);
    console.log('[tauriClient] Channels count:', data.channels?.length);
    console.log('==========================================');
    
    try {
        // Send config first
        console.log('[tauriClient] Step 1: Sending config...');
        console.log('[tauriClient] Config object:', JSON.stringify(data.config, null, 2));
        await invoke('set_config', { config: data.config });
        console.log('[tauriClient] ✅ Config sent successfully');
        
        // Send channels/equations to backend
        if (data.channels && data.channels.length > 0) {
            // Resolve computed channels (those referencing other channel IDs)
            // into pre-computed wavetable format that C++ can process
            let channelsToSend = data.channels;
            if (hasComputedChannels(data.channels)) {
                const freq = data.config?.frequency || 50;
                const rate = data.config?.sampleRate || 4000;
                console.log('[tauriClient] Step 2a: Resolving computed channel equations...');
                channelsToSend = resolveChannelEquations(data.channels, freq, rate);
                console.log('[tauriClient] ✅ Computed channels resolved');
            }
            
            console.log('[tauriClient] Step 2: Sending', channelsToSend.length, 'channels...');
            console.log('[tauriClient] Channel IDs:', channelsToSend.map(c => c.id).join(', '));
            await invoke('set_channels', { channels: channelsToSend });
            console.log('[tauriClient] ✅ Channels sent successfully');
        } else {
            console.warn('[tauriClient] ⚠️ No channels to send!');
        }
        
        return { success: true };
    } catch (err) {
        console.error('[tauriClient] ❌ Error sending data:', err);
        throw err;
    }
}

// ============================================================================
// STATS COMMANDS
// ============================================================================

/**
 * Get current publishing statistics
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<Object>} Statistics object
 */
export async function getStats() {
    return await invoke('get_stats');
}

/**
 * Reset statistics counters
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 */
export async function resetStats() {
    return await invoke('reset_stats');
}

// ============================================================================
// CHANNEL/EQUATION COMMANDS
// ============================================================================

/**
 * Update channels with equations
 * @memberof module:tauriClient
 * @async
 * @param {Array} channels - Array of channel objects
 * @param {string} channels[].id - Channel ID
 * @param {string} channels[].equation - Math expression
 * @param {string} channels[].type - Channel type (voltage/current)
 * @param {boolean} channels[].isBase - Is base channel
 * @returns {Promise<{success: boolean}>}
 */
export async function updateChannels(channels) {
    console.log('[tauriClient] Updating channels:', channels.length);
    return { success: true };
}

/**
 * @memberof module:tauriClient
 * @deprecated Use updateChannels instead
 * @async
 * @param {Object} equations - Equations object
 * @returns {Promise<{success: boolean}>}
 */
export async function updateEquations(equations) {
    console.log('[tauriClient] updateEquations (deprecated):', equations);
    return { success: true };
}

// ============================================================================
// GENERIC SEND (for compatibility)
// ============================================================================

/**
 * Generic message sender (for backward compatibility)
 * @memberof module:tauriClient
 * @async
 * @param {Object} message - Message object with type property
 */
export async function send(message) {
    console.log('[tauriClient] Generic send:', message);
    
    if (message.type === 'pcap_replay') {
        // TODO: Implement PCAP replay
        console.log('[tauriClient] PCAP replay not yet implemented');
        return;
    }
    
    // Handle other message types as needed
}

// ============================================================================
// SEND MODE COMMANDS
// ============================================================================

/**
 * Set the packet sending mechanism (SendQueue vs SendPacket)
 * Must be called BEFORE start_publishing.
 * @memberof module:tauriClient
 * @async
 * @param {number} mode - 0=Auto, 1=SendQueue (batch), 2=SendPacket (immediate)
 * @returns {Promise<void>}
 */
export async function setSendMode(mode) {
    const modeNames = ['Auto', 'SendQueue (batch)', 'SendPacket (immediate)', 'USB-Optimized (spin+gap)'];
    console.log(`[tauriClient] 🔀 Setting send mode: ${modeNames[mode] || 'Unknown'} (${mode})`);
    return await invoke('set_send_mode', { mode });
}

/**
 * Get the current send mode
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<number>} 0=Auto, 1=SendQueue, 2=SendPacket
 */
export async function getSendMode() {
    return await invoke('get_send_mode');
}

// ============================================================================
// MULTI-PUBLISHER COMMANDS
// ============================================================================

/**
 * Add a new publisher instance
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<number>} Publisher ID
 */
export async function mpAddPublisher() {
    return await invoke('mp_add_publisher');
}

/**
 * Remove a publisher instance
 * @memberof module:tauriClient
 * @async
 * @param {number} id - Publisher ID
 * @returns {Promise<void>}
 */
export async function mpRemovePublisher(id) {
    return await invoke('mp_remove_publisher', { id });
}

/**
 * Remove ALL publishers (reset backend for new session)
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 */
export async function mpRemoveAllPublishers() {
    return await invoke('mp_remove_all_publishers');
}

/**
 * Get total number of publishers
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<number>}
 */
export async function mpGetPublisherCount() {
    return await invoke('mp_get_publisher_count');
}

/**
 * Configure a publisher with config + channels
 * @memberof module:tauriClient
 * @async
 * @param {number} id - Publisher ID
 * @param {Object} config - MpPublisherConfig object
 * @returns {Promise<void>}
 */
export async function mpConfigurePublisher(id, config) {
    console.log(`[tauriClient] Configuring publisher ${id}:`, config.svId);
    
    // Resolve computed channel equations if present
    if (config.channels && config.channels.length > 0 && hasComputedChannels(config.channels)) {
        const freq = config.frequency || 50;
        const rate = config.sampleRate || 4000;
        console.log(`[tauriClient] Resolving computed channels for publisher ${id}...`);
        config = { ...config, channels: resolveChannelEquations(config.channels, freq, rate) };
    }
    
    return await invoke('mp_configure_publisher', { id, config });
}

/**
 * Start all publishers simultaneously
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 */
export async function mpStartAll() {
    console.log('[tauriClient] ▶ Starting all publishers...');
    return await invoke('mp_start_all');
}

/**
 * Stop all publishers
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 */
export async function mpStopAll() {
    console.log('[tauriClient] ⏹ Stopping all publishers...');
    return await invoke('mp_stop_all');
}

/**
 * Check if multi-publisher system is running
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<boolean>}
 */
export async function mpIsRunning() {
    return await invoke('mp_is_running');
}

/**
 * Full reset: stop everything, clear all backend state, free all memory
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<void>}
 */
export async function mpResetAll() {
    console.log('[tauriClient] \u{1F504} Full reset — clearing all backend state');
    return await invoke('mp_reset_all');
}

/**
 * Set send mode for multi-publisher
 * @memberof module:tauriClient
 * @async
 * @param {number} mode - 0=Auto, 1=SendQueue, 2=SendPacket
 * @returns {Promise<void>}
 */
export async function mpSetSendMode(mode) {
    return await invoke('mp_set_send_mode', { mode });
}

/**
 * Set duration for multi-publisher
 * @memberof module:tauriClient
 * @async
 * @param {number} seconds - Duration (0=continuous)
 * @param {boolean} repeat - Enable repeat
 * @param {boolean} infinite - Infinite repeat
 * @param {number} count - Repeat count
 * @returns {Promise<void>}
 */
export async function mpSetDuration(seconds, repeat = false, infinite = false, count = 0) {
    return await invoke('mp_set_duration', { seconds, repeat, infinite, count });
}

/**
 * Get multi-publisher statistics
 * @memberof module:tauriClient
 * @async
 * @returns {Promise<Object>} Stats object
 */
export async function mpGetStats() {
    return await invoke('mp_get_stats');
}

// ============================================================================
// USB FRAME PADDING
// ============================================================================

/** Set USB frame padding size in bytes (single-publisher). 0 = off. */
export async function setUsbPadSize(bytes) {
    console.log(`[tauriClient] USB pad size: ${bytes} bytes`);
    return await invoke('set_usb_pad_size', { bytes });
}

/** Get USB pad size (single-publisher) */
export async function getUsbPadSize() {
    return await invoke('get_usb_pad_size');
}

/** Set USB frame padding size (multi-publisher) */
export async function mpSetUsbPadSize(bytes) {
    console.log(`[tauriClient] MP USB pad size: ${bytes} bytes`);
    return await invoke('mp_set_usb_pad_size', { bytes });
}

/** Get USB pad size (multi-publisher) */
export async function mpGetUsbPadSize() {
    return await invoke('mp_get_usb_pad_size');
}

// ============================================================================
// USB MIN INTER-PACKET GAP
// ============================================================================

/** Set USB min inter-packet gap in microseconds (single-publisher). 0 = default 130µs. */
export async function setUsbMinGapUs(us) {
    console.log(`[tauriClient] USB min gap: ${us} µs`);
    return await invoke('set_usb_min_gap_us', { us });
}

/** Get USB min gap (single-publisher) */
export async function getUsbMinGapUs() {
    return await invoke('get_usb_min_gap_us');
}

/** Set USB min gap (multi-publisher) */
export async function mpSetUsbMinGapUs(us) {
    console.log(`[tauriClient] MP USB min gap: ${us} µs`);
    return await invoke('mp_set_usb_min_gap_us', { us });
}

/** Get USB min gap (multi-publisher) */
export async function mpGetUsbMinGapUs() {
    return await invoke('mp_get_usb_min_gap_us');
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
    connect,
    disconnect,
    isConnected,
    on,
    // Interface
    getInterfaces,
    openInterface,
    closeInterface,
    isInterfaceOpen,
    // Publishing (single)
    start,
    stop,
    setSendMode,
    getSendMode,
    // Config & Data
    getConfig,
    updateConfig,
    updateData,
    updateChannels,
    // Stats
    getStats,
    resetStats,
    // Equations (deprecated)
    updateEquations,
    // Generic
    send,
    // Multi-Publisher
    mpAddPublisher,
    mpRemovePublisher,
    mpRemoveAllPublishers,
    mpGetPublisherCount,
    mpConfigurePublisher,
    mpStartAll,
    mpStopAll,
    mpResetAll,
    mpIsRunning,
    mpSetSendMode,
    mpSetDuration,
    mpGetStats,
    // USB Frame Padding
    setUsbPadSize,
    getUsbPadSize,
    mpSetUsbPadSize,
    mpGetUsbPadSize,
    // USB Min Gap
    setUsbMinGapUs,
    getUsbMinGapUs,
    mpSetUsbMinGapUs,
    mpGetUsbMinGapUs,
};
