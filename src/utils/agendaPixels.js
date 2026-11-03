// src/utils/agendaPixels.js
// The drawing logic behind the sticker editor, as plain functions on the pixel
// arrays from agendaPixelFormat.js. Painting functions change the pixels in place
// (the editor paints into a working copy during a stroke); flips and the history
// return new values. Colours are [r, g, b, a] with alpha 0 or 255.

import { clonePixels } from "./agendaPixelFormat.js";

export const TRANSPARENT = [0, 0, 0, 0];
export const BRUSH_SIZES = [1, 2, 4];
export const HISTORY_LIMIT = 100;

export function inBounds(pixels, x, y) {
    return x >= 0 && y >= 0 && x < pixels.size && y < pixels.size;
}

export function getPixel(pixels, x, y) {
    const i = (y * pixels.size + x) * 4;
    return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], pixels.data[i + 3]];
}

/** Sets one pixel; outside the square it does nothing. */
export function setPixel(pixels, x, y, rgba) {
    if (!inBounds(pixels, x, y)) return;
    // Transparent always stores as 0,0,0,0 so fills and comparisons see one "empty".
    pixels.data.set(rgba[3] ? rgba : TRANSPARENT, (y * pixels.size + x) * 4);
}

function sameColor(data, i, rgba) {
    if (rgba[3] === 0) return data[i + 3] === 0;
    return data[i] === rgba[0] && data[i + 1] === rgba[1] && data[i + 2] === rgba[2] && data[i + 3] === rgba[3];
}

/** "#rrggbb" to an opaque colour. */
export function hexToRgba(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbaToHex([r, g, b]) {
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Every grid point on the straight line from a to b, ends included (Bresenham). */
export function linePoints(x0, y0, x1, y1) {
    const points = [];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        points.push([x0, y0]);
        if (x0 === x1 && y0 === y1) return points;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
    }
}

/** The pixel mirrored left to right. */
export function mirrorX(size, x) {
    return size - 1 - x;
}

/**
 * The pixels a square brush of `brush` covers around (x, y): the point is the
 * top-left of the middle, so sizes 2 and 4 grow right and down first. With
 * `mirror` the mirrored copy is included. Only pixels inside the square.
 */
export function brushPoints(size, x, y, brush = 1, mirror = false) {
    const start = -Math.floor((brush - 1) / 2);
    const seen = new Set();
    const points = [];
    const add = (px, py) => {
        if (px < 0 || py < 0 || px >= size || py >= size) return;
        const key = py * size + px;
        if (seen.has(key)) return;
        seen.add(key);
        points.push([px, py]);
    };
    for (let dy = 0; dy < brush; dy++) {
        for (let dx = 0; dx < brush; dx++) {
            add(x + start + dx, y + start + dy);
            if (mirror) add(mirrorX(size, x + start + dx), y + start + dy);
        }
    }
    return points;
}

/** Paints one brush stamp (in place). */
export function stamp(pixels, x, y, rgba, brush = 1, mirror = false) {
    for (const [px, py] of brushPoints(pixels.size, x, y, brush, mirror)) setPixel(pixels, px, py, rgba);
    return pixels;
}

/** Paints a brush along the line from a to b, so fast moves leave no gaps (in place). */
export function drawLine(pixels, x0, y0, x1, y1, rgba, brush = 1, mirror = false) {
    for (const [x, y] of linePoints(x0, y0, x1, y1)) stamp(pixels, x, y, rgba, brush, mirror);
    return pixels;
}

/**
 * Fills the area of one colour around (x, y), edges only (no diagonals), in place.
 * All transparent pixels count as the same colour. With `mirror` the mirrored
 * point is filled as well.
 */
export function floodFill(pixels, x, y, rgba, mirror = false) {
    fillFrom(pixels, x, y, rgba);
    if (mirror) fillFrom(pixels, mirrorX(pixels.size, x), y, rgba);
    return pixels;
}

function fillFrom(pixels, x, y, rgba) {
    if (!inBounds(pixels, x, y)) return;
    const { size, data } = pixels;
    const target = getPixel(pixels, x, y);
    if (sameColor(data, (y * size + x) * 4, rgba[3] ? rgba : TRANSPARENT)) return;
    const stack = [y * size + x];
    while (stack.length) {
        const p = stack.pop();
        if (!sameColor(data, p * 4, target)) continue;
        setPixel(pixels, p % size, Math.floor(p / size), rgba);
        const px = p % size;
        if (px > 0) stack.push(p - 1);
        if (px < size - 1) stack.push(p + 1);
        if (p >= size) stack.push(p - size);
        if (p < size * (size - 1)) stack.push(p + size);
    }
}

/** A copy flipped left to right. */
export function flipHorizontal(pixels) {
    const out = clonePixels(pixels);
    const { size } = pixels;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            out.data.set(pixels.data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4), (y * size + mirrorX(size, x)) * 4);
        }
    }
    return out;
}

/** A copy flipped top to bottom. */
export function flipVertical(pixels) {
    const out = clonePixels(pixels);
    const { size } = pixels;
    const row = size * 4;
    for (let y = 0; y < size; y++) out.data.set(pixels.data.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
    return out;
}

export function samePixels(a, b) {
    if (a.size !== b.size) return false;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
    return true;
}

// Undo/redo: the history holds whole values (the editor keeps the big and the
// small picture together), so one stroke is exactly one step.

export function createHistory(present) {
    return { past: [], present, future: [] };
}

/** Adds a new step; anything that was undone is dropped. */
export function commitHistory(history, next, limit = HISTORY_LIMIT) {
    if (next === history.present) return history;
    return { past: [...history.past, history.present].slice(-limit), present: next, future: [] };
}

export function canUndo(history) {
    return history.past.length > 0;
}

export function canRedo(history) {
    return history.future.length > 0;
}

export function undoHistory(history) {
    if (!canUndo(history)) return history;
    return {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1],
        future: [history.present, ...history.future],
    };
}

export function redoHistory(history) {
    if (!canRedo(history)) return history;
    return {
        past: [...history.past, history.present],
        present: history.future[0],
        future: history.future.slice(1),
    };
}
