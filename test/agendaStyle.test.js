// test/agendaStyle.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ITEM_COLORS, logoOf, readableColor, styleChanges } from "../src/utils/agendaStyle.js";

describe("agenda item style", () => {
    test("palette colours are valid and already readable", () => {
        for (const c of ITEM_COLORS) {
            assert.match(c, /^#[0-9a-f]{6}$/);
            assert.equal(readableColor(c), c);
        }
    });

    test("too dark colours are lightened, junk is cleared", () => {
        const fixed = readableColor("#101010");
        assert.notEqual(fixed, "#101010");
        assert.match(fixed, /^#[0-9a-f]{6}$/);
        assert.equal(readableColor("#ABCDEF"), "#abcdef");
        assert.equal(readableColor("red"), "");
        assert.equal(readableColor(null), "");
    });

    test("logoOf only gives the logo for its own size", () => {
        const stickers = { s1: { id: "s1" } };
        const e = { logoId: "s1", logoSize: "klein" };
        assert.equal(logoOf(e, stickers, "klein"), stickers.s1);
        assert.equal(logoOf(e, stickers, "groot"), null);
        assert.equal(logoOf({ logoId: null, logoSize: "" }, stickers, "klein"), null);
        assert.equal(logoOf({ logoId: "gone", logoSize: "klein" }, stickers, "klein"), null);
    });

    test("styleChanges sends only what differs", () => {
        const e = { color: "#ff4d4d", logoId: "s1", logoSize: "klein" };
        assert.deepEqual(styleChanges(e, { color: "#ff4d4d", logoId: "s1", logoSize: "klein" }), {});
        assert.deepEqual(styleChanges(e, { color: "", logoId: "s1", logoSize: "klein" }), { color: "" });
        assert.deepEqual(styleChanges(e, { color: "#ff4d4d", logoId: "s1", logoSize: "groot" }), { logoSize: "groot" });
        assert.deepEqual(styleChanges(e, { color: "#ff4d4d", logoId: null, logoSize: "" }), { logoId: null });
        assert.deepEqual(styleChanges({ color: "", logoId: null, logoSize: "" }, { color: "", logoId: "s2", logoSize: "groot" }), {
            logoId: "s2",
            logoSize: "groot",
        });
    });
});
