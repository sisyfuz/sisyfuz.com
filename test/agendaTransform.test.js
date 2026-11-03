// test/agendaTransform.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPixels } from "../src/utils/agendaPixelFormat.js";
import { STICKER_SCALES, stepRot, stepScale, transformPixels, transformedSize } from "../src/utils/agendaTransform.js";

const RED = [255, 0, 0, 255];
const set = (p, x, y, rgba = RED) => p.data.set(rgba, (y * p.size + x) * 4);
const alpha = (p, x, y) => p.data[(y * p.size + x) * 4 + 3];
const opaque = (p) => {
    const out = [];
    for (let y = 0; y < p.size; y++) for (let x = 0; x < p.size; x++) if (alpha(p, x, y)) out.push(`${x},${y}`);
    return out;
};

describe("agenda sticker transform", () => {
    test("size and rotation steps", () => {
        assert.equal(stepScale(1, 1), 1.5);
        assert.equal(stepScale(1, -1), 0.75);
        assert.equal(stepScale(3, 1), 3);
        assert.equal(stepScale(0.5, -1), 0.5);
        assert.equal(stepScale(1.2, 1), 1.5, "between steps goes to the next one");
        assert.equal(stepScale(1.2, -1), 1);
        assert.deepEqual(STICKER_SCALES.map((s) => stepScale(s, 1)), [0.75, 1, 1.5, 2, 3, 3]);
        assert.equal(stepRot(0, -1), 345);
        assert.equal(stepRot(345, 1), 0);
        assert.equal(stepRot(90, 1), 105);
    });

    test("the grid grows to hold a turned picture", () => {
        assert.equal(transformedSize(64, 1, 0), 64);
        assert.equal(transformedSize(64, 2, 90), 128);
        assert.equal(transformedSize(64, 1, 45), 91);
        assert.equal(transformedSize(64, 0.5, 0), 32);
    });

    test("no change gives the same pixels back", () => {
        const p = createPixels(4);
        assert.equal(transformPixels(p, { scale: 1, rot: 360 }), p);
    });

    test("a quarter turn is exact and clockwise", () => {
        const p = createPixels(4);
        set(p, 0, 0);
        set(p, 1, 0);
        set(p, 0, 1);
        const turned = transformPixels(p, { rot: 90 });
        assert.equal(turned.size, 4);
        assert.deepEqual(opaque(turned), ["2,0", "3,0", "3,1"]);
    });

    test("twice the size keeps square pixels: one pixel becomes 2x2 of the same size", () => {
        const p = createPixels(4);
        set(p, 1, 2);
        const big = transformPixels(p, { scale: 2 });
        assert.equal(big.size, 8);
        assert.deepEqual(opaque(big), ["2,4", "3,4", "2,5", "3,5"]);
    });

    test("a turned picture has only fully on or off pixels, and no new colours", () => {
        const p = createPixels(64);
        for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) set(p, x, y, (x + y) % 2 ? RED : [0, 0, 255, 255]);
        const turned = transformPixels(p, { rot: 30, scale: 1.5 });
        assert.equal(turned.size, transformedSize(64, 1.5, 30));
        const colours = new Set();
        for (let i = 0; i < turned.data.length; i += 4) {
            assert.ok(turned.data[i + 3] === 0 || turned.data[i + 3] === 255);
            if (turned.data[i + 3]) colours.add(turned.data.slice(i, i + 3).join());
        }
        assert.deepEqual([...colours].sort(), ["0,0,255", "255,0,0"]);
        const c = turned.size / 2;
        assert.equal(alpha(turned, Math.floor(c), Math.floor(c)), 255, "the middle is still there");
        assert.equal(alpha(turned, 0, 0), 0, "the corners are empty");
    });

    test("half size shrinks the picture onto half as many pixels", () => {
        const p = createPixels(64);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) set(p, x, y);
        const small = transformPixels(p, { scale: 0.5 });
        assert.equal(small.size, 32);
        assert.equal(alpha(small, 5, 10), 255);
        assert.equal(alpha(small, 25, 10), 0);
    });
});
