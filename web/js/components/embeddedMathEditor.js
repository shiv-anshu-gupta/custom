/**
 * @file embeddedMathEditor.js
 * @fileoverview Inline Equation Editor using MathLive
 * @module embeddedMathEditor
 * @description
 * Provides an inline math equation editor for SV channel waveforms.
 * Uses MathLive library for LaTeX input and converts to math.js format.
 */

import { showToast } from '../plugins/toast.js';
import { convertLatexToMathJs, convertMathJsToLatex } from '../utils/expressionConverter.js';
import { validateExpression, testExpression, evaluateSamples, calculateStats } from '../utils/mathEvaluator.js';
import { store, BASE_CHANNELS } from '../store/index.js';

/** @private */
let mathLiveLoaded = false;
/** @private */
let currentChannelId = null;
/** @private */
let isCreatingNewChannel = false;
/** @private */
let newChannelCounter = 1;

/**
 * Get current SV channels from store
 * @private
 * @returns {Array} Channel list
 */
function getSVChannels() {
    return store.getChannels();
}

/** @private */
const SV_CHANNELS = BASE_CHANNELS;

/** @private */
const OPERATORS = [
    { label: '+', latex: '+', title: 'Addition' },
    { label: '-', latex: '-', title: 'Subtraction' },
    { label: '×', latex: '\\cdot', title: 'Multiplication' },
    { label: '÷', latex: '\\frac{#0}{#?}', title: 'Division (Fraction)' },
    { label: '^', latex: '^{#0}', title: 'Power' },
    { label: '(', latex: '(', title: 'Left Parenthesis' },
    { label: ')', latex: ')', title: 'Right Parenthesis' },
    { label: 'π', latex: '\\pi', title: 'Pi Constant' },
    { label: '|x|', latex: '\\left|#0\\right|', title: 'Absolute Value' }
];

/** @private */
const FUNCTIONS = [
    { label: '√', latex: '\\sqrt{#0}', title: 'Square Root' },
    { label: 'sin', latex: '\\sin(#0)', title: 'Sine' },
    { label: 'cos', latex: '\\cos(#0)', title: 'Cosine' },
    { label: 'tan', latex: '\\tan(#0)', title: 'Tangent' },
    { label: 'x²', latex: '^{2}', title: 'Square' },
    { label: 'exp', latex: '\\exp(#0)', title: 'Exponential' },
    { label: 'ln', latex: '\\ln(#0)', title: 'Natural Log' },
    { label: 'RMS', latex: '\\operatorname{RMS}\\left(#0\\right)', title: 'RMS Value' },
    { label: 'AVG', latex: '\\operatorname{AVG}\\left(#0\\right)', title: 'Average Value' }
];

/**
 * Load MathLive from CDN on demand
 * @returns {Promise} Resolves when MathLive is ready
 */
async function loadMathLive() {
    if (mathLiveLoaded && window.MathLive) {
        return window.MathLive;
    }

    return new Promise((resolve, reject) => {
        if (window.MathLive) {
            mathLiveLoaded = true;
            resolve(window.MathLive);
            return;
        }

        console.log("[EmbeddedMathEditor] Loading MathLive from CDN...");

        // Load CSS first
        const linkCore = document.createElement("link");
        linkCore.rel = "stylesheet";
        linkCore.href = "https://unpkg.com/mathlive@0.95.5/dist/mathlive.min.css";
        document.head.appendChild(linkCore);

        // Load JS
        const script = document.createElement("script");
        script.src = "https://unpkg.com/mathlive@0.95.5/dist/mathlive.min.js";
        script.async = true;

        script.onload = () => {
            console.log("[EmbeddedMathEditor] MathLive loaded successfully");
            mathLiveLoaded = true;
            resolve(window.MathLive);
        };

        script.onerror = () => {
            reject(new Error("Failed to load MathLive"));
        };

        document.head.appendChild(script);
    });
}

/**
 * Create channel button HTML
 * @param {Object} channel - Channel config
 * @returns {string} HTML string
 */
function createChannelButton(channel) {
    return `
        <button class="em-channel-btn" 
                data-latex="${channel.latex}" 
                data-channel="${channel.id}"
                title="${channel.id}"
                style="border-left: 3px solid ${channel.color}">
            ${channel.label}
        </button>
    `;
}

/**
 * Create operator/function button HTML
 * @param {Object} item - Button config
 * @returns {string} HTML string
 */
function createInsertButton(item) {
    return `
        <button class="em-insert-btn" 
                data-latex="${item.latex}" 
                title="${item.title}">
            ${item.label}
        </button>
    `;
}

/**
 * Initialize the embedded MathLive editor
 * @memberof module:embeddedMathEditor
 * @async
 */
export async function initEmbeddedMathEditor() {
    const container = document.getElementById('embeddedEditorContainer');
    if (!container) {
        console.warn('[EmbeddedMathEditor] Container #embeddedEditorContainer not found');
        return;
    }

    // Load MathLive first
    try {
        await loadMathLive();
    } catch (error) {
        console.error('[EmbeddedMathEditor] Failed to load MathLive:', error);
        showToast('Failed to load equation editor', 'error');
        return;
    }

    // Render the embedded editor HTML (inside the container, preserving the hidden inputs)
    container.innerHTML = createEmbeddedEditorHTML();

    // Initialize all components
    initNewChannelButton();
    initChannelSelector();
    initInsertButtons();
    initMathField();
    initActionButtons();
    initQuickTemplates();

    // Subscribe to store changes (replaces channelManager and standardManager events)
    store.onChange(() => {
        console.log('[EmbeddedMathEditor] Store changed, refreshing...');
        onGlobalStandardChanged();
    });

    console.log('[EmbeddedMathEditor] Initialized successfully');
}

/**
 * Handle global standard change from Step 1 radio cards
 * This is the SINGLE SOURCE OF TRUTH for standard selection
 */
function onGlobalStandardChanged() {
    console.log('[EmbeddedMathEditor] Standard/channels changed');
    
    // Re-render the editor with new standard settings
    const container = document.getElementById('embeddedEditorContainer');
    if (container) {
        container.innerHTML = createEmbeddedEditorHTML();
        initNewChannelButton();
        initChannelSelector();
        initInsertButtons();
        initMathField();
        initActionButtons();
        initQuickTemplates();
    }
    
    // Reset creation mode
    isCreatingNewChannel = false;
}

/**
 * Initialize the "+ New Channel" button in the channel grid
 */
function initNewChannelButton() {
    const newChannelBtn = document.getElementById('emNewChannelBtn');
    const cancelBtn = document.getElementById('emCancelNewChannel');
    
    if (newChannelBtn) {
        newChannelBtn.addEventListener('click', () => {
            enterNewChannelMode();
        });
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            exitNewChannelMode();
        });
    }
}

/**
 * Enter "create new channel" mode
 */
function enterNewChannelMode() {
    isCreatingNewChannel = true;
    currentChannelId = null;
    
    // Deselect all channel buttons
    const channelBtns = document.querySelectorAll('.em-channel-btn');
    channelBtns.forEach(b => b.classList.remove('active'));
    
    // Highlight the new channel button
    const newChannelBtn = document.getElementById('emNewChannelBtn');
    if (newChannelBtn) {
        newChannelBtn.classList.add('active');
    }
    
    // Show cancel button
    const cancelBtn = document.getElementById('emCancelNewChannel');
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
    }
    
    // Show hint for new channel format
    const hint = document.getElementById('emNewChannelHint');
    if (hint) {
        hint.style.display = 'block';
    }
    
    // Update labels
    const activeLabel = document.getElementById('emActiveChannel');
    if (activeLabel) {
        activeLabel.textContent = 'Creating New Channel';
        activeLabel.style.color = '#4CAF50';
    }
    updateApplyButtonText();
    
    // Clear and enable math field with helpful placeholder
    const mathField = document.getElementById('emMathField');
    if (mathField) {
        mathField.value = '';
        mathField.placeholder = 'V0 = 325 * sin(2 * PI * 50 * t)  or just equation...';
        mathField.focus();
    }
    updatePreview('');
    
    // Enable action buttons
    document.getElementById('emTestBtn')?.removeAttribute('disabled');
    document.getElementById('emApplyBtn')?.removeAttribute('disabled');
}

/**
 * Exit "create new channel" mode and return to normal editing
 */
function exitNewChannelMode() {
    isCreatingNewChannel = false;
    currentChannelId = null;
    
    // Remove highlight from new channel button
    const newChannelBtn = document.getElementById('emNewChannelBtn');
    if (newChannelBtn) {
        newChannelBtn.classList.remove('active');
    }
    
    // Hide cancel button
    const cancelBtn = document.getElementById('emCancelNewChannel');
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
    
    // Hide hint
    const hint = document.getElementById('emNewChannelHint');
    if (hint) {
        hint.style.display = 'none';
    }
    
    // Update labels
    const activeLabel = document.getElementById('emActiveChannel');
    if (activeLabel) {
        activeLabel.textContent = 'Select a channel';
        activeLabel.style.color = '';
    }
    updateApplyButtonText();
    
    // Reset math field
    const mathField = document.getElementById('emMathField');
    if (mathField) {
        mathField.value = '';
        mathField.placeholder = 'Click a channel above, then enter equation...';
    }
    updatePreview('');
    
    // Disable action buttons
    document.getElementById('emTestBtn')?.setAttribute('disabled', 'disabled');
    document.getElementById('emApplyBtn')?.setAttribute('disabled', 'disabled');
}

/**
 * Update the active channel label based on current mode
 */
function updateActiveChannelLabel() {
    const activeLabel = document.getElementById('emActiveChannel');
    if (!activeLabel) return;
    
    if (isCreatingNewChannel) {
        activeLabel.textContent = 'Creating New Channel';
        activeLabel.style.color = '#4CAF50';
    } else if (currentChannelId) {
        const channel = getSVChannels().find(c => c.id === currentChannelId);
        activeLabel.textContent = `Editing: ${currentChannelId}`;
        activeLabel.style.color = channel?.color || '';
    } else {
        activeLabel.textContent = 'Select a channel';
        activeLabel.style.color = '';
    }
}

/**
 * Parse channel definition from MathLive input
 * Supports formats: "ChannelName = Expression" or just "Expression"
 * @param {string} input - Raw input from MathLive (math.js format)
 * @returns {Object} { channelName, equation }
 */
function parseChannelDefinition(input) {
    if (!input || !input.trim()) {
        return { channelName: null, equation: null };
    }
    
    const trimmed = input.trim();
    
    // Try to match "Name = Expression" pattern
    // Channel name: starts with letter, can contain letters, numbers, underscore
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    
    if (match) {
        return {
            channelName: match[1],
            equation: match[2].trim()
        };
    }
    
    // No "Name =" pattern found, generate default name
    return {
        channelName: generateDefaultChannelName(),
        equation: trimmed
    };
}

/**
 * Generate a default channel name like Ch1, Ch2, etc.
 * @returns {string} Unique channel name
 */
function generateDefaultChannelName() {
    const existingChannels = getSVChannels();
    let name;
    
    // Find a unique name
    do {
        name = `Ch${newChannelCounter++}`;
    } while (existingChannels.some(c => c.id === name));
    
    return name;
}

/**
 * Update the Apply button text based on current mode
 */
function updateApplyButtonText() {
    const applyBtnText = document.getElementById('emApplyBtnText');
    if (applyBtnText) {
        applyBtnText.textContent = isCreatingNewChannel ? 'Create Channel' : 'Apply to Channel';
    }
}

/**
 * Handle standard change event (legacy function, kept for compatibility)
 */
function onStandardChanged() {
    console.log('[EmbeddedMathEditor] Standard changed');
    refreshChannelGrid();
}

/**
 * Refresh the channel grid when channels change
 */
function refreshChannelGrid() {
    const grid = document.getElementById('emChannelGrid');
    if (grid) {
        grid.innerHTML = createChannelGridHTML();
        initChannelSelector(); // Rebind events
        initNewChannelButton(); // Rebind new channel button
    }
}

/**
 * Create channel grid HTML (separated for dynamic updates)
 */
function createChannelGridHTML() {
    const channels = getSVChannels();
    const voltageChannels = channels.filter(c => c.type === 'voltage');
    const currentChannels = channels.filter(c => c.type === 'current');
    const computedChannels = channels.filter(c => c.type === 'computed' || c.type === 'custom');
    
    let html = `
        <div class="em-channel-group">
            <span class="em-group-label">Voltage</span>
            <div class="em-channel-row">
                ${voltageChannels.map(createChannelButton).join('')}
            </div>
        </div>
        <div class="em-channel-group">
            <span class="em-group-label">Current</span>
            <div class="em-channel-row">
                ${currentChannels.map(createChannelButton).join('')}
            </div>
        </div>
    `;
    
    // Add computed/custom channels if any
    if (computedChannels.length > 0) {
        html += `
            <div class="em-channel-group">
                <span class="em-group-label">Computed/Custom</span>
                <div class="em-channel-row">
                    ${computedChannels.map(createChannelButton).join('')}
                </div>
            </div>
        `;
    }
    
    // Add "+ New Channel" button if custom channels are allowed
    const allowCustom = store.allowsCustomChannels();
    if (allowCustom) {
        html += `
            <div class="em-channel-group em-new-channel-group">
                <button class="em-new-channel-btn" id="emNewChannelBtn" title="Create new custom channel">
                    <span class="plus-icon">+</span> New Channel
                </button>
            </div>
        `;
    }
    
    return html;
}

/**
 * Create the embedded editor HTML structure
 * Uses store to check if custom channels are allowed
 * @returns {string} HTML string
 */
function createEmbeddedEditorHTML() {
    const allowCustom = store.allowsCustomChannels();
    const config = store.config.standardConfig;
    const standardName = config?.name || 'IEC 61850-9-2 LE';
    const maxChannels = config?.maxChannels || 8;
    
    return `
        <div class="embedded-math-editor">
            <!-- Current Standard Info Banner (Read-only - controlled from Step 1) -->
            <div class="em-standard-info-banner">
                <div class="em-current-standard">
                    <span class="em-standard-icon">⚡</span>
                    <span class="em-standard-name">${standardName}</span>
                    <span class="em-standard-badge ${allowCustom ? 'em-badge-success' : 'em-badge-locked'}">
                        ${allowCustom ? `✓ Up to ${maxChannels} channels` : '🔒 Fixed 8 channels'}
                    </span>
                </div>
                <div class="em-standard-hint">
                    Change standard in <strong>Step 1</strong> above
                </div>
            </div>
            

            
            <!-- Channel Selector -->
            <div class="em-section">
                <div class="em-section-header">
                    <h4>📡 Select Channel to Edit</h4>
                    <span class="em-channel-count" id="emChannelCount">${getSVChannels().length} channels</span>
                </div>
                <div class="em-channel-grid" id="emChannelGrid">
                    ${createChannelGridHTML()}
                </div>
            </div>
            
            <!-- Insert Buttons -->
            <div class="em-section">
                <div class="em-insert-groups">
                    <div class="em-insert-group">
                        <span class="em-group-label">Operators</span>
                        <div class="em-insert-buttons">
                            ${OPERATORS.map(createInsertButton).join('')}
                        </div>
                    </div>
                    <div class="em-insert-group">
                        <span class="em-group-label">Functions</span>
                        <div class="em-insert-buttons">
                            ${FUNCTIONS.map(createInsertButton).join('')}
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- MathLive Field -->
            <div class="em-section">
                <div class="em-section-header">
                    <h4>✏️ Equation (LaTeX)</h4>
                    <span class="em-active-channel" id="emActiveChannel">Select a channel</span>
                    <button class="btn btn-small btn-outline em-cancel-btn" id="emCancelNewChannel" style="display: none;">Cancel</button>
                </div>
                
                <math-field id="emMathField" 
                           class="em-math-field" 
                           virtual-keyboard-mode="manual"
                           placeholder="Click a channel above, then enter equation...">
                </math-field>
                
                <!-- Hint for new channel format -->
                <div class="em-new-channel-hint" id="emNewChannelHint" style="display: none;">
                    💡 Format: <code>ChannelName = equation</code> (e.g., V0 = 325 * sin(2 * PI * 50 * t)) or just equation for auto-named channel
                </div>
            </div>
            
            <!-- Preview & Validation -->
            <div class="em-section em-preview-section">
                <div class="em-preview-row">
                    <div class="em-preview-box">
                        <label>math.js Expression:</label>
                        <code id="emMathJsPreview">--</code>
                    </div>
                    <div class="em-status-box" id="emStatusBox">
                        <span class="em-status-icon">⏳</span>
                        <span class="em-status-text">Select a channel to edit</span>
                    </div>
                </div>
            </div>
            
            <!-- Actions -->
            <div class="em-actions">
                <button class="btn btn-small btn-outline" id="emTestBtn" disabled>
                    <span class="icon">🧪</span> Test
                </button>
                <button class="btn btn-small btn-outline" id="emClearBtn">
                    <span class="icon">🗑️</span> Clear
                </button>
                <button class="btn btn-small btn-primary" id="emApplyBtn" disabled>
                    <span class="icon">✓</span> <span id="emApplyBtnText">Apply to Channel</span>
                </button>
            </div>
            
           
        </div>
    `;
}

/**
 * Initialize channel selector buttons
 */
function initChannelSelector() {
    const channelBtns = document.querySelectorAll('.em-channel-btn');
    
    channelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Exit new channel mode if active
            if (isCreatingNewChannel) {
                isCreatingNewChannel = false;
                
                // Remove highlight from new channel button
                const newChannelBtn = document.getElementById('emNewChannelBtn');
                if (newChannelBtn) {
                    newChannelBtn.classList.remove('active');
                }
                
                // Hide cancel button and hint
                const cancelBtn = document.getElementById('emCancelNewChannel');
                if (cancelBtn) cancelBtn.style.display = 'none';
                
                const hint = document.getElementById('emNewChannelHint');
                if (hint) hint.style.display = 'none';
                
                updateApplyButtonText();
            }
            
            // Remove active from all channel buttons
            channelBtns.forEach(b => b.classList.remove('active'));
            
            // Set active
            btn.classList.add('active');
            
            // Update current channel
            currentChannelId = btn.dataset.channel;
            
            // Update UI
            updateActiveChannelLabel();
            
            // Load existing equation for this channel
            loadChannelEquation(currentChannelId);
            
            // Enable action buttons
            document.getElementById('emTestBtn')?.removeAttribute('disabled');
            document.getElementById('emApplyBtn')?.removeAttribute('disabled');
            
            // Focus math field
            const mathField = document.getElementById('emMathField');
            if (mathField) {
                mathField.placeholder = 'Click a channel above, then enter equation...';
                mathField.focus();
            }
        });
    });
}

/**
 * Load existing equation from original input field
 * @param {string} channelId - Channel ID (Va, Vb, etc.)
 */
function loadChannelEquation(channelId) {
    const originalInput = document.getElementById(`eq${channelId}`);
    const mathField = document.getElementById('emMathField');
    
    if (originalInput && mathField) {
        const mathJsExpr = originalInput.value;
        // Convert math.js to LaTeX for display in MathLive
        const latexExpr = convertMathJsToLatex(mathJsExpr);
        mathField.value = latexExpr;
        
        // Update preview
        updatePreview(mathJsExpr);
    }
}

/**
 * Initialize insert buttons (operators and functions)
 */
function initInsertButtons() {
    const insertBtns = document.querySelectorAll('.em-insert-btn');
    
    insertBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mathField = document.getElementById('emMathField');
            if (!mathField) return;
            
            const latex = btn.dataset.latex;
            mathField.executeCommand(['insert', latex]);
            mathField.focus();
        });
    });
}

/**
 * Initialize MathLive field event listeners
 */
function initMathField() {
    const mathField = document.getElementById('emMathField');
    if (!mathField) return;
    
    // Disable sound effects to avoid play/pause errors
    mathField.setOptions({
        soundsDirectory: null,  // Disable all sounds
        plonkSound: null
    });
    
    // Listen for input changes
    mathField.addEventListener('input', (e) => {
        const latexValue = e.target.value;
        const mathJsExpr = convertLatexToMathJs(latexValue);
        updatePreview(mathJsExpr);
    });
}

/**
 * Update the math.js preview and validation status
 * @param {string} mathJsExpr - math.js expression
 */
function updatePreview(mathJsExpr) {
    const previewEl = document.getElementById('emMathJsPreview');
    const statusBox = document.getElementById('emStatusBox');
    
    if (previewEl) {
        previewEl.textContent = mathJsExpr || '--';
    }
    
    if (statusBox && mathJsExpr) {
        const validation = validateExpression(mathJsExpr);
        
        if (validation.valid) {
            statusBox.innerHTML = `
                <span class="em-status-icon success">✓</span>
                <span class="em-status-text success">Valid expression</span>
            `;
        } else {
            statusBox.innerHTML = `
                <span class="em-status-icon error">✗</span>
                <span class="em-status-text error">${validation.error}</span>
            `;
        }
    }
}

/**
 * Initialize action buttons
 */
function initActionButtons() {
    // Test button
    const testBtn = document.getElementById('emTestBtn');
    if (testBtn) {
        testBtn.addEventListener('click', handleTestEquation);
    }
    
    // Clear button
    const clearBtn = document.getElementById('emClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', handleClearEquation);
    }
    
    // Apply button
    const applyBtn = document.getElementById('emApplyBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', handleApplyEquation);
    }
}

/**
 * Handle test button click
 */
function handleTestEquation() {
    const mathField = document.getElementById('emMathField');
    if (!mathField) return;
    
    const mathJsExpr = convertLatexToMathJs(mathField.value);
    
    const validation = validateExpression(mathJsExpr);
    if (!validation.valid) {
        showToast(`Invalid: ${validation.error}`, 'error');
        return;
    }
    
    // Get frequency and sample rate
    const frequency = parseInt(document.getElementById('frequency')?.value) || 50;
    const smpRate = parseInt(document.getElementById('smpRate')?.value) || 4000;
    
    try {
        const compiled = window.math.compile(mathJsExpr);
        const samples = evaluateSamples(compiled, smpRate, frequency, smpRate);
        const stats = calculateStats(samples);
        
        showToast(`✓ Valid! Min: ${stats.min.toFixed(2)}, Max: ${stats.max.toFixed(2)}, RMS: ${stats.rms.toFixed(2)}`);
    } catch (error) {
        showToast(`Test error: ${error.message}`, 'error');
    }
}

/**
 * Handle clear button click
 */
function handleClearEquation() {
    const mathField = document.getElementById('emMathField');
    if (mathField) {
        mathField.value = '';
        updatePreview('');
    }
}

/**
 * Handle apply button click
 * Handles both creating new channels and updating existing ones
 */
function handleApplyEquation() {
    const mathField = document.getElementById('emMathField');
    if (!mathField) return;
    
    const mathJsExpr = convertLatexToMathJs(mathField.value);
    
    if (!mathJsExpr || !mathJsExpr.trim()) {
        showToast('Please enter an equation', 'warning');
        return;
    }
    
    // Handle new channel creation
    if (isCreatingNewChannel) {
        // Parse the expression to extract channel name and equation
        const { channelName, equation } = parseChannelDefinition(mathJsExpr);
        
        if (!equation || !equation.trim()) {
            showToast('Please enter a valid equation', 'warning');
            return;
        }
        
        // Validate the equation part
        const validation = validateExpression(equation);
        if (!validation.valid) {
            showToast(`Invalid equation: ${validation.error}`, 'error');
            return;
        }
        
        // Check if channel name already exists
        const existingChannels = getSVChannels();
        if (existingChannels.some(c => c.id === channelName)) {
            showToast(`Channel '${channelName}' already exists`, 'error');
            return;
        }
        
        // Create the channel object
        const channelObj = {
            id: channelName,
            label: channelName,
            equation: equation,
            type: 'custom',
            description: `Custom channel: ${channelName}`
        };
        
        // Add channel using store
        const success = store.addChannel(channelObj);
        if (success) {
            ensureHiddenInput(channelObj);
            showToast(`Channel '${channelName}' created: ${equation}`, 'success');
            
            // Exit creation mode and refresh
            exitNewChannelMode();
            refreshChannelGrid();
        } else {
            showToast('Failed to create channel (max channels reached?)', 'error');
        }
        return;
    }
    
    // Handle existing channel update
    if (!currentChannelId) {
        showToast('Please select a channel first', 'warning');
        return;
    }
    
    // Validate before applying
    const validation = validateExpression(mathJsExpr);
    if (!validation.valid) {
        showToast(`Cannot apply invalid equation: ${validation.error}`, 'error');
        return;
    }
    
    // Update the original hidden input field
    const originalInput = document.getElementById(`eq${currentChannelId}`);
    if (originalInput) {
        originalInput.value = mathJsExpr;
        showToast(`Equation applied to ${currentChannelId}`, 'success');
    }
}

/**
 * Initialize quick templates
 */
function initQuickTemplates() {
    const templateBtns = document.querySelectorAll('[data-template]');
    
    templateBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const templateName = btn.dataset.template;
            applyQuickTemplate(templateName);
        });
    });
}

/**
 * Apply a quick template to all channels
 * @param {string} templateName - Template name
 */
function applyQuickTemplate(templateName) {
    const freq = parseInt(document.getElementById('frequency')?.value) || 50;
    
    const templates = {
        'balanced': {
            Va: `325 * sin(2 * PI * ${freq} * t)`,
            Vb: `325 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
            Vc: `325 * sin(2 * PI * ${freq} * t + 2*PI/3)`,
            Vn: '0',
            Ia: `100 * sin(2 * PI * ${freq} * t)`,
            Ib: `100 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
            Ic: `100 * sin(2 * PI * ${freq} * t + 2*PI/3)`,
            In: '0'
        },
        'fault': {
            Va: `50 * sin(2 * PI * ${freq} * t)`,
            Vb: `325 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
            Vc: `325 * sin(2 * PI * ${freq} * t + 2*PI/3)`,
            Vn: `100 * sin(2 * PI * ${freq} * t)`,
            Ia: `500 * sin(2 * PI * ${freq} * t)`,
            Ib: `100 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
            Ic: `100 * sin(2 * PI * ${freq} * t + 2*PI/3)`,
            In: `400 * sin(2 * PI * ${freq} * t)`
        },
        'harmonics': {
            Va: `325 * sin(2 * PI * ${freq} * t) + 30 * sin(6 * PI * ${freq} * t) + 15 * sin(10 * PI * ${freq} * t)`,
            Vb: `325 * sin(2 * PI * ${freq} * t - 2*PI/3) + 30 * sin(6 * PI * ${freq} * t - 2*PI/3)`,
            Vc: `325 * sin(2 * PI * ${freq} * t + 2*PI/3) + 30 * sin(6 * PI * ${freq} * t + 2*PI/3)`,
            Vn: '0',
            Ia: `100 * sin(2 * PI * ${freq} * t) + 10 * sin(6 * PI * ${freq} * t)`,
            Ib: `100 * sin(2 * PI * ${freq} * t - 2*PI/3) + 10 * sin(6 * PI * ${freq} * t - 2*PI/3)`,
            Ic: `100 * sin(2 * PI * ${freq} * t + 2*PI/3) + 10 * sin(6 * PI * ${freq} * t + 2*PI/3)`,
            In: '0'
        },
        'zero': {
            Va: '0', Vb: '0', Vc: '0', Vn: '0',
            Ia: '0', Ib: '0', Ic: '0', In: '0'
        }
    };
    
    const template = templates[templateName];
    if (!template) return;
    
    // Apply to all channels
    Object.entries(template).forEach(([channel, equation]) => {
        const input = document.getElementById(`eq${channel}`);
        if (input) {
            input.value = equation;
        }
    });
    
    // Update current channel in math field if one is selected
    if (currentChannelId && template[currentChannelId]) {
        const mathField = document.getElementById('emMathField');
        if (mathField) {
            mathField.value = convertMathJsToLatex(template[currentChannelId]);
            updatePreview(template[currentChannelId]);
        }
    }
    
    showToast(`Applied "${templateName}" template`);
}

/**
 * Ensure a hidden input exists for a channel
 * Creates one if it doesn't exist (for dynamic channels)
 * @param {Object} channel - Channel object
 */
function ensureHiddenInput(channel) {
    const inputId = `eq${channel.id}`;
    let input = document.getElementById(inputId);
    
    if (!input) {
        // Create hidden input for this channel
        input = document.createElement('input');
        input.type = 'hidden';
        input.id = inputId;
        input.value = channel.equation || '0';
        input.dataset.dynamicChannel = 'true';
        
        // Add to form or container
        const container = document.getElementById('embeddedEditorContainer');
        if (container) {
            container.appendChild(input);
            console.log(`[EmbeddedMathEditor] Created hidden input for ${channel.id}`);
        }
    }
}

/**
 * Check if MathLive is loaded
 * @memberof module:embeddedMathEditor
 * @returns {boolean}
 */
export function isMathLiveReady() {
    return mathLiveLoaded;
}

/**
 * Get all channel equations
 * @memberof module:embeddedMathEditor
 * @returns {Object} Channel IDs as keys and equations as values
 */
export function getAllEquations() {
    const equations = {};
    const channels = getSVChannels();
    
    channels.forEach(channel => {
        const input = document.getElementById(`eq${channel.id}`);
        if (input) {
            equations[channel.id] = input.value;
        } else {
            // Use channel's default equation if no input exists
            equations[channel.id] = channel.equation || '0';
        }
    });
    return equations;
}

/**
 * Export store and getSVChannels for external access
 */
export { store, getSVChannels };
