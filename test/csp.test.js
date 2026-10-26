// test/csp.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    parseCsp,
    serializeCsp,
    getCsp,
    replaceCsp,
    sha256Source,
    inlineScriptHashes,
    toDevCsp,
    checkProductionCsp,
} from "../scripts/seo/csp.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(rootDir, f), "utf8");

describe("CSP helpers", () => {
    test("parseCsp / serializeCsp round-trip", () => {
        const policy = "default-src 'self'; script-src 'self' 'sha256-x='; object-src 'none';";
        assert.deepEqual(parseCsp(policy), [
            ["default-src", ["'self'"]],
            ["script-src", ["'self'", "'sha256-x='"]],
            ["object-src", ["'none'"]],
        ]);
        assert.equal(serializeCsp(parseCsp(policy)), policy);
    });

    test("sha256Source matches the CSP hash format", () => {
        // echo -n "alert(1)" | openssl dgst -sha256 -binary | base64
        assert.equal(sha256Source("alert(1)"), "'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
    });

    test("inlineScriptHashes only hashes inline scripts", () => {
        const html = `<script>a()</script><script type="module" src="/x.js"></script><script>\n b()\n</script>`;
        assert.deepEqual(inlineScriptHashes(html), [sha256Source("a()"), sha256Source("\n b()\n")]);
    });

    test("toDevCsp adds dev sources and drops hashes from script-src", () => {
        const dev = new Map(parseCsp(toDevCsp("default-src 'self'; script-src 'self' 'sha256-abc='; media-src 'self' blob:; connect-src 'self';")));
        assert.deepEqual(dev.get("script-src"), ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
        assert.ok(dev.get("media-src").includes("http://localhost:*"));
        assert.ok(dev.get("connect-src").includes("ws://localhost:*"));
        assert.ok(dev.get("connect-src").includes("http://127.0.0.1:*"));
    });

    test("replaceCsp rewrites only the CSP meta content", () => {
        const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self';" /><title>t</title>`;
        assert.equal(replaceCsp(html, () => "x;"), `<meta http-equiv="Content-Security-Policy" content="x;" /><title>t</title>`);
        assert.throws(() => replaceCsp("<title>t</title>", (p) => p), /not found/);
    });

    test("checkProductionCsp flags eval, inline, localhost and missing hashes", () => {
        const bad = `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src ws://localhost:*;" /><script>x()</script>`;
        const problems = checkProductionCsp(bad).join("\n");
        assert.match(problems, /unsafe-eval/);
        assert.match(problems, /unsafe-inline/);
        assert.match(problems, /localhost/);
        assert.match(problems, /missing 'sha256-/);
        const good = `<meta http-equiv="Content-Security-Policy" content="script-src 'self' ${sha256Source("x()")};" /><script>x()</script>`;
        assert.deepEqual(checkProductionCsp(good), []);
    });

    for (const file of ["index.html", "public/404.html"]) {
        test(`${file} ships a strict production CSP whose hashes match its inline scripts`, () => {
            assert.deepEqual(checkProductionCsp(read(file)), []);
        });
    }

    test("index.html CSP keeps the required third-party sources", () => {
        const policy = getCsp(read("index.html"));
        for (const src of [
            "https://*.trycloudflare.com",
            "wss://*.trycloudflare.com",
            "https://global.relay.metered.ca",
            "https://*.apicdn.sanity.io",
            "https://cdn.sanity.io",
            "https://fonts.googleapis.com",
            "https://fonts.gstatic.com",
            "https://file.garden",
            "https://sisyfuz-counter.sisyfuz.workers.dev",
        ]) {
            assert.ok(policy.includes(src), `missing ${src}`);
        }
    });
});
