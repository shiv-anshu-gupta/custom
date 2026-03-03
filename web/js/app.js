/**
 * @file app.js
 * @fileoverview Main Application Entry Point for SV Publisher Web Client
 * @module app
 * @author SV-PUB Team
 * @copyright 2025 SV Publisher
 * @license Proprietary
 * @version 1.0.0
 * 
 * @description
 * This is the primary entry point for the SV Publisher frontend application.
 * It orchestrates initialization of all UI components, plugins, and backend connections.
 * 
 * **Architecture:**
 * - Centralized state management via Store
 * - Self-contained UI components
 * - Plugin system for extensibility
 * - Tauri backend for native operations
 * 
 * **Three-Column Layout:**
 * 
 * | Left Column | Middle Column | Right Column |
 * |-------------|---------------|--------------|
 * | Data Source | Frame Viewer | Publish Panel |
 * | Channels | | Statistics |
 * | Standard | | Wireshark Helper |
 * | Stream Settings | | Preview |
 * 
 * **Initialization Order:**
 * 1. Drag Manager (document-level events)
 * 2. Left Column Components
 * 3. Middle Column Components
 * 4. Right Column Components
 * 5. Math Editor (async)
 * 6. Plugins
 * 7. Theme System
 * 8. Tauri Backend Connection
 * 
 * **Security:**
 * - All inputs validated before processing
 * - DOM updates use textContent (not innerHTML)
 * - Backend uses Tauri's secure invoke() API
 * - No eval() or dynamic script execution
 * 
 * @requires module:store - Centralized state management
 * @requires module:components - UI component exports
 * @requires module:plugins/configManager - Configuration save/load
 * @requires module:plugins/keyboardShortcuts - Keyboard bindings
 * @requires module:utils/tauriClient - Tauri backend communication
 * @requires module:utils/dragManager - Drag-and-drop functionality
 * 
 * @example <caption>Debug Access (Browser Console)</caption>
 * // Access application state
 * window.__store.config
 * window.__store.data
 * 
 * // Access UI modules
 * window.__modules.StandardSelector
 * window.__modules.Statistics
 * 
 * @example <caption>Manual Component Re-initialization</caption>
 * // Re-initialize a specific component
 * window.__modules.Statistics.init(document.getElementById('statistics-container'))
 */

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS - Store (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════

import store from './store/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS - UI Components (All self-contained)
// ═══════════════════════════════════════════════════════════════════════════

import { 
    StandardSelector, 
    StreamSettings,
    DataSource,
    Statistics,
    PublishPanel,
    MultiPublisher,
    PublishMode,
    WiresharkHelper,
    Preview,
    FrameViewer,
    ChannelsDisplay,
    initEmbeddedMathEditor
} from './components/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS - Plugins
// ═══════════════════════════════════════════════════════════════════════════

import { initConfigButtons } from './plugins/configManager.js';
import { initKeyboardShortcuts, initUnloadWarning } from './plugins/keyboardShortcuts.js';
import * as tauriClient from './utils/tauriClient.js';
import { initDragManager } from './utils/dragManager.js';
import { initResizableColumns } from './utils/resizableColumns.js';

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize the SV Publisher application
 * 
 * @memberof module:app
 * @async
 * @function initApp
 * @description
 * Main bootstrapping function that initializes the entire application.
 * Components are initialized in a specific order to ensure dependencies are met.
 * 
 * **Initialization Order:**
 * 1. Drag Manager - Document-level mouse events
 * 2. Left Column - DataSource, Channels, Standard, StreamSettings
 * 3. Middle Column - FrameViewer
 * 4. Right Column - PublishPanel, Statistics, WiresharkHelper, Preview
 * 5. Math Editor - MathLive equation editor (async)
 * 6. Plugins - Config buttons, keyboard shortcuts, unload warning
 * 7. Theme System - Light/dark mode toggle
 * 8. Backend - Tauri connection
 * 9. Debug Exposure - window.__store, window.__modules
 * 
 * **Component Dependencies:**
 * | Component | Depends On |
 * |-----------|------------|
 * | All Components | Store |
 * | ChannelsDisplay | DataSource state |
 * | StreamSettings | StandardSelector state |
 * | PublishPanel | TauriClient |
 * | Statistics | TauriClient |
 * 
 * @returns {Promise<void>} Resolves when initialization is complete
 * 
 * @fires module:store#initialized - When store is ready
 * @fires module:tauriClient#connect - When backend connection is established
 * 
 * @throws {Error} If critical components fail to initialize
 * 
 * @example
 * // Automatic (recommended - handled by DOMContentLoaded)
 * document.addEventListener('DOMContentLoaded', initApp);
 * 
 * @see {@link initThemeToggle} for theme system details
 * @see {@link module:store} for state management
 */
async function initApp() {
    console.log('🚀 Initializing SV Publisher...');
    console.log('📦 Architecture: Store + Modules (3-Column Layout)');

    // ═══════════════════════════════════════════════════════════════════════
    // INITIALIZE DRAG MANAGER FIRST (Document-level mouse events)
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('🖱️ Initializing Drag Manager...');
    initDragManager();

    // Resizable three-column layout (VS Code-style drag handles)
    console.log('↔️ Initializing Resizable Columns...');
    initResizableColumns();

    // ═══════════════════════════════════════════════════════════════════════
    // LEFT COLUMN - Configuration & Data Source
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('📋 Initializing Left Column...');
    
    // Data Source (PCAP + Equation tabs) - Primary input
    DataSource.init(document.getElementById('data-source-container'));
    
    // Channels Display - Show active channels
    ChannelsDisplay.init(document.getElementById('channels-display-container'));
    
    // Standard Selection
    StandardSelector.init(document.getElementById('standard-selector-container'));
    
    // Stream Settings (Interface, Frequency, Samples/Cycle, Sample Rate)
    // These are publishing parameters NOT in the frame structure
    StreamSettings.init(document.getElementById('stream-settings-container'));

    // ═══════════════════════════════════════════════════════════════════════
    // MIDDLE COLUMN - Frame Structure
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('📋 Initializing Middle Column...');
    
    // Frame Structure Viewer (Full SV Frame Structure with ASDU selector)
    FrameViewer.init(document.getElementById('frame-viewer-container'));

    // ═══════════════════════════════════════════════════════════════════════
    // RIGHT COLUMN - Publish Controls & Monitoring
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('📋 Initializing Right Column...');
    
    // Publish Mode Toggle (Single Stream ↔ Multi Stream)
    PublishMode.init(document.getElementById('publish-mode-container'));
    
    // Statistics (Real-time network stats display)
    Statistics.init(document.getElementById('statistics-container'));
    
    // Wireshark Helper (Filter + Steps)
    WiresharkHelper.init(document.getElementById('wireshark-container'));
    
    // Packet Preview (Live SV packet structure)
    Preview.init(document.getElementById('preview-container'));

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Initialize Embedded MathLive Equation Editor
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('📐 Initializing Equation Editor...');
    try {
        await initEmbeddedMathEditor();
    } catch (error) {
        console.warn('⚠️ Equation Editor failed to load:', error);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Initialize Plugins
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('🔧 Initializing Plugins...');
    initConfigButtons();
    initKeyboardShortcuts();
    initUnloadWarning();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Initialize Theme System
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('🎨 Initializing Theme System...');
    initThemeToggle();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Connect to Tauri Backend
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('🔌 Connecting to Tauri backend...');
    await tauriClient.connect();

    // ═══════════════════════════════════════════════════════════════════════
    // EXPOSE FOR DEBUGGING
    // ═══════════════════════════════════════════════════════════════════════
    
    window.__store = store;
    window.__modules = { 
        StandardSelector, 
        StreamSettings,
        DataSource, 
        Statistics, 
        PublishPanel, 
        MultiPublisher,
        PublishMode,
        WiresharkHelper, 
        Preview,
        FrameViewer,
        ChannelsDisplay
    };

    console.log('✅ SV Publisher initialized!');
    console.log('💡 Debug: window.__store (state) | window.__modules (UI modules)');
}

// ═══════════════════════════════════════════════════════════════════════════
// THEME TOGGLE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize the theme toggle functionality
 * 
 * @memberof module:app
 * @private
 * @function initThemeToggle
 * @description
 * Sets up the light/dark theme switching system with localStorage persistence.
 * 
 * **Theme Toggle Flow:**
 * 1. Load saved preference from localStorage
 * 2. Apply theme class to document.body
 * 3. Set icon (☀️ for dark mode, 🌙 for light mode)
 * 4. Bind click handler for toggle button
 * 5. On click: toggle class, update icon, save preference
 * 
 * **CSS Variables Used:**
 * 
 * | Variable | Light Theme | Dark Theme |
 * |----------|-------------|------------|
 * | --bg-primary | #ffffff | #1a1a2e |
 * | --bg-secondary | #f8f9fa | #16213e |
 * | --text-primary | #212529 | #eaeaea |
 * | --accent-color | #4a90d9 | #6bb3f8 |
 * 
 * **LocalStorage Key:** `sv-publisher-theme`
 * **Values:** `'dark'` or `'light'`
 * 
 * @returns {void}
 * 
 * @example
 * // Initialize theme system
 * initThemeToggle();
 * 
 * @example <caption>Manual Theme Toggle</caption>
 * // Toggle theme programmatically
 * document.body.classList.toggle('dark-theme');
 * localStorage.setItem('sv-publisher-theme', 
 *     document.body.classList.contains('dark-theme') ? 'dark' : 'light'
 * );
 * 
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage|localStorage API}
 */
function initThemeToggle() {
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeIcon = document.getElementById('themeIcon');
    
    if (!themeToggleBtn || !themeIcon) {
        console.warn('[Theme] Toggle button not found');
        return;
    }
    
    // Load saved theme preference (default: light)
    const savedTheme = localStorage.getItem('sv-publisher-theme') || 'light';
    
    // Apply saved theme on load
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeIcon.textContent = '☀️';  // Show sun icon in dark mode
    } else {
        document.body.classList.remove('dark-theme');
        themeIcon.textContent = '🌙';  // Show moon icon in light mode
    }
    
    // Toggle handler
    themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        
        // Update icon
        themeIcon.textContent = isDark ? '☀️' : '🌙';
        
        // Save preference
        localStorage.setItem('sv-publisher-theme', isDark ? 'dark' : 'light');
        
        console.log(`[Theme] Switched to ${isDark ? 'dark' : 'light'} mode`);
    });
    
    console.log(`[Theme] ✅ Initialized (current: ${savedTheme})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// START APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', initApp);
