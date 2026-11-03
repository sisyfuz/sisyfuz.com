// test/agendaResize.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    clampCrop,
    countColours,
    coverCrop,
    fileBaseName,
    fitCrop,
    isPixelArt,
    minCropSize,
    panCrop,
    svgRenderSize,
    reduceColours,
    resampleArea,
    resampleNearest,
    snapCrop,
    toLibraryPixels,
    zoomCrop,
} from "../src/utils/agendaResize.js";

function makeImage(width, height, paint) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
    return { width, height, data };
}
const at = (p, x, y) => [...p.data.subarray((y * p.size + x) * 4, (y * p.size + x) * 4 + 4)];

// A 64x64 picture of 8x8 blocks in 4 colours, blown up `scale` times.
const PALETTE = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]];
const checkers = (scale) =>
    makeImage(64 * scale, 64 * scale, (x, y) => PALETTE[(Math.floor(x / scale / 8) + Math.floor(y / scale / 8) * 2) % 4]);

describe("file names", () => {
    test("drops folders and the extension, keeps 40 chars", () => {
        assert.equal(fileBaseName("C:\\foto's\\Kat op bank.JPG"), "Kat op bank");
        assert.equal(fileBaseName("sam.v2.png"), "sam.v2");
        assert.equal(fileBaseName("x".repeat(60) + ".png").length, 40);
    });
});

describe("pixel art detection", () => {
    test("exact multiples of 64 with few colours are pixel art", () => {
        assert.ok(isPixelArt(checkers(1)));
        assert.ok(isPixelArt(checkers(4)));
    });

    test("other sizes or many colours are not", () => {
        assert.ok(!isPixelArt(makeImage(100, 100, () => [1, 2, 3, 255])));
        assert.ok(!isPixelArt(makeImage(32, 32, () => [1, 2, 3, 255])));
        const gradient = makeImage(128, 128, (x, y) => [x * 2, y * 2, (x + y) % 256, 255]);
        assert.ok(countColours(gradient) > 256);
        assert.ok(!isPixelArt(gradient));
    });

    test("colour count stops early and treats all transparency as one", () => {
        const img = makeImage(4, 1, (x) => [x * 10, 0, 0, x < 2 ? 0 : 255]);
        assert.equal(countColours(img), 3);
        assert.equal(countColours(makeImage(64, 64, (x, y) => [x, y, 0, 255]), 10), 11);
    });
});

describe("crop maths", () => {
    const wide = { width: 400, height: 200 };

    test("cover takes the middle square, fit the whole image", () => {
        assert.deepEqual(coverCrop(wide), { x: 100, y: 0, size: 200 });
        assert.deepEqual(fitCrop(wide), { x: 0, y: -100, size: 400 });
    });

    test("a small crop stays on the image", () => {
        assert.deepEqual(clampCrop({ x: -50, y: 180, size: 100 }, wide), { x: 0, y: 100, size: 100 });
    });

    test("a big crop keeps the image inside it", () => {
        assert.deepEqual(clampCrop({ x: 30, y: 10, size: 400 }, wide), { x: 0, y: 0, size: 400 });
        assert.deepEqual(clampCrop({ x: 0, y: -300, size: 400 }, wide), { x: 0, y: -200, size: 400 });
    });

    test("size stays between the minimum and the long side", () => {
        assert.equal(clampCrop({ x: 0, y: 0, size: 2 }, wide).size, 16);
        assert.equal(clampCrop({ x: 0, y: 0, size: 900 }, wide).size, 400);
        assert.equal(minCropSize({ width: 128, height: 128 }, true), 64);
    });

    test("panning moves and clamps", () => {
        assert.deepEqual(panCrop({ x: 100, y: 0, size: 200 }, 50, 20, wide), { x: 150, y: 0, size: 200 });
        assert.deepEqual(panCrop({ x: 100, y: 0, size: 200 }, 500, 0, wide), { x: 200, y: 0, size: 200 });
    });

    test("zooming keeps the point under the fingers in place", () => {
        const c = zoomCrop({ x: 100, y: 0, size: 200 }, 2, 150, 50, wide);
        assert.deepEqual(c, { x: 125, y: 25, size: 100 });
        // Same relative spot: (150 - 100) / 200 before, (150 - 125) / 100 after.
        assert.equal((150 - c.x) / c.size, (150 - 100) / 200);
    });

    test("zooming past a limit stops at it", () => {
        assert.equal(zoomCrop({ x: 100, y: 0, size: 200 }, 0.1, 200, 100, wide).size, 400);
        assert.equal(zoomCrop({ x: 100, y: 0, size: 200 }, 100, 200, 100, wide).size, 16);
    });

    test("pixel art snaps to whole multiples at whole pixels", () => {
        const img = { width: 256, height: 192 };
        assert.deepEqual(snapCrop({ x: 10.4, y: 3.6, size: 140 }, img), { x: 10, y: 4, size: 128 });
        assert.equal(snapCrop({ x: 0, y: 0, size: 20 }, img).size, 64);
        assert.equal(snapCrop({ x: 0, y: 0, size: 1000 }, img).size, 256);
    });
});

describe("downscaling", () => {
    test("area average of a 2x picture blends each 2x2 block", () => {
        const img = makeImage(128, 128, (x) => (x % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
        const p = resampleArea(img, { x: 0, y: 0, size: 128 });
        assert.equal(p.size, 64);
        assert.deepEqual(at(p, 10, 10), [128, 0, 128, 255]);
    });

    test("fractional areas are weighted by how much they cover", () => {
        // 96 -> 64: target pixel 0 covers source 0 fully and half of source 1.
        const img = makeImage(96, 96, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
        assert.deepEqual(at(resampleArea(img, { x: 0, y: 0, size: 96 }), 0, 0), [170, 170, 170, 255]);
    });

    test("transparent pixels don't darken colour, only lower alpha", () => {
        const img = makeImage(128, 128, (x) => (x % 2 ? [0, 0, 0, 0] : [200, 100, 50, 255]));
        assert.deepEqual(at(resampleArea(img, { x: 0, y: 0, size: 128 }), 5, 5), [200, 100, 50, 128]);
    });

    test("area past the image edge is transparent", () => {
        const img = makeImage(64, 32, () => [9, 9, 9, 255]);
        const p = resampleArea(img, fitCrop(img));
        assert.deepEqual(at(p, 0, 0), [0, 0, 0, 0]);
        assert.deepEqual(at(p, 0, 16), [9, 9, 9, 255]);
        assert.deepEqual(at(p, 0, 63), [0, 0, 0, 0]);
    });

    test("nearest neighbour gives pixel art back exactly", () => {
        const art = checkers(1);
        const big = checkers(3);
        const p = resampleNearest(big, { x: 0, y: 0, size: 192 });
        assert.deepEqual(p.data, art.data);
    });

    test("pixel art goes through nearest, photos through the average", () => {
        const art = checkers(2);
        const viaPipeline = toLibraryPixels(art, { x: 0, y: 0, size: 128 }, { pixelArt: true });
        assert.deepEqual(viaPipeline.data, checkers(1).data);
        // Off by one source pixel, the average blends the block edge.
        const shifted = toLibraryPixels(art, { x: 1, y: 0, size: 128 }, { pixelArt: false });
        assert.notDeepEqual(at(shifted, 7, 0), PALETTE[0]);
    });

    test("the threshold decides what turns transparent", () => {
        const img = makeImage(64, 64, () => [50, 60, 70, 100]);
        assert.deepEqual(at(toLibraryPixels(img, { x: 0, y: 0, size: 64 }, { threshold: 128 }), 0, 0), [0, 0, 0, 0]);
        assert.deepEqual(at(toLibraryPixels(img, { x: 0, y: 0, size: 64 }, { threshold: 64 }), 0, 0), [50, 60, 70, 255]);
    });
});

describe("colour reduction", () => {
    const gradient = makeImage(64, 64, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 0] : [x * 4, y * 4, 128, 255]));
    const asPixels = (img) => ({ size: img.width, data: img.data });

    for (const count of [8, 16, 32]) {
        test(`reduces to at most ${count} colours`, () => {
            const p = reduceColours(asPixels(gradient), count);
            // Plus one for transparency.
            assert.ok(countColours({ data: p.data }) <= count + 1);
            assert.ok(countColours({ data: p.data }) > count / 2);
        });
    }

    test("keeps transparency and doesn't touch the input", () => {
        const before = new Uint8ClampedArray(gradient.data);
        const p = reduceColours(asPixels(gradient), 8);
        assert.deepEqual(at(p, 0, 0), [0, 0, 0, 0]);
        assert.deepEqual(gradient.data, before);
    });

    test("leaves pictures that already have few colours alone", () => {
        const art = checkers(1);
        assert.deepEqual(reduceColours(asPixels(art), 8).data, art.data);
    });

    test("colours stay close to the original", () => {
        const p = reduceColours(asPixels(gradient), 32);
        let worst = 0;
        for (let i = 0; i < p.data.length; i += 4) {
            if (!p.data[i + 3]) continue;
            worst = Math.max(worst, Math.abs(p.data[i] - gradient.data[i]), Math.abs(p.data[i + 1] - gradient.data[i + 1]));
        }
        assert.ok(worst <= 48, `worst channel error ${worst}`);
    });

    test("an SVG is drawn big, in its own shape", () => {
        assert.deepEqual(svgRenderSize({ width: "24", height: "24" }), [1024, 1024]);
        assert.deepEqual(svgRenderSize({ width: "200px", height: "100px" }), [1024, 512]);
        assert.deepEqual(svgRenderSize({ viewBox: "0 0 50 100" }), [512, 1024]);
        assert.deepEqual(svgRenderSize({ width: "100%", height: "100%", viewBox: "0,0,300,150" }), [1024, 512], "percentages fall back to the viewBox");
        assert.deepEqual(svgRenderSize({ width: "60", viewBox: "0 0 30 10" }), [1024, 341], "a missing height follows the viewBox");
        assert.deepEqual(svgRenderSize({}), [1024, 1024], "no size at all is square");
        assert.deepEqual(svgRenderSize({ width: "8", height: "4" }, 64), [64, 32]);
    });
});
