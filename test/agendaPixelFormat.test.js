// test/agendaPixelFormat.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clonePixels, createPixels, isBlank, shrinkPixels, snapAlpha, STICKER_SIZE, SMALL_SIZE } from "../src/utils/agendaPixelFormat.js";

const setPixel = (p, x, y, rgba) => p.data.set(rgba, (y * p.size + x) * 4);
const getPixel = (p, x, y) => [...p.data.subarray((y * p.size + x) * 4, (y * p.size + x) * 4 + 4)];

describe("agenda pixel format", () => {
    test("new pixels are transparent and the right size", () => {
        const p = createPixels();
        assert.equal(p.size, STICKER_SIZE);
        assert.equal(p.data.length, 64 * 64 * 4);
        assert.ok(isBlank(p));
    });

    test("clones don't share data", () => {
        const p = createPixels(4);
        const copy = clonePixels(p);
        setPixel(copy, 0, 0, [1, 2, 3, 255]);
        assert.ok(isBlank(p));
        assert.ok(!isBlank(copy));
    });

    test("snapAlpha makes pixels fully on or off and clears hidden colour", () => {
        const p = createPixels(2);
        setPixel(p, 0, 0, [10, 20, 30, 200]);
        setPixel(p, 1, 0, [10, 20, 30, 40]);
        snapAlpha(p);
        assert.deepEqual(getPixel(p, 0, 0), [10, 20, 30, 255]);
        assert.deepEqual(getPixel(p, 1, 0), [0, 0, 0, 0]);
    });

    test("shrinking 64 to 16 averages each 4x4 block", () => {
        const p = createPixels();
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setPixel(p, x, y, x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
        const small = shrinkPixels(p);
        assert.equal(small.size, SMALL_SIZE);
        assert.deepEqual(getPixel(small, 0, 0), [128, 0, 128, 255]);
        assert.deepEqual(getPixel(small, 1, 0), [0, 0, 0, 0]);
    });

    test("transparent pixels don't darken the colour, and half coverage stays opaque", () => {
        const p = createPixels();
        for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) setPixel(p, x, y, [255, 255, 255, 255]);
        assert.deepEqual(getPixel(shrinkPixels(p), 0, 0), [255, 255, 255, 255]);
        const thin = createPixels();
        setPixel(thin, 0, 0, [255, 255, 255, 255]);
        assert.deepEqual(getPixel(shrinkPixels(thin), 0, 0), [0, 0, 0, 0]);
    });
});
