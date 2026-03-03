/**
 * @module equationEditor
 * @file equationEditor.js
 * @description MathLive Equation Editor with Beautiful Math Rendering
 * 
 * Type "V0 = 325*sin(2*PI*50*t)" and press Enter to create a channel.
 * Features pretty math rendering using MathLive.
 * 
 * @author SV-PUB Team
 * @date 2025
 */

import { showToast } from '../plugins/toast.js';
import { store, ADDITIONAL_CHANNELS } from '../store/index.js';

// ============================================================================
// STATE
// ============================================================================

let mathLiveLoaded = false;
let mathLiveReady = false;

// ============================================================================
// MATHLIVE LOADER
// ============================================================================

async function loadMathLive() {
    if (mathLiveLoaded && mathLiveReady) return true;

    return new Promise((resolve) => {
        // Check if already loaded
        if (customElements.get('math-field')) {
            mathLiveLoaded = true;
            mathLiveReady = true;
            console.log('[MathLive] Already loaded');
            resolve(true);
            return;
        }

        // Load CSS
        if (!document.querySelector('link[href*="mathlive"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/mathlive@0.101.0/dist/mathlive-static.css';
            document.head.appendChild(link);
        }

        // Load JS
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/mathlive@0.101.0/dist/mathlive.min.js';
        script.onload = () => {
            mathLiveLoaded = true;
            // Wait for custom element to be defined
            customElements.whenDefined('math-field').then(() => {
                mathLiveReady = true;
                console.log('[MathLive] Ready');
                resolve(true);
            }).catch(() => resolve(false));
        };
        script.onerror = () => {
            console.error('[MathLive] Failed to load');
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

// ============================================================================
// RENDER
// ============================================================================

function render() {
    const config = store.config.standardConfig;
    const channels = store.getChannels();
    const allowCustom = store.allowsCustomChannels();
    const existingIds = channels.map(c => c.id);
    
    // Filter out already added channels from the quick add palette
    const availableToAdd = ADDITIONAL_CHANNELS.filter(c => !existingIds.includes(c.id));

    return `
        <div class="eq-editor">
            <!-- Header -->
            <div class="eq-header">
                <div class="eq-standard">
                    <span class="eq-std-icon">⚡</span>
                    <span class="eq-std-name">${config.name}</span>
                    <span class="eq-std-badge">${channels.length} / ${config.maxChannels}</span>
                </div>
                ${!allowCustom ? '<span class="eq-locked">🔒 Fixed channels (switch to IEC 61869 for custom)</span>' : ''}
            </div>

            <!-- Quick Add Palette -->
            ${allowCustom && availableToAdd.length > 0 ? `
            <div class="eq-quick-add">
                <label>⚡ Quick Add (click to add):</label>
                <div class="eq-quick-buttons">
                    ${availableToAdd.map(ch => `
                        <button class="eq-quick-btn" data-quickadd="${ch.id}" title="${ch.description}&#10;${ch.equation}">
                            ${ch.label}
                        </button>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- Main Input - MathLive for pretty math -->
            <div class="eq-main-input">
                <label>Or type custom equation and press Enter:</label>
                <math-field id="eqMainField" 
                    placeholder="V0 = 325 \\cdot \\sin(2\\pi \\cdot 50 \\cdot t)"
                    virtual-keyboard-mode="manual"
                    smart-fence="true"
                    smart-superscript="true"
                ></math-field>
                <div class="eq-hint">
                    Format: <code>ChannelName = equation</code> | 
                    Press <kbd>Enter</kbd> to add/update
                </div>
            </div>

            <!-- Channel List -->
            <div class="eq-channels">
                <h4>📡 Active Channels (${channels.length})</h4>
                <div class="eq-channel-list">
                    ${channels.map(ch => renderChannel(ch, allowCustom)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderChannel(channel, allowCustom) {
    const canDelete = !channel.isBase && allowCustom;
    const typeClass = channel.type;
    const latexEq = mathJsToLatex(channel.equation);
    
    return `
        <div class="eq-channel ${typeClass}" data-id="${channel.id}">
            <div class="eq-ch-label" style="border-left-color: ${channel.color}">
                <span class="eq-ch-name">${channel.id}</span>
                <span class="eq-ch-type">${channel.type}</span>
            </div>
            <math-field class="eq-ch-field" 
                data-channel="${channel.id}"
                virtual-keyboard-mode="manual"
                smart-fence="true"
            >${latexEq}</math-field>
            ${canDelete ? `<button class="eq-ch-delete" data-delete="${channel.id}" title="Delete">🗑️</button>` : ''}
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

function mathJsToLatex(expr) {
    if (!expr) return '';
    return expr
        .replace(/\*/g, ' \\cdot ')
        .replace(/PI/gi, '\\pi')
        .replace(/sin\(/gi, '\\sin(')
        .replace(/cos\(/gi, '\\cos(')
        .replace(/tan\(/gi, '\\tan(')
        .replace(/sqrt\(/gi, '\\sqrt{')
        .replace(/\^(\d+)/g, '^{$1}')
        .replace(/\^(\([^)]+\))/g, '^{$1}');
}

function latexToMathJs(latex) {
    if (!latex) return '';
    return latex
        .replace(/\\cdot\s*/g, '*')
        .replace(/\\times\s*/g, '*')
        .replace(/\\pi/g, 'PI')
        .replace(/\\sin\s*/g, 'sin')
        .replace(/\\cos\s*/g, 'cos')
        .replace(/\\tan\s*/g, 'tan')
        .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
        .replace(/\^{([^}]+)}/g, '^($1)')
        .replace(/\{/g, '(')
        .replace(/\}/g, ')')
        .replace(/\\left/g, '')
        .replace(/\\right/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseEquation(latex) {
    // Convert LaTeX to math.js format first
    const text = latexToMathJs(latex);
    
    // Parse: ChannelName = Equation
    const match = text.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) return null;
    
    return {
        channelId: match[1],
        equation: match[2].trim()
    };
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function bindEvents() {
    const container = document.getElementById('embeddedEditorContainer');
    if (!container) return;

    // Quick Add buttons
    container.querySelectorAll('.eq-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const channelId = btn.dataset.quickadd;
            const channelDef = ADDITIONAL_CHANNELS.find(c => c.id === channelId);
            if (channelDef) {
                handleQuickAdd(channelDef);
            }
        });
    });

    // Main MathLive input - use 'change' event (fires on Enter/blur)
    const mainField = container.querySelector('#eqMainField');
    if (mainField) {
        // MathLive 'change' event fires when user presses Enter or leaves field
        mainField.addEventListener('change', (e) => {
            const latex = mainField.getValue ? mainField.getValue() : mainField.value;
            if (latex && latex.trim()) {
                handleAddChannel(latex);
                // Clear the field
                if (mainField.setValue) {
                    mainField.setValue('');
                } else {
                    mainField.value = '';
                }
            }
        });
    }

    // Channel MathLive fields - update equation on change
    container.querySelectorAll('.eq-ch-field').forEach(field => {
        field.addEventListener('change', () => {
            const channelId = field.dataset.channel;
            const latex = field.getValue ? field.getValue() : field.value;
            const equation = latexToMathJs(latex);
            store.updateEquation(channelId, equation);
            updateHiddenInput(channelId, equation);
            showToast(`${channelId} updated`, 'success');
        });
    });

    // Delete buttons
    container.querySelectorAll('.eq-ch-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.delete;
            if (confirm(`Delete channel ${id}?`)) {
                store.removeChannel(id);
                removeHiddenInput(id);
                refresh();
                showToast(`${id} deleted`, 'info');
            }
        });
    });
}

/**
 * Handle quick add button click
 */
function handleQuickAdd(channelDef) {
    const channel = store.parseAndAddChannel(`${channelDef.id} = ${channelDef.equation}`);
    if (channel) {
        createHiddenInput(channel.id, channelDef.equation);
        showToast(`✓ ${channelDef.id} added: ${channelDef.description}`, 'success');
        refresh();
    }
}

function handleAddChannel(latex) {
    const parsed = parseEquation(latex);
    
    if (!parsed) {
        showToast('Format: ChannelName = equation (e.g., V0 = Va + Vb + Vc)', 'error');
        return;
    }

    const { channelId, equation } = parsed;

    // Check if it's an existing channel (update it)
    const existing = store.getChannel(channelId);
    if (existing) {
        store.updateEquation(channelId, equation);
        updateHiddenInput(channelId, equation);
        showToast(`${channelId} updated!`, 'success');
        refresh();
        return;
    }

    // Add new channel
    const channel = store.parseAndAddChannel(`${channelId} = ${equation}`);
    if (channel) {
        createHiddenInput(channel.id, equation);
        showToast(`✓ Channel ${channelId} created!`, 'success');
        refresh();
    }
}

// ============================================================================
// HIDDEN INPUTS (for form submission)
// ============================================================================

function createHiddenInput(id, equation) {
    if (document.getElementById(`eq${id}`)) return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = `eq${id}`;
    input.name = `eq${id}`;
    input.value = equation;
    document.getElementById('embeddedEditorContainer')?.appendChild(input);
}

function updateHiddenInput(id, equation) {
    let input = document.getElementById(`eq${id}`);
    if (!input) {
        createHiddenInput(id, equation);
    } else {
        input.value = equation;
    }
}

function removeHiddenInput(id) {
    document.getElementById(`eq${id}`)?.remove();
}

function initHiddenInputs() {
    store.getChannels().forEach(ch => {
        createHiddenInput(ch.id, ch.equation);
    });
}

// ============================================================================
// REFRESH
// ============================================================================

function refresh() {
    const container = document.getElementById('embeddedEditorContainer');
    if (container) {
        container.innerHTML = render();
        bindEvents();
    }
}

// ============================================================================
// INIT
// ============================================================================

/**
 * Initialize the equation editor component
 * @memberof module:equationEditor
 * @async
 */
export async function initEquationEditor() {
    const container = document.getElementById('embeddedEditorContainer');
    if (!container) return;

    // Show loading
    container.innerHTML = '<div class="eq-loading"><div class="spinner"></div>Loading MathLive...</div>';

    // Load MathLive
    const loaded = await loadMathLive();
    
    if (!loaded) {
        container.innerHTML = '<div class="eq-error">⚠️ Failed to load MathLive. Please refresh.</div>';
        return;
    }

    // Wait a bit for custom elements to fully initialize
    await new Promise(r => setTimeout(r, 200));

    // Render
    container.innerHTML = render();
    
    // Wait for math-field elements to upgrade
    await new Promise(r => setTimeout(r, 100));
    
    bindEvents();
    initHiddenInputs();

    // Subscribe to standard changes
    store.onChange(() => {
        console.log('[EquationEditor] Standard changed, refreshing...');
        refresh();
    });

    console.log('[EquationEditor] Initialized with MathLive');
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Get all channel equations
 * @memberof module:equationEditor
 * @returns {Object} Channel IDs as keys and equations as values
 */
export function getAllEquations() {
    const equations = {};
    store.getChannels().forEach(c => {
        const input = document.getElementById(`eq${c.id}`);
        equations[c.id] = input?.value || c.equation;
    });
    return equations;
}
