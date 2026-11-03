// src/utils/agendaTransform.js
// Resizing and turning a sticker without changing its pixel size: the picture is
// drawn again on a grid of the same pixels (one art pixel is still one CSS pixel),
// so a 2x sticker really has 128x128 pixels and a turned one has square pixels
// that line up with every other sticker, instead of big or slanted blocks.
//
// Turning pixel art with plain nearest-neighbour gives ragged edges. Like
// RotSprite, this first blows the picture up 4x with Scale2x (twice), which
// smooths diagonal edges without inventing colours, and samples that.

import { createPixels } from "./agendaPixelFormat.js";

export const STICKER_SCALES = [0.5, 0.75, 1, 1.5, 2, 3];
export const ROT_STEP = 15;

/** The next size up or down from `scale` (or the same at either end). */
export function stepScale(scale, dir) {
    const i = STICKER_SCALES.findIndex((s) => s >= scale - 1e-9);
    const at = i === -1 ? STICKER_SCALES.length - 1 : i;
    const exact = Math.abs(STICKER_SCALES[at] - scale) < 1e-9;
    const next = dir > 0 ? (exact ? at + 1 : at) : at - 1;
    return STICKER_SCALES[Math.min(STICKER_SCALES.length - 1, Math.max(0, next))];
}

/** `rot` turned by one step in `dir`, kept as 0..359. */
export const stepRot = (rot, dir) => (((rot + dir * ROT_STEP) % 360) + 360) % 360;

/** Width (= height) in pixels of a `size` picture at `scale`, turned `rot` degrees. */
export function transformedSize(size, scale, rot) {
    const r = (rot * Math.PI) / 180;
    return Math.max(1, Math.ceil(size * scale * (Math.abs(Math.cos(r)) + Math.abs(Math.sin(r))) - 1e-6));
}

// Scale2x (EPX): every pixel becomes 2x2, taking a neighbour's colour on a
// diagonal edge. Pixels are compared as whole RGBA words.
function scale2x(pixels) {
    const n = pixels.size;
    const src = new Uint32Array(pixels.data.buffer, pixels.data.byteOffset, n * n);
    const out = createPixels(n * 2);
    const dst = new Uint32Array(out.data.buffer);
    const at = (x, y) => src[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const p = at(x, y);
            const a = at(x, y - 1);
            const b = at(x + 1, y);
            const c = at(x - 1, y);
            const d = at(x, y + 1);
            const o = y * 2 * (n * 2) + x * 2;
            dst[o] = c === a && c !== d && a !== b ? a : p;
            dst[o + 1] = a === b && a !== c && b !== d ? b : p;
            dst[o + n * 2] = d === c && d !== b && c !== a ? c : p;
            dst[o + n * 2 + 1] = b === d && b !== a && d !== c ? d : p;
        }
    }
    return out;
}

/**
 * The picture at `scale`, turned `rot` degrees clockwise around its centre, on a
 * square grid big enough to hold it (see transformedSize). Quarter turns at whole
 * sizes are exact; everything else samples the smoothed 4x picture.
 */
export function transformPixels(pixels, { scale = 1, rot = 0 } = {}) {
    const turn = ((rot % 360) + 360) % 360;
    if (scale === 1 && turn === 0) return pixels;
    const n = pixels.size;
    const exact = turn % 90 === 0 && Number.isInteger(scale);
    const big = exact ? pixels : scale2x(scale2x(pixels));
    const factor = big.size / n;
    const size = transformedSize(n, scale, turn);
    const out = createPixels(size);
    const r = (turn * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    for (let oy = 0; oy < size; oy++) {
        for (let ox = 0; ox < size; ox++) {
            // Centre of this output pixel, turned back and shrunk to source pixels.
            const cx = ox + 0.5 - size / 2;
            const cy = oy + 0.5 - size / 2;
            const sx = (cx * cos + cy * sin) / scale + n / 2;
            const sy = (-cx * sin + cy * cos) / scale + n / 2;
            const bx = Math.floor(sx * factor + 1e-9);
            const by = Math.floor(sy * factor + 1e-9);
            if (bx < 0 || by < 0 || bx >= big.size || by >= big.size) continue;
            const i = (by * big.size + bx) * 4;
            if (big.data[i + 3] === 0) continue;
            out.data.set(big.data.subarray(i, i + 4), (oy * size + ox) * 4);
        }
    }
    return out;
}
