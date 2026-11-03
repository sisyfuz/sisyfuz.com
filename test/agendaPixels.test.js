// test/agendaPixels.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPixels } from "../src/utils/agendaPixelFormat.js";
import {
    brushPoints,
    canRedo,
    canUndo,
    commitHistory,
    createHistory,
    drawLine,
    floodFill,
    flipHorizontal,
    flipVertical,
    getPixel,
    hexToRgba,
    linePoints,
    redoHistory,
    rgbaToHex,
    samePixels,
    setPixel,
    stamp,
    TRANSPARENT,
    undoHistory,
} from "../src/utils/agendaPixels.js";

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

// Opaque pixels as a list of "x,y", for readable asserts.
const painted = (p) => {
    const out = [];
    for (let y = 0; y < p.size; y++) for (let x = 0; x < p.size; x++) if (getPixel(p, x, y)[3]) out.push(`${x},${y}`);
    return out;
};

describe("agenda pixels: colours", () => {
    test("hex round trip", () => {
        assert.deepEqual(hexToRgba("#ff6fae"), [255, 111, 174, 255]);
        assert.equal(rgbaToHex([255, 111, 174, 255]), "#ff6fae");
        assert.equal(rgbaToHex([0, 0, 0, 255]), "#000000");
    });

    test("setting a transparent pixel clears its colour and ignores the outside", () => {
        const p = createPixels(2);
        setPixel(p, 0, 0, RED);
        setPixel(p, 0, 0, [9, 9, 9, 0]);
        setPixel(p, 5, 5, RED);
        assert.deepEqual(getPixel(p, 0, 0), TRANSPARENT);
        assert.deepEqual(painted(p), []);
    });
});

describe("agenda pixels: lines and brushes", () => {
    test("a line includes both ends and has no gaps", () => {
        assert.deepEqual(linePoints(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
        assert.deepEqual(linePoints(2, 2, 2, 2), [[2, 2]]);
        const diag = linePoints(0, 0, 7, 3);
        assert.deepEqual(diag[0], [0, 0]);
        assert.deepEqual(diag.at(-1), [7, 3]);
        for (let i = 1; i < diag.length; i++) {
            assert.ok(Math.abs(diag[i][0] - diag[i - 1][0]) <= 1 && Math.abs(diag[i][1] - diag[i - 1][1]) <= 1);
        }
        assert.equal(diag.length, 8);
    });

    test("lines run backwards too", () => {
        assert.deepEqual(linePoints(3, 1, 0, 1), [[3, 1], [2, 1], [1, 1], [0, 1]]);
    });

    test("drawLine fills the gap between two far apart points", () => {
        const p = createPixels(8);
        drawLine(p, 0, 4, 7, 4, RED);
        assert.deepEqual(painted(p), ["0,4", "1,4", "2,4", "3,4", "4,4", "5,4", "6,4", "7,4"]);
    });

    test("brush sizes cover 1, 2x2 and 4x4 and clip at the edge", () => {
        assert.equal(brushPoints(16, 5, 5, 1).length, 1);
        assert.deepEqual(brushPoints(16, 5, 5, 2).sort(), [[5, 5], [5, 6], [6, 5], [6, 6]].sort());
        const four = brushPoints(16, 5, 5, 4);
        assert.equal(four.length, 16);
        assert.deepEqual(four[0], [4, 4]);
        assert.equal(brushPoints(16, 0, 0, 4).length, 9);
    });
});

describe("agenda pixels: mirror and flip", () => {
    test("mirror paints the left-right copy too", () => {
        const p = createPixels(8);
        stamp(p, 1, 2, RED, 1, true);
        assert.deepEqual(painted(p), ["1,2", "6,2"]);
    });

    test("mirror on the middle line doesn't double up", () => {
        assert.equal(brushPoints(8, 3, 0, 2, true).length, 4);
        assert.equal(brushPoints(7, 3, 0, 1, true).length, 1);
    });

    test("mirrored lines", () => {
        const p = createPixels(8);
        drawLine(p, 0, 0, 0, 2, RED, 1, true);
        assert.deepEqual(painted(p), ["0,0", "7,0", "0,1", "7,1", "0,2", "7,2"]);
    });

    test("flips return a copy and keep colours", () => {
        const p = createPixels(4);
        setPixel(p, 0, 1, RED);
        setPixel(p, 3, 3, BLUE);
        const h = flipHorizontal(p);
        assert.deepEqual(getPixel(h, 3, 1), RED);
        assert.deepEqual(getPixel(h, 0, 3), BLUE);
        assert.deepEqual(painted(p), ["0,1", "3,3"]);
        const v = flipVertical(p);
        assert.deepEqual(getPixel(v, 0, 2), RED);
        assert.deepEqual(getPixel(v, 3, 0), BLUE);
        assert.ok(samePixels(flipHorizontal(h), p));
        assert.ok(samePixels(flipVertical(v), p));
    });
});

describe("agenda pixels: flood fill", () => {
    test("fills an empty square", () => {
        const p = createPixels(4);
        floodFill(p, 1, 1, RED);
        assert.equal(painted(p).length, 16);
    });

    test("stops at other colours and doesn't leak through diagonals", () => {
        const p = createPixels(5);
        // A closed box with a diagonal-only gap at the corner (4,4 stays outside).
        for (let i = 0; i < 4; i++) {
            setPixel(p, i, 3, BLUE);
            setPixel(p, 3, i, BLUE);
        }
        floodFill(p, 0, 0, RED);
        assert.deepEqual(getPixel(p, 2, 2), RED);
        assert.deepEqual(getPixel(p, 3, 3), BLUE);
        assert.deepEqual(getPixel(p, 4, 0), TRANSPARENT);
        assert.deepEqual(getPixel(p, 4, 4), TRANSPARENT);
        assert.equal(painted(p).length, 9 + 7);
    });

    test("replaces one colour and erases with transparent", () => {
        const p = createPixels(3);
        drawLine(p, 0, 1, 2, 1, BLUE);
        setPixel(p, 0, 0, RED);
        floodFill(p, 1, 1, TRANSPARENT);
        assert.deepEqual(painted(p), ["0,0"]);
    });

    test("filling with the same colour is a no-op", () => {
        const p = createPixels(3);
        setPixel(p, 1, 1, RED);
        floodFill(p, 1, 1, RED);
        floodFill(p, 0, 0, TRANSPARENT);
        assert.deepEqual(painted(p), ["1,1"]);
    });

    test("mirror fills both halves when a wall splits them", () => {
        const p = createPixels(4);
        drawLine(p, 1, 0, 1, 3, BLUE);
        drawLine(p, 2, 0, 2, 3, BLUE);
        floodFill(p, 0, 0, RED, true);
        assert.deepEqual(getPixel(p, 0, 2), RED);
        assert.deepEqual(getPixel(p, 3, 2), RED);
    });

    test("fills a whole 64x64 without overflowing", () => {
        const p = createPixels(64);
        floodFill(p, 10, 10, RED);
        assert.equal(painted(p).length, 64 * 64);
    });
});

describe("agenda pixels: history", () => {
    const step = (color) => {
        const p = createPixels(2);
        setPixel(p, 0, 0, color);
        return p;
    };

    test("undo and redo walk back and forth", () => {
        const a = createPixels(2);
        const b = step(RED);
        const c = step(BLUE);
        let h = createHistory(a);
        assert.ok(!canUndo(h) && !canRedo(h));
        h = commitHistory(h, b);
        h = commitHistory(h, c);
        assert.equal(h.present, c);
        h = undoHistory(h);
        assert.equal(h.present, b);
        assert.ok(canRedo(h));
        h = undoHistory(h);
        assert.equal(h.present, a);
        assert.equal(undoHistory(h), h);
        h = redoHistory(redoHistory(h));
        assert.equal(h.present, c);
        assert.equal(redoHistory(h), h);
    });

    test("a new step drops what was undone", () => {
        let h = commitHistory(createHistory(createPixels(2)), step(RED));
        h = undoHistory(h);
        h = commitHistory(h, step(BLUE));
        assert.ok(!canRedo(h));
        assert.deepEqual(getPixel(h.present, 0, 0), BLUE);
        assert.equal(h.past.length, 1);
    });

    test("committing the same value adds no step", () => {
        const h = createHistory(createPixels(2));
        assert.equal(commitHistory(h, h.present), h);
    });

    test("old steps fall off past the limit", () => {
        let h = createHistory(0);
        for (let i = 1; i <= 10; i++) h = commitHistory(h, i, 3);
        assert.deepEqual(h.past, [7, 8, 9]);
        assert.equal(h.present, 10);
    });
});
