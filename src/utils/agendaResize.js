// src/utils/agendaResize.js
// Pure image maths for turning a picture into a 64x64 library image: the square
// crop, the downscaling and the optional colour reduction. Sources are plain
// `{ width, height, data }` RGBA arrays (what a canvas's getImageData gives), so
// all of it runs and is tested without a browser. The crop is a square in source
// pixels that may reach past the image; whatever falls outside is transparent.
import { MAX_NAME_LENGTH, STICKER_SIZE, createPixels, snapAlpha } from "./agendaPixelFormat.js";

// More distinct colours than this and a picture is not pixel art.
export const PIXEL_ART_MAX_COLOURS = 256;
export const COLOUR_COUNTS = [8, 16, 32];

/** The file name without its extension, as a library image name. */
export function fileBaseName(fileName = "") {
    const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
    return base.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Counts distinct colours (fully transparent pixels count as one), stopping
 * once it passes `limit`.
 */
export function countColours(image, limit = Infinity) {
    const { data } = image;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) {
        const key = data[i + 3] === 0 ? -1 : ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) * 256 + data[i + 3];
        seen.add(key);
        if (seen.size > limit) break;
    }
    return seen.size;
}

/**
 * Already pixel art: both sides are an exact multiple of the target size and it
 * uses few colours. Those shrink by picking pixels instead of averaging them.
 */
export function isPixelArt(image, size = STICKER_SIZE, maxColours = PIXEL_ART_MAX_COLOURS) {
    const { width, height } = image;
    if (width < size || height < size || width % size || height % size) return false;
    return countColours(image, maxColours) <= maxColours;
}

// --- Crop -------------------------------------------------------------------

/** The smallest crop allowed: pixel art never goes below one pixel per pixel. */
export function minCropSize(image, pixelArt = false, size = STICKER_SIZE) {
    return pixelArt ? size : Math.min(16, Math.max(image.width, image.height));
}

/** The biggest square that fits in the image, in the middle. */
export function coverCrop(image) {
    const size = Math.min(image.width, image.height);
    return { x: (image.width - size) / 2, y: (image.height - size) / 2, size };
}

/** The whole image in the middle of the square, with transparent edges. */
export function fitCrop(image) {
    const size = Math.max(image.width, image.height);
    return { x: (image.width - size) / 2, y: (image.height - size) / 2, size };
}

function clampAxis(pos, size, length) {
    // A crop smaller than the image stays inside it; a bigger one keeps the image inside.
    return size <= length ? Math.min(Math.max(pos, 0), length - size) : Math.min(Math.max(pos, length - size), 0);
}

/** Keeps the crop between the minimum size and the whole image, and on the image. */
export function clampCrop(crop, image, minSize = minCropSize(image)) {
    const size = Math.min(Math.max(crop.size, Math.min(minSize, Math.max(image.width, image.height))), Math.max(image.width, image.height));
    return { x: clampAxis(crop.x, size, image.width), y: clampAxis(crop.y, size, image.height), size };
}

export function panCrop(crop, dx, dy, image, minSize) {
    return clampCrop({ x: crop.x + dx, y: crop.y + dy, size: crop.size }, image, minSize);
}

/**
 * Zooms in by `factor` (above 1 is closer) around a source point, which stays
 * where it is in the crop.
 */
export function zoomCrop(crop, factor, cx, cy, image, minSize) {
    const size = crop.size / factor;
    const zoomed = { x: cx - (cx - crop.x) / factor, y: cy - (cy - crop.y) / factor, size };
    const clamped = clampCrop(zoomed, image, minSize);
    if (clamped.size === size) return clamped;
    // Hit a limit: zoom around the same point with the size it got.
    const f = crop.size / clamped.size;
    return clampCrop({ x: cx - (cx - crop.x) / f, y: cy - (cy - crop.y) / f, size: clamped.size }, image, minSize);
}

/** Pixel art crops whole multiples of the target size at whole pixels. */
export function snapCrop(crop, image, size = STICKER_SIZE) {
    const snapped = Math.max(size, Math.round(crop.size / size) * size);
    const c = clampCrop({ x: crop.x, y: crop.y, size: snapped }, image, size);
    return clampCrop({ x: Math.round(c.x), y: Math.round(c.y), size: c.size }, image, size);
}

// --- Downscaling --------------------------------------------------------------

// For each target cell along one axis: the source pixels it covers and how much
// of each (0..1), within the image only.
function coverage(start, scale, length, size) {
    const cells = [];
    for (let t = 0; t < size; t++) {
        const s0 = start + t * scale;
        const s1 = s0 + scale;
        const idx = [];
        const w = [];
        for (let s = Math.max(0, Math.floor(s0)); s < Math.min(length, Math.ceil(s1)); s++) {
            const part = Math.min(s + 1, s1) - Math.max(s, s0);
            if (part > 0) {
                idx.push(s);
                w.push(part);
            }
        }
        cells.push({ idx, w });
    }
    return cells;
}

/**
 * Area average: every target pixel is the mean of the source area under it,
 * colour weighted by alpha so transparent edges don't darken. Alpha is the
 * covered share, so it still needs snapAlpha.
 */
export function resampleArea(image, crop, size = STICKER_SIZE) {
    const out = createPixels(size);
    const src = image.data;
    const scale = crop.size / size;
    const area = scale * scale;
    const cols = coverage(crop.x, scale, image.width, size);
    const rows = coverage(crop.y, scale, image.height, size);
    for (let ty = 0; ty < size; ty++) {
        const row = rows[ty];
        for (let tx = 0; tx < size; tx++) {
            const col = cols[tx];
            let r = 0, g = 0, b = 0, a = 0;
            for (let j = 0; j < row.idx.length; j++) {
                const base = row.idx[j] * image.width;
                for (let k = 0; k < col.idx.length; k++) {
                    const i = (base + col.idx[k]) * 4;
                    const wa = src[i + 3] * row.w[j] * col.w[k];
                    r += src[i] * wa;
                    g += src[i + 1] * wa;
                    b += src[i + 2] * wa;
                    a += wa;
                }
            }
            if (a === 0) continue;
            const o = (ty * size + tx) * 4;
            out.data[o] = Math.round(r / a);
            out.data[o + 1] = Math.round(g / a);
            out.data[o + 2] = Math.round(b / a);
            out.data[o + 3] = Math.round(a / area);
        }
    }
    return out;
}

/** Nearest neighbour: the source pixel under the middle of each target pixel. */
export function resampleNearest(image, crop, size = STICKER_SIZE) {
    const out = createPixels(size);
    const scale = crop.size / size;
    for (let ty = 0; ty < size; ty++) {
        const sy = Math.floor(crop.y + (ty + 0.5) * scale);
        if (sy < 0 || sy >= image.height) continue;
        for (let tx = 0; tx < size; tx++) {
            const sx = Math.floor(crop.x + (tx + 0.5) * scale);
            if (sx < 0 || sx >= image.width) continue;
            const i = (sy * image.width + sx) * 4;
            out.data.set(image.data.subarray(i, i + 4), (ty * size + tx) * 4);
        }
    }
    return out;
}

// --- Colour reduction -----------------------------------------------------------

/**
 * Median cut over the opaque pixels: split the box of colours with the widest
 * channel at its median until there are `count` boxes, then paint every pixel
 * with its box's average. Returns new pixels.
 */
export function reduceColours(pixels, count) {
    const out = { size: pixels.size, data: new Uint8ClampedArray(pixels.data) };
    const { data } = out;
    const opaque = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0) opaque.push(i);
    if (countColours(out, count) <= count) return out;

    const boxOf = (list) => {
        const min = [255, 255, 255];
        const max = [0, 0, 0];
        for (const i of list) {
            for (let c = 0; c < 3; c++) {
                if (data[i + c] < min[c]) min[c] = data[i + c];
                if (data[i + c] > max[c]) max[c] = data[i + c];
            }
        }
        const ranges = max.map((m, c) => m - min[c]);
        const channel = ranges.indexOf(Math.max(...ranges));
        return { list, channel, range: ranges[channel] };
    };

    const boxes = [boxOf(opaque)];
    while (boxes.length < count) {
        let pick = -1;
        for (let b = 0; b < boxes.length; b++) {
            if (boxes[b].list.length > 1 && boxes[b].range > 0 && (pick < 0 || boxes[b].range > boxes[pick].range)) pick = b;
        }
        if (pick < 0) break;
        const { list, channel } = boxes[pick];
        const sorted = [...list].sort((p, q) => data[p + channel] - data[q + channel]);
        const mid = sorted.length >> 1;
        boxes.splice(pick, 1, boxOf(sorted.slice(0, mid)), boxOf(sorted.slice(mid)));
    }

    for (const { list } of boxes) {
        const sum = [0, 0, 0];
        for (const i of list) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
        const mean = sum.map((s) => Math.round(s / list.length));
        for (const i of list) for (let c = 0; c < 3; c++) data[i + c] = mean[c];
    }
    return out;
}

/**
 * The whole way from source to library image: crop, shrink (picking pixels for
 * pixel art), snap alpha at `threshold` and optionally reduce to `colours`.
 */
export function toLibraryPixels(image, crop, { pixelArt = false, threshold = 128, colours = 0, size = STICKER_SIZE } = {}) {
    const shrunk = pixelArt ? resampleNearest(image, snapCrop(crop, image, size), size) : resampleArea(image, crop, size);
    snapAlpha(shrunk, threshold);
    return colours ? reduceColours(shrunk, colours) : shrunk;
}

// An SVG has no pixels of its own: it is drawn at this size (longest side) before
// cropping, so the 64x64 result is as sharp as a big photo would give.
export const SVG_RENDER_MAX = 1024;

// "120", "120px" or "120.5" are sizes; "100%", "10em" and missing ones are not.
function svgLength(value) {
    const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value ?? "");
    const n = m ? Number(m[1]) : NaN;
    return n > 0 ? n : null;
}

/**
 * The pixel size to draw an SVG at, from its root `width`, `height` and `viewBox`
 * attributes: their shape, with the longest side `max`. Without any usable size it
 * is square.
 */
export function svgRenderSize({ width, height, viewBox } = {}, max = SVG_RENDER_MAX) {
    let w = svgLength(width);
    let h = svgLength(height);
    const box = (viewBox ?? "").trim().split(/[\s,]+/).map(Number);
    const [bw, bh] = box.length === 4 && box[2] > 0 && box[3] > 0 ? [box[2], box[3]] : [null, null];
    if (w && !h) h = bh ? (w * bh) / bw : w;
    if (h && !w) w = bw ? (h * bw) / bh : h;
    if (!w && !h) [w, h] = bw ? [bw, bh] : [1, 1];
    const scale = max / Math.max(w, h);
    return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}
