// src/utils/agendaPixelFormat.js
// The one pixel format the agenda's stickers and logos share. A library image is a
// 64x64 picture plus a 16x16 small version (the small logo). Pixels are plain RGBA
// arrays so the editor, the PNG import and the tests all work on the same data;
// alpha is always fully on or fully off, which keeps the pixel-art look crisp.

export const STICKER_SIZE = 64;
export const SMALL_SIZE = 16;
export const MAX_NAME_LENGTH = 40;

/** A fully transparent square of `size` x `size` pixels. */
export function createPixels(size = STICKER_SIZE) {
    return { size, data: new Uint8ClampedArray(size * size * 4) };
}

export function clonePixels(pixels) {
    return { size: pixels.size, data: new Uint8ClampedArray(pixels.data) };
}

/** Makes every pixel fully opaque or fully transparent (in place). */
export function snapAlpha(pixels, threshold = 128) {
    const { data } = pixels;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] >= threshold) {
            data[i] = 255;
        } else {
            data[i - 3] = data[i - 2] = data[i - 1] = data[i] = 0;
        }
    }
    return pixels;
}

/** True when nothing is drawn. */
export function isBlank(pixels) {
    const { data } = pixels;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    return true;
}

// Source rows/columns that make up target cell `t` (always at least one).
function span(t, from, to) {
    const start = Math.floor((t * from) / to);
    return [start, Math.max(start + 1, Math.floor(((t + 1) * from) / to))];
}

/**
 * Shrinks to `size` x `size` by averaging each block of source pixels. Colour is
 * weighted by alpha, so transparent pixels don't darken the edges; a target pixel
 * is opaque when at least half of its block is.
 */
export function shrinkPixels(pixels, size = SMALL_SIZE) {
    const out = createPixels(size);
    const src = pixels.data;
    const from = pixels.size;
    for (let ty = 0; ty < size; ty++) {
        const [y0, y1] = span(ty, from, size);
        for (let tx = 0; tx < size; tx++) {
            const [x0, x1] = span(tx, from, size);
            let r = 0, g = 0, b = 0, a = 0;
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const i = (y * from + x) * 4;
                    const alpha = src[i + 3];
                    r += src[i] * alpha;
                    g += src[i + 1] * alpha;
                    b += src[i + 2] * alpha;
                    a += alpha;
                }
            }
            const o = (ty * size + tx) * 4;
            const count = (y1 - y0) * (x1 - x0);
            if (a > 0) {
                out.data[o] = Math.round(r / a);
                out.data[o + 1] = Math.round(g / a);
                out.data[o + 2] = Math.round(b / a);
            }
            out.data[o + 3] = Math.round(a / count);
        }
    }
    return snapAlpha(out);
}

export function pngDataUrl(base64) {
    return `data:image/png;base64,${base64}`;
}

// Browser only from here: PNG encoding and decoding go through a canvas.

function canvasOf(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    return canvas;
}

/** Encodes to a base64 PNG (no "data:" prefix). */
export function pixelsToBase64Png(pixels) {
    const canvas = canvasOf(pixels.size);
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.size, pixels.size), 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
}

/** Decodes a base64 PNG into pixels of `size` x `size`. */
export async function base64PngToPixels(base64, size = STICKER_SIZE) {
    const img = new Image();
    img.src = pngDataUrl(base64);
    await img.decode();
    const ctx = canvasOf(size).getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    return snapAlpha({ size, data });
}

/** What the API wants for a new or changed library image. */
export function stickerPayload({ name = "", pixels, smallPixels }) {
    return {
        name: name.trim().slice(0, MAX_NAME_LENGTH),
        png: pixelsToBase64Png(pixels),
        pngSmall: pixelsToBase64Png(smallPixels ?? shrinkPixels(pixels, SMALL_SIZE)),
    };
}
