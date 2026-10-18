// test/framebuster-and-rendering.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

describe("Framebuster, Iframe & Mobile Stability Suite", () => {
    const indexHtmlPath = path.join(rootDir, "index.html");
    const headersPath = path.join(rootDir, "public/_headers");
    const indexCssPath = path.join(rootDir, "src/index.css");

    test("index.html does not contain destructive framebuster script", () => {
        const content = fs.readFileSync(indexHtmlPath, "utf-8");
        assert.equal(
            content.includes("window.top !== window.self"),
            false,
            "index.html must not contain framebuster condition window.top !== window.self"
        );
        assert.equal(
            content.includes("style.display = 'none'"),
            false,
            "index.html must not set style.display = 'none' on documentElement"
        );
    });

    test("index.html CSP does not contain invalid frame-ancestors directive", () => {
        const content = fs.readFileSync(indexHtmlPath, "utf-8");
        assert.equal(
            content.includes("frame-ancestors"),
            false,
            "index.html <meta> CSP must not include frame-ancestors which is invalid in meta tags"
        );
    });

    test("public/_headers does not block iframe previews or IDE webviews", () => {
        if (fs.existsSync(headersPath)) {
            const content = fs.readFileSync(headersPath, "utf-8");
            assert.equal(
                content.includes("X-Frame-Options: DENY"),
                false,
                "public/_headers must not deny iframe framing with X-Frame-Options: DENY"
            );
            assert.equal(
                content.includes("frame-ancestors 'none'"),
                false,
                "public/_headers must not block all ancestors with frame-ancestors 'none'"
            );
        }
    });

    test("src/index.css does not use buggy -webkit-fill-available on min-height", () => {
        const content = fs.readFileSync(indexCssPath, "utf-8");
        assert.equal(
            content.includes("min-height: -webkit-fill-available"),
            false,
            "src/index.css must not use min-height: -webkit-fill-available to avoid WebKit height collapse"
        );
    });

    test("src/index.css defines stable min-height viewport cascade", () => {
        const content = fs.readFileSync(indexCssPath, "utf-8");
        assert.ok(content.includes("min-height: 100%;"), "index.css must define min-height: 100%");
        assert.ok(content.includes("min-height: 100vh;"), "index.css must define min-height: 100vh");
        assert.ok(content.includes("min-height: 100dvh;"), "index.css must define min-height: 100dvh");
    });

    test("src/index.css does not apply touch-action: manipulation to html, body, #root", () => {
        const content = fs.readFileSync(indexCssPath, "utf-8");
        const htmlBodyRootMatch = content.match(/html,\s*body,\s*#root\s*\{([^}]+)\}/);
        if (htmlBodyRootMatch) {
            assert.equal(
                htmlBodyRootMatch[1].includes("touch-action"),
                false,
                "touch-action must not be set on html, body, #root to preserve native gestures"
            );
        }
    });

    test("TerminalThemeContext implements safe fallback object and localStorage guards", () => {
        const themeContextPath = path.join(rootDir, "src/context/TerminalThemeContext.jsx");
        const content = fs.readFileSync(themeContextPath, "utf-8");
        assert.ok(
            content.includes("if (!ctx)"),
            "useTerminalTheme must contain fallback check if (!ctx)"
        );
        assert.ok(
            content.includes("theme: THEMES.pink"),
            "useTerminalTheme must fallback to default theme"
        );
        assert.ok(
            content.includes("try {"),
            "TerminalThemeContext must guard localStorage operations with try-catch"
        );
    });

    test("DiscoContext implements safe fallback object when called outside provider", () => {
        const discoContextPath = path.join(rootDir, "src/context/DiscoContext.jsx");
        const content = fs.readFileSync(discoContextPath, "utf-8");
        assert.ok(
            content.includes("if (!context)"),
            "useDisco must contain fallback check if (!context)"
        );
        assert.ok(
            content.includes("searchQuery: \"\""),
            "useDisco fallback must provide default searchQuery"
        );
    });

    test("SharpDisplay destructures searchQuery from useDisco preventing ReferenceError crash", () => {
        const sharpDisplayPath = path.join(rootDir, "src/components/SharpDisplay.jsx");
        const content = fs.readFileSync(sharpDisplayPath, "utf-8");
        assert.ok(
            content.includes("searchQuery"),
            "SharpDisplay must reference searchQuery"
        );
        // Verify searchQuery is destructured from useDisco
        const useDiscoMatch = content.match(/useDisco\(\)/);
        assert.ok(useDiscoMatch, "SharpDisplay must use useDisco");
        assert.ok(
            content.includes("searchQuery, setSearchQuery") || content.includes("setSearchQuery, searchQuery"),
            "SharpDisplay must destructure searchQuery alongside setSearchQuery"
        );
    });

    test("AsciiMedia guards renderFrame against non-finite dimensions and wraps in try-catch", () => {
        const asciiMediaPath = path.join(rootDir, "src/components/AsciiMedia.jsx");
        const content = fs.readFileSync(asciiMediaPath, "utf-8");
        assert.ok(
            content.includes("isFinite(numCols)") && content.includes("isFinite(numRows)"),
            "AsciiMedia renderFrame must verify numCols and numRows are finite"
        );
        assert.ok(
            content.includes("srcCellW <= 0 || srcCellH <= 0"),
            "AsciiMedia renderFrame must guard against non-positive cell slice dimensions"
        );
        assert.ok(
            content.includes("try {") && content.includes("renderFrame failed gracefully"),
            "AsciiMedia renderFrame must wrap canvas operations in try-catch"
        );
    });

    test("ErrorBoundary component exists and App wraps application tree with it", () => {
        const ebPath = path.join(rootDir, "src/components/ErrorBoundary.jsx");
        assert.ok(fs.existsSync(ebPath), "ErrorBoundary.jsx must exist");
        const ebContent = fs.readFileSync(ebPath, "utf-8");
        assert.ok(ebContent.includes("getDerivedStateFromError"), "ErrorBoundary must implement getDerivedStateFromError");
        assert.ok(ebContent.includes("componentDidCatch"), "ErrorBoundary must implement componentDidCatch");

        const appPath = path.join(rootDir, "src/App.jsx");
        const appContent = fs.readFileSync(appPath, "utf-8");
        assert.ok(appContent.includes("<ErrorBoundary>"), "App.jsx must wrap children with <ErrorBoundary>");
        assert.ok(appContent.includes("<TerminalThemeProvider>"), "App.jsx must include <TerminalThemeProvider>");
    });

    test("A11yToolbar guards focus restoration calls against unmounted DOM nodes", () => {
        const toolbarPath = path.join(rootDir, "src/components/A11yToolbar.jsx");
        const content = fs.readFileSync(toolbarPath, "utf-8");
        assert.ok(
            content.includes("try {\n                triggerRef.current.focus();\n            } catch"),
            "A11yToolbar must wrap focus restoration in try-catch"
        );
    });

    test("Static AST Analysis: All JavaScript and JSX files in src/ have ZERO undeclared globals", () => {
        const standardGlobals = new Set([
            "window", "document", "navigator", "localStorage", "sessionStorage", "location",
            "performance", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver",
            "WebSocket", "URL", "URLSearchParams", "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
            "console", "Math", "Date", "JSON", "Object", "Array", "String", "Number", "Boolean",
            "Uint8Array", "Float32Array", "Set", "Map", "Error", "TypeError", "RangeError",
            "Promise", "decodeURIComponent", "encodeURIComponent", "Image", "HTMLCanvasElement",
            "Event", "CustomEvent", "AudioContext", "webkitAudioContext", "screen", "history",
            "atob", "btoa", "Intl", "RegExp", "Infinity", "NaN", "undefined", "isNaN", "isFinite",
            "RTCPeerConnection", "MediaStream", "AbortController", "RTCSessionDescription", "RTCIceCandidate"
        ]);

        function getFiles(dir) {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                file = path.join(dir, file);
                const stat = fs.statSync(file);
                if (stat && stat.isDirectory()) {
                    results = results.concat(getFiles(file));
                } else if (file.endsWith(".js") || file.endsWith(".jsx")) {
                    results.push(file);
                }
            });
            return results;
        }

        const srcDir = path.join(rootDir, "src");
        const files = getFiles(srcDir);
        const undeclared = [];

        for (const file of files) {
            const code = fs.readFileSync(file, "utf8");
            try {
                const ast = parser.parse(code, {
                    sourceType: "module",
                    plugins: ["jsx"]
                });

                traverse(ast, {
                    Program(p) {
                        p.scope.crawl();
                        const globals = Object.keys(p.scope.globals);
                        for (const g of globals) {
                            if (!standardGlobals.has(g)) {
                                undeclared.push({ file: path.relative(rootDir, file), global: g });
                            }
                        }
                    }
                });
            } catch (err) {
                undeclared.push({ file: path.relative(rootDir, file), error: err.message });
            }
        }

        assert.equal(
            undeclared.length,
            0,
            `Undeclared globals detected in src/: ${JSON.stringify(undeclared, null, 2)}`
        );
    });
});
