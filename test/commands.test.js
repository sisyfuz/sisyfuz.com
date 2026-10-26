// test/commands.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, isCommandPrefix, normalizeSearchInput, COMMAND_NAMES } from "../src/utils/commands.js";

describe("parseCommand", () => {
    test("maps navigation commands to paths", () => {
        assert.deepEqual(parseCommand("work"), { type: "navigate", to: "/work" });
        assert.deepEqual(parseCommand("archive"), { type: "navigate", to: "/archive" });
        assert.deepEqual(parseCommand("about"), { type: "navigate", to: "/about" });
        assert.deepEqual(parseCommand("contact"), { type: "navigate", to: "/contact" });
        assert.deepEqual(parseCommand("press"), { type: "navigate", to: "/press" });
        assert.deepEqual(parseCommand("live"), { type: "navigate", to: "/live" });
        assert.deepEqual(parseCommand("home"), { type: "navigate", to: "/" });
        assert.deepEqual(parseCommand("privacy"), { type: "navigate", to: "/privacy" });
    });

    test("legal is an alias for privacy", () => {
        assert.deepEqual(parseCommand("legal"), { type: "navigate", to: "/privacy" });
    });

    test("maps action commands", () => {
        assert.deepEqual(parseCommand("a11y"), { type: "toggleA11y" });
        assert.deepEqual(parseCommand("disco"), { type: "toggleDisco" });
        assert.deepEqual(parseCommand("ascii"), { type: "ascii", to: "/live" });
    });

    test("tolerates surrounding whitespace and case", () => {
        assert.deepEqual(parseCommand("  work "), { type: "navigate", to: "/work" });
        assert.deepEqual(parseCommand("WORK"), { type: "navigate", to: "/work" });
    });

    test("words that merely end or start with a command are searches", () => {
        for (const q of ["artwork", "network", "homework", "workshop", "works", "discord", "alive", "about me", "work x"]) {
            assert.equal(parseCommand(q), null, q);
        }
    });

    test("empty or non-string input is not a command", () => {
        assert.equal(parseCommand(""), null);
        assert.equal(parseCommand("   "), null);
        assert.equal(parseCommand(undefined), null);
        assert.equal(parseCommand(42), null);
    });

    test("does not match Object.prototype keys", () => {
        assert.equal(parseCommand("constructor"), null);
        assert.equal(parseCommand("tostring"), null);
        assert.equal(parseCommand("__proto__"), null);
    });

    test("exposes every command name", () => {
        assert.deepEqual([...COMMAND_NAMES].sort(), [
            "a11y", "about", "archive", "ascii", "contact", "disco", "home", "legal", "live", "press", "privacy", "work",
        ]);
    });
});

describe("isCommandPrefix", () => {
    test("true for partial command names", () => {
        for (const q of ["a", "ar", "arch", "wor", "work", "dis", "a1", "asc"]) {
            assert.equal(isCommandPrefix(q), true, q);
        }
    });

    test("false for anything that cannot become a command", () => {
        for (const q of ["", "art", "workshop", "net", "zzz", "works"]) {
            assert.equal(isCommandPrefix(q), false, q);
        }
    });
});

describe("normalizeSearchInput", () => {
    test("lowercases and strips disallowed characters", () => {
        assert.equal(normalizeSearchInput("ArtWork!<script>"), "artworkscript");
    });

    test("keeps trailing space so multi-word queries can be typed", () => {
        assert.equal(normalizeSearchInput("my "), "my ");
        assert.equal(normalizeSearchInput("my  project"), "my project");
    });

    test("strips leading spaces", () => {
        assert.equal(normalizeSearchInput("   work"), "work");
    });

    test("keeps the last maxLen characters", () => {
        assert.equal(normalizeSearchInput("abcdefghij", 4), "ghij");
        assert.equal(normalizeSearchInput("abc defg", 5), "defg");
    });

    test("non-string input returns empty string", () => {
        assert.equal(normalizeSearchInput(null), "");
    });
});
