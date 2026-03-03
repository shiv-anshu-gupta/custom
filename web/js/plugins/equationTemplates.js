/**
 * @file equationTemplates.js
 * @fileoverview Equation Template System Plugin
 * @module equationTemplates
 * @author SV-PUB Team
 * @description
 * Provides preset equation templates and MathLive editor integration.
 * 
 * **Templates:**
 * - Balanced 3-Phase (120° phase shift)
 * - Fault scenarios (A-G, B-G, C-G, AB, BC, CA)
 * - Custom equations
 * 
 * @example
 * import { initEquationTemplates, applyTemplate } from './plugins/equationTemplates.js';
 * initEquationTemplates();
 * applyTemplate('balanced');
 */

import { showToast } from './toast.js';
import { openMathLiveEditor } from '../components/mathLiveEditor.js';
import { convertLatexToMathJs, convertMathJsToLatex } from '../utils/expressionConverter.js';
import { validateExpression, evaluateSamples, calculateStats } from '../utils/mathEvaluator.js';

/**
 * Initialize equation template buttons and editor integration
 * @memberof module:equationTemplates
 */
export function initEquationTemplates() {
    // Template buttons
    const templateBtns = document.querySelectorAll('[data-template]');

    templateBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            const templateName = this.getAttribute('data-template');
            applyTemplate(templateName);
        });
    });

    // Open full editor button - now opens MathLive
    const openEditorBtn = document.getElementById('openFullEditor');
    if (openEditorBtn) {
        openEditorBtn.addEventListener('click', function() {
            openEquationEditor();
        });
    }

    // Add click handlers to equation input fields for MathLive editing
    const equationInputs = ['eqVa', 'eqVb', 'eqVc', 'eqVn', 'eqIa', 'eqIb', 'eqIc', 'eqIn'];
    equationInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            // Add edit button next to each input
            addEditButton(input, id);
        }
    });
}

/**
 * Add an edit button next to an equation input
 * @private
 * @param {HTMLElement} input - Input element
 * @param {string} inputId - Input ID
 */
function addEditButton(input, inputId) {
    // Check if button already exists
    if (input.parentElement.querySelector('.eq-edit-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eq-edit-btn';
    btn.innerHTML = '✏️';
    btn.title = 'Open Equation Editor';
    btn.style.cssText = `
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        font-size: 14px;
        opacity: 0.6;
        transition: opacity 0.15s;
        padding: 4px;
    `;

    btn.onmouseover = () => btn.style.opacity = '1';
    btn.onmouseout = () => btn.style.opacity = '0.6';

    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMathLiveEditor({
            initialValue: input.value,
            targetInputId: inputId,
            onApply: (result) => {
                input.value = result.mathJs;
                showToast(`Equation updated for ${inputId.replace('eq', '')}`);
            }
        });
    };

    // Make parent relative for positioning
    if (getComputedStyle(input.parentElement).position === 'static') {
        input.parentElement.style.position = 'relative';
    }

    input.parentElement.appendChild(btn);
}

/**
 * Open the main equation editor modal
 */
function openEquationEditor() {
    openMathLiveEditor({
        initialValue: '',
        onApply: (result) => {
            // Preview the generated waveform
            previewEquation(result.mathJs);
        }
    });
}

/**
 * Preview an equation by evaluating and showing stats
 * @param {string} equation - Math.js expression
 */
function previewEquation(equation) {
    const frequency = parseInt(document.getElementById('frequency')?.value) || 50;
    const smpRate = parseInt(document.getElementById('smpRate')?.value) || 4000;

    const validation = validateExpression(equation);
    if (!validation.valid) {
        showToast(`Invalid equation: ${validation.error}`, 'error');
        return;
    }

    try {
        const compiled = window.math.compile(equation);
        const samples = evaluateSamples(compiled, smpRate, frequency, smpRate);
        const stats = calculateStats(samples);

        showToast(`Equation valid! Min: ${stats.min.toFixed(2)}, Max: ${stats.max.toFixed(2)}, RMS: ${stats.rms.toFixed(2)}`);
    } catch (error) {
        showToast(`Evaluation error: ${error.message}`, 'error');
    }
}

/**
 * Apply a template to the equation inputs
 * @memberof module:equationTemplates
 * @param {string} templateName - Template name: 'balanced', 'fault'
 */
export function applyTemplate(templateName) {
    const freq = parseInt(document.getElementById('frequency').value) || 50;

    // Define templates
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
            Vn: `275 * sin(2 * PI * ${freq} * t + PI)`,
            Ia: `2000 * sin(2 * PI * ${freq} * t)`,
            Ib: `100 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
            Ic: `100 * sin(2 * PI * ${freq} * t + 2*PI/3)`,
            In: `1800 * sin(2 * PI * ${freq} * t + PI)`
        },
        'zero': {
            Va: '0',
            Vb: '0',
            Vc: '0',
            Vn: '0',
            Ia: '0',
            Ib: '0',
            Ic: '0',
            In: '0'
        }
    };

    // Get selected template
    const template = templates[templateName];

    if (!template) {
        showToast('Unknown template: ' + templateName, 'error');
        return;
    }

    // Apply template values to inputs
    document.getElementById('eqVa').value = template.Va;
    document.getElementById('eqVb').value = template.Vb;
    document.getElementById('eqVc').value = template.Vc;
    document.getElementById('eqVn').value = template.Vn;
    document.getElementById('eqIa').value = template.Ia;
    document.getElementById('eqIb').value = template.Ib;
    document.getElementById('eqIc').value = template.Ic;
    document.getElementById('eqIn').value = template.In;

    // Show feedback
    const templateNames = {
        'balanced': 'Balanced 3-Phase',
        'fault': 'Phase A Fault',
        'zero': 'All Zero'
    };

    showToast('Applied template: ' + templateNames[templateName]);
}

/**
 * Update equation inputs with new frequency
 * @memberof module:equationTemplates
 * @param {number} freq - Frequency value (50 or 60 Hz)
 */
export function updateEquationFrequency(freq) {
    const equations = {
        'eqVa': `325 * sin(2 * PI * ${freq} * t)`,
        'eqVb': `325 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
        'eqVc': `325 * sin(2 * PI * ${freq} * t + 2*PI/3)`,
        'eqIa': `100 * sin(2 * PI * ${freq} * t)`,
        'eqIb': `100 * sin(2 * PI * ${freq} * t - 2*PI/3)`,
        'eqIc': `100 * sin(2 * PI * ${freq} * t + 2*PI/3)`
    };

    Object.keys(equations).forEach(function(id) {
        const element = document.getElementById(id);
        if (element) {
            element.value = equations[id];
        }
    });
}

/**
 * Get all current equations
 * @memberof module:equationTemplates
 * @returns {Object} {Va, Vb, Vc, Vn, Ia, Ib, Ic, In}
 */
export function getAllEquations() {
    return {
        Va: document.getElementById('eqVa')?.value || '0',
        Vb: document.getElementById('eqVb')?.value || '0',
        Vc: document.getElementById('eqVc')?.value || '0',
        Vn: document.getElementById('eqVn')?.value || '0',
        Ia: document.getElementById('eqIa')?.value || '0',
        Ib: document.getElementById('eqIb')?.value || '0',
        Ic: document.getElementById('eqIc')?.value || '0',
        In: document.getElementById('eqIn')?.value || '0'
    };
}

/**
 * Validate all equations
 * @memberof module:equationTemplates
 * @returns {Object} {valid: boolean, errors: Array}
 */
export function validateAllEquations() {
    const equations = getAllEquations();
    const errors = [];

    Object.entries(equations).forEach(([channel, equation]) => {
        if (equation && equation !== '0') {
            const validation = validateExpression(equation);
            if (!validation.valid) {
                errors.push({ channel, error: validation.error });
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors
    };
}
