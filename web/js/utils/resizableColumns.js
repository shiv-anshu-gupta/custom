/**
 * @file resizableColumns.js
 * @fileoverview VS Code-style draggable column resizer for three-column layout
 * @module utils/resizableColumns
 * @description
 * Enables drag-to-resize between the three main columns (left, middle, right).
 * Two resize handles sit between adjacent columns. Dragging a handle redistributes
 * column widths while respecting minimum width constraints.
 *
 * Behavior mirrors VS Code's sidebar splitters:
 * - Handle highlights on hover (blue accent)
 * - Smooth dragging with no text selection
 * - Persists widths to localStorage
 * - Respects minimum column widths
 * - Double-click to reset to equal thirds
 */

/** Minimum column width in pixels */
const MIN_COLUMN_WIDTH = 200;

/** LocalStorage key for persisted column sizes */
const STORAGE_KEY = 'sv-pub-column-widths';

/**
 * Initialize resizable columns on the three-column layout.
 * Call once after DOM is ready.
 */
export function initResizableColumns() {
    const mainContent = document.getElementById('mainContent');
    const leftColumn = document.getElementById('leftColumn');
    const middleColumn = document.getElementById('middleColumn');
    const rightColumn = document.getElementById('rightColumn');
    const handleLeft = document.getElementById('resizeHandleLeft');
    const handleRight = document.getElementById('resizeHandleRight');

    if (!mainContent || !leftColumn || !middleColumn || !rightColumn || !handleLeft || !handleRight) {
        console.warn('[ResizableColumns] Required elements not found, skipping initialization.');
        return;
    }

    // Restore saved widths or use equal thirds
    restoreWidths(mainContent, leftColumn, middleColumn, rightColumn);

    // Setup drag for left handle (between left & middle columns)
    setupDragHandle(handleLeft, mainContent, leftColumn, middleColumn, rightColumn, 'left');

    // Setup drag for right handle (between middle & right columns)
    setupDragHandle(handleRight, mainContent, leftColumn, middleColumn, rightColumn, 'right');

    // Double-click to reset to equal thirds
    handleLeft.addEventListener('dblclick', () => resetWidths(mainContent, leftColumn, middleColumn, rightColumn));
    handleRight.addEventListener('dblclick', () => resetWidths(mainContent, leftColumn, middleColumn, rightColumn));
}

/**
 * Set up mouse drag behavior on a resize handle.
 * @param {HTMLElement} handle - The resize handle element
 * @param {HTMLElement} mainContent - The grid container
 * @param {HTMLElement} leftCol - Left column element
 * @param {HTMLElement} middleCol - Middle column element
 * @param {HTMLElement} rightCol - Right column element
 * @param {'left'|'right'} which - Which handle (left = between left & middle, right = between middle & right)
 */
function setupDragHandle(handle, mainContent, leftCol, middleCol, rightCol, which) {
    let startX = 0;
    let startLeftW = 0;
    let startMiddleW = 0;
    let startRightW = 0;

    function onMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();

        startX = e.clientX;
        startLeftW = leftCol.getBoundingClientRect().width;
        startMiddleW = middleCol.getBoundingClientRect().width;
        startRightW = rightCol.getBoundingClientRect().width;

        handle.classList.add('active');
        document.body.classList.add('resizing-columns');

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        const dx = e.clientX - startX;
        const totalWidth = startLeftW + startMiddleW + startRightW;

        let newLeftW, newMiddleW, newRightW;

        if (which === 'left') {
            // Dragging left handle: resize left & middle columns
            newLeftW = startLeftW + dx;
            newMiddleW = startMiddleW - dx;
            newRightW = startRightW;

            // Clamp to respect minimums
            if (newLeftW < MIN_COLUMN_WIDTH) {
                newLeftW = MIN_COLUMN_WIDTH;
                newMiddleW = totalWidth - newLeftW - newRightW;
            }
            if (newMiddleW < MIN_COLUMN_WIDTH) {
                newMiddleW = MIN_COLUMN_WIDTH;
                newLeftW = totalWidth - newMiddleW - newRightW;
            }
        } else {
            // Dragging right handle: resize middle & right columns
            newLeftW = startLeftW;
            newMiddleW = startMiddleW + dx;
            newRightW = startRightW - dx;

            // Clamp to respect minimums
            if (newMiddleW < MIN_COLUMN_WIDTH) {
                newMiddleW = MIN_COLUMN_WIDTH;
                newRightW = totalWidth - newLeftW - newMiddleW;
            }
            if (newRightW < MIN_COLUMN_WIDTH) {
                newRightW = MIN_COLUMN_WIDTH;
                newMiddleW = totalWidth - newLeftW - newRightW;
            }
        }

        // Apply as fractional units so the grid stays responsive
        applyWidths(mainContent, newLeftW, newMiddleW, newRightW);
    }

    function onMouseUp() {
        handle.classList.remove('active');
        document.body.classList.remove('resizing-columns');

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Persist current widths
        saveWidths(leftCol, middleCol, rightCol);
    }

    handle.addEventListener('mousedown', onMouseDown);
}

/**
 * Apply column widths to the grid container.
 * Uses pixel values in grid-template-columns, keeping the 4px handle columns fixed.
 */
function applyWidths(mainContent, leftW, middleW, rightW) {
    mainContent.style.gridTemplateColumns = `${leftW}px 4px ${middleW}px 4px ${rightW}px`;
}

/**
 * Save current column widths to localStorage as fractional ratios.
 */
function saveWidths(leftCol, middleCol, rightCol) {
    const leftW = leftCol.getBoundingClientRect().width;
    const middleW = middleCol.getBoundingClientRect().width;
    const rightW = rightCol.getBoundingClientRect().width;
    const total = leftW + middleW + rightW;

    if (total > 0) {
        const ratios = {
            left: leftW / total,
            middle: middleW / total,
            right: rightW / total
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(ratios));
        } catch { /* quota exceeded - ignore */ }
    }
}

/**
 * Restore saved column width ratios from localStorage.
 */
function restoreWidths(mainContent, leftCol, middleCol, rightCol) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const ratios = JSON.parse(saved);
            if (ratios.left && ratios.middle && ratios.right) {
                mainContent.style.gridTemplateColumns =
                    `${ratios.left}fr 4px ${ratios.middle}fr 4px ${ratios.right}fr`;
                return;
            }
        }
    } catch { /* corrupted data - fall through to default */ }

    // Default: equal thirds
    mainContent.style.gridTemplateColumns = '1fr 4px 1fr 4px 1fr';
}

/**
 * Reset columns to equal thirds and clear saved preference.
 */
function resetWidths(mainContent) {
    mainContent.style.gridTemplateColumns = '1fr 4px 1fr 4px 1fr';
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}
