/**
 * @module mathLiveEditor
 * @description Modal Equation Editor using MathLive.
 * Provides rich math input capabilities.
 */

import { showToast } from '../plugins/toast.js';
import { convertLatexToMathJs, convertMathJsToLatex } from '../utils/expressionConverter.js';
import { validateExpression, testExpression } from '../utils/mathEvaluator.js';

let mathLiveLoaded = false;
let currentModal = null;
let currentMathField = null;

/**
 * Load MathLive from CDN on demand
 * @memberof module:mathLiveEditor
 * @async
 * @returns {Promise} Resolves when MathLive is ready
 */
export async function loadMathLive() {
    if (mathLiveLoaded && window.MathLive) {
        return window.MathLive;
    }

    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.MathLive) {
            mathLiveLoaded = true;
            resolve(window.MathLive);
            return;
        }

        console.log("[MathLive] Loading from CDN...");

        const script = document.createElement("script");
        script.src = "https://unpkg.com/mathlive@0.95.5/dist/mathlive.min.js";
        script.async = true;

        script.onload = () => {
            console.log("[MathLive] Loaded successfully");
            mathLiveLoaded = true;
            resolve(window.MathLive);
        };

        script.onerror = () => {
            reject(new Error("Failed to load MathLive"));
        };

        document.head.appendChild(script);

        // Also load the CSS
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/mathlive@0.95.5/dist/mathlive-fonts.css";
        document.head.appendChild(link);
    });
}

/**
 * Available channel buttons for quick insertion
 */
const CHANNEL_BUTTONS = [
    { label: 'V_a', latex: 'V_{a}', title: 'Voltage Phase A' },
    { label: 'V_b', latex: 'V_{b}', title: 'Voltage Phase B' },
    { label: 'V_c', latex: 'V_{c}', title: 'Voltage Phase C' },
    { label: 'V_n', latex: 'V_{n}', title: 'Voltage Neutral' },
    { label: 'I_a', latex: 'I_{a}', title: 'Current Phase A' },
    { label: 'I_b', latex: 'I_{b}', title: 'Current Phase B' },
    { label: 'I_c', latex: 'I_{c}', title: 'Current Phase C' },
    { label: 'I_n', latex: 'I_{n}', title: 'Current Neutral' }
];

/**
 * Math function buttons for quick insertion
 */
const FUNCTION_BUTTONS = [
    { label: '√', latex: '\\sqrt{}', title: 'Square Root' },
    { label: 'sin', latex: '\\sin()', title: 'Sine' },
    { label: 'cos', latex: '\\cos()', title: 'Cosine' },
    { label: 'tan', latex: '\\tan()', title: 'Tangent' },
    { label: 'π', latex: '\\pi', title: 'Pi' },
    { label: '²', latex: '^{2}', title: 'Square' },
    { label: 'abs', latex: '\\left|\\right|', title: 'Absolute Value' },
    { label: 'frac', latex: '\\frac{}{}', title: 'Fraction' }
];

/**
 * Create the MathLive editor modal HTML
 * @returns {string} HTML string
 */
function createModalHTML() {
    return `
        <div class="mathlive-modal-overlay" id="mathLiveModalOverlay">
            <div class="mathlive-modal">
                <div class="mathlive-modal-header">
                    <h3>✏️ Equation Editor</h3>
                    <button class="mathlive-close-btn" id="mathLiveCloseBtn">&times;</button>
                </div>
                
                <div class="mathlive-modal-body">
                    <!-- Channel Buttons -->
                    <div class="mathlive-button-row">
                        <span class="mathlive-row-label">Channels:</span>
                        <div class="mathlive-buttons" id="channelButtons"></div>
                    </div>
                    
                    <!-- Function Buttons -->
                    <div class="mathlive-button-row">
                        <span class="mathlive-row-label">Functions:</span>
                        <div class="mathlive-buttons" id="functionButtons"></div>
                    </div>
                    
                    <!-- MathLive Input Field -->
                    <div class="mathlive-input-container">
                        <label>Enter Equation (LaTeX):</label>
                        <math-field id="mathLiveField" class="mathlive-field"></math-field>
                    </div>
                    
                    <!-- Preview -->
                    <div class="mathlive-preview">
                        <label>math.js Expression:</label>
                        <code id="mathJsPreview">--</code>
                    </div>
                    
                    <!-- Validation Status -->
                    <div class="mathlive-status" id="mathLiveStatus"></div>
                </div>
                
                <div class="mathlive-modal-footer">
                    <button class="btn btn-outline" id="mathLiveTestBtn">🧪 Test</button>
                    <button class="btn btn-outline" id="mathLiveClearBtn">🗑️ Clear</button>
                    <button class="btn btn-primary" id="mathLiveApplyBtn">✓ Apply</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Add MathLive modal styles to document
 */
function addModalStyles() {
    if (document.getElementById('mathlive-modal-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'mathlive-modal-styles';
    styles.textContent = `
        .mathlive-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        
        .mathlive-modal-overlay.show {
            opacity: 1;
        }
        
        .mathlive-modal {
            background: var(--bg-secondary, #ffffff);
            border-radius: 12px;
            width: 90%;
            max-width: 600px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            transform: scale(0.9);
            transition: transform 0.2s ease;
        }
        
        .mathlive-modal-overlay.show .mathlive-modal {
            transform: scale(1);
        }
        
        .mathlive-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border-color, #e2e8f0);
        }
        
        .mathlive-modal-header h3 {
            margin: 0;
            font-size: 18px;
            color: var(--text-primary, #1e293b);
        }
        
        .mathlive-close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: var(--text-muted, #64748b);
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.15s;
        }
        
        .mathlive-close-btn:hover {
            background: var(--bg-tertiary, #f1f5f9);
            color: var(--text-primary, #1e293b);
        }
        
        .mathlive-modal-body {
            padding: 20px;
        }
        
        .mathlive-button-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .mathlive-row-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted, #64748b);
            min-width: 70px;
        }
        
        .mathlive-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        
        .mathlive-btn {
            padding: 6px 12px;
            font-size: 13px;
            border: 1px solid var(--border-color, #e2e8f0);
            background: var(--bg-tertiary, #f8fafc);
            color: var(--text-primary, #1e293b);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
            font-family: 'KaTeX_Math', 'Times New Roman', serif;
        }
        
        .mathlive-btn:hover {
            background: var(--accent-gradient, linear-gradient(135deg, #667eea, #764ba2));
            color: white;
            border-color: transparent;
        }
        
        .mathlive-input-container {
            margin-bottom: 16px;
        }
        
        .mathlive-input-container label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted, #64748b);
            margin-bottom: 8px;
        }
        
        .mathlive-field {
            width: 100%;
            min-height: 60px;
            padding: 12px;
            font-size: 20px;
            border: 2px solid var(--border-color, #e2e8f0);
            border-radius: 8px;
            background: var(--bg-primary, #ffffff);
            transition: border-color 0.15s;
        }
        
        .mathlive-field:focus-within {
            border-color: var(--accent-primary, #667eea);
            outline: none;
        }
        
        .mathlive-preview {
            background: var(--bg-tertiary, #f1f5f9);
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 16px;
        }
        
        .mathlive-preview label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted, #64748b);
            margin-bottom: 6px;
        }
        
        .mathlive-preview code {
            font-family: 'Fira Code', 'Consolas', monospace;
            font-size: 13px;
            color: var(--accent-cyan, #06b6d4);
            word-break: break-all;
        }
        
        .mathlive-status {
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 13px;
            display: none;
        }
        
        .mathlive-status.success {
            display: block;
            background: rgba(34, 197, 94, 0.15);
            color: #166534;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }
        
        .mathlive-status.error {
            display: block;
            background: rgba(239, 68, 68, 0.15);
            color: #991b1b;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .mathlive-modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid var(--border-color, #e2e8f0);
            background: var(--bg-tertiary, #f8fafc);
            border-radius: 0 0 12px 12px;
        }
    `;
    document.head.appendChild(styles);
}

/**
 * Open the MathLive editor modal
 * @memberof module:mathLiveEditor
 * @async
 * @param {Object} options - Options object
 * @param {string} options.initialValue - Initial equation value
 * @param {string} options.targetInputId - ID of input to update on apply
 * @param {Function} options.onApply - Callback when equation is applied
 * @param {Function} options.onClose - Callback when modal is closed
 */
export async function openMathLiveEditor(options = {}) {
    const { initialValue = '', targetInputId = null, onApply = null, onClose = null } = options;

    try {
        // Load MathLive first
        await loadMathLive();

        // Add styles
        addModalStyles();

        // Remove existing modal if any
        closeModal();

        // Create modal
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = createModalHTML();
        document.body.appendChild(modalContainer.firstElementChild);

        currentModal = document.getElementById('mathLiveModalOverlay');

        // Setup channel buttons
        const channelButtonsContainer = document.getElementById('channelButtons');
        CHANNEL_BUTTONS.forEach(btn => {
            const button = document.createElement('button');
            button.className = 'mathlive-btn';
            button.textContent = btn.label;
            button.title = btn.title;
            button.onclick = () => insertLatex(btn.latex);
            channelButtonsContainer.appendChild(button);
        });

        // Setup function buttons
        const functionButtonsContainer = document.getElementById('functionButtons');
        FUNCTION_BUTTONS.forEach(btn => {
            const button = document.createElement('button');
            button.className = 'mathlive-btn';
            button.textContent = btn.label;
            button.title = btn.title;
            button.onclick = () => insertLatex(btn.latex);
            functionButtonsContainer.appendChild(button);
        });

        // Initialize MathLive field
        currentMathField = document.getElementById('mathLiveField');
        
        // Set initial value if provided
        if (initialValue) {
            // Convert math.js to LaTeX if needed
            const latex = initialValue.includes('\\') ? initialValue : convertMathJsToLatex(initialValue);
            currentMathField.value = latex;
        }

        // Listen for input changes
        currentMathField.addEventListener('input', () => {
            updatePreview();
        });

        // Close button
        document.getElementById('mathLiveCloseBtn').onclick = () => {
            closeModal();
            if (onClose) onClose();
        };

        // Click outside to close
        currentModal.onclick = (e) => {
            if (e.target === currentModal) {
                closeModal();
                if (onClose) onClose();
            }
        };

        // Test button
        document.getElementById('mathLiveTestBtn').onclick = () => {
            testCurrentExpression();
        };

        // Clear button
        document.getElementById('mathLiveClearBtn').onclick = () => {
            currentMathField.value = '';
            updatePreview();
            setStatus('', '');
        };

        // Apply button
        document.getElementById('mathLiveApplyBtn').onclick = () => {
            const latex = currentMathField.value;
            const mathJs = convertLatexToMathJs(latex);
            
            // Validate
            const validation = validateExpression(mathJs);
            if (!validation.valid) {
                setStatus('error', `Invalid expression: ${validation.error}`);
                return;
            }

            // Update target input if specified
            if (targetInputId) {
                const targetInput = document.getElementById(targetInputId);
                if (targetInput) {
                    targetInput.value = mathJs;
                }
            }

            // Call onApply callback
            if (onApply) {
                onApply({
                    latex: latex,
                    mathJs: mathJs
                });
            }

            showToast('Equation applied');
            closeModal();
        };

        // Show modal with animation
        requestAnimationFrame(() => {
            currentModal.classList.add('show');
            currentMathField.focus();
        });

        // Initial preview update
        updatePreview();

        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                if (onClose) onClose();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

    } catch (error) {
        console.error('[MathLive] Error opening editor:', error);
        showToast('Failed to load equation editor', 'error');
    }
}

/**
 * Insert LaTeX at cursor position in math field
 * @param {string} latex - LaTeX to insert
 */
function insertLatex(latex) {
    if (!currentMathField) return;
    currentMathField.insert(latex);
    currentMathField.focus();
    updatePreview();
}

/**
 * Update the math.js preview
 */
function updatePreview() {
    const preview = document.getElementById('mathJsPreview');
    if (!preview || !currentMathField) return;

    const latex = currentMathField.value;
    if (!latex) {
        preview.textContent = '--';
        return;
    }

    const mathJs = convertLatexToMathJs(latex);
    preview.textContent = mathJs || '--';
}

/**
 * Test the current expression
 */
function testCurrentExpression() {
    if (!currentMathField) return;

    const latex = currentMathField.value;
    if (!latex) {
        setStatus('error', 'Please enter an expression first');
        return;
    }

    const mathJs = convertLatexToMathJs(latex);
    const result = testExpression(mathJs, { t: 0, PI: Math.PI });

    if (result.valid) {
        setStatus('success', `✓ Valid expression. Test result at t=0: ${result.result.toFixed(4)}`);
    } else {
        setStatus('error', `✗ ${result.error}`);
    }
}

/**
 * Set status message
 * @param {string} type - 'success' or 'error'
 * @param {string} message - Status message
 */
function setStatus(type, message) {
    const status = document.getElementById('mathLiveStatus');
    if (!status) return;

    status.className = 'mathlive-status';
    if (type) {
        status.classList.add(type);
        status.textContent = message;
    }
}

/**
 * Close the modal
 */
function closeModal() {
    if (currentModal) {
        currentModal.classList.remove('show');
        setTimeout(() => {
            currentModal.remove();
            currentModal = null;
            currentMathField = null;
        }, 200);
    }
}

/**
 * Check if MathLive is loaded
 * @memberof module:mathLiveEditor
 * @returns {boolean}
 */
export function isMathLiveLoaded() {
    return mathLiveLoaded && !!window.MathLive;
}
