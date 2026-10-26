// scripts/seo/csp.mjs
// Helpers for the <meta http-equiv="Content-Security-Policy"> in index.html.
// index.html holds the strict production policy (no 'unsafe-eval', no localhost,
// inline scripts allowed by sha256 hash). vite.config.js loosens it for the dev
// server only and verifies the hashes at build time.

import { createHash } from "node:crypto";

const CSP_META_RE = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)("\s*\/?>)/i;

const LOCAL_HTTP = ["http://localhost:*", "http://127.0.0.1:*"];
const LOCAL_WS = ["ws://localhost:*", "ws://127.0.0.1:*"];

/** Sources the dev server needs on top of the production policy. */
export const DEV_ADDITIONS = {
    // Vite / @vitejs/plugin-react inject an inline module preamble in dev.
    "script-src": ["'unsafe-inline'", "'unsafe-eval'"],
    // Local broadcast server (scripts/broadcast.js) on :9988 and Vite HMR.
    "media-src": LOCAL_HTTP,
    "connect-src": [...LOCAL_HTTP, ...LOCAL_WS],
};

/** "a x y; b z;" -> [["a", ["x", "y"]], ["b", ["z"]]] */
export function parseCsp(policy) {
    return policy
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const [name, ...sources] = part.split(/\s+/);
            return [name.toLowerCase(), sources];
        });
}

export function serializeCsp(directives) {
    return directives.map(([name, sources]) => [name, ...sources].join(" ")).join("; ") + ";";
}

export function getCsp(html) {
    const m = html.match(CSP_META_RE);
    return m ? m[2] : null;
}

export function replaceCsp(html, transform) {
    if (!CSP_META_RE.test(html)) throw new Error("Content-Security-Policy <meta> not found");
    return html.replace(CSP_META_RE, (_, pre, policy, post) => pre + transform(policy) + post);
}

export function sha256Source(text) {
    return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** Hash sources for every inline (non-src) <script> in an HTML document. */
export function inlineScriptHashes(html) {
    const hashes = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=/i.test(m[1])) continue;
        hashes.push(sha256Source(m[2]));
    }
    return hashes;
}

/**
 * Dev policy: drop hashes from script-src (a hash makes browsers ignore
 * 'unsafe-inline') and add the dev-only sources.
 */
export function toDevCsp(policy) {
    const directives = parseCsp(policy);
    for (const [name, extra] of Object.entries(DEV_ADDITIONS)) {
        let entry = directives.find(([n]) => n === name);
        if (!entry) {
            entry = [name, ["'self'"]];
            directives.push(entry);
        }
        if (name === "script-src") entry[1] = entry[1].filter((s) => !/^'sha(256|384|512)-/.test(s));
        for (const src of extra) if (!entry[1].includes(src)) entry[1].push(src);
    }
    return serializeCsp(directives);
}

/** Returns a list of human-readable problems with a production HTML document's CSP. */
export function checkProductionCsp(html) {
    const policy = getCsp(html);
    if (policy === null) return ["Content-Security-Policy <meta> not found"];
    const problems = [];
    const directives = new Map(parseCsp(policy));
    const scriptSrc = directives.get("script-src") ?? directives.get("default-src") ?? [];
    if (scriptSrc.includes("'unsafe-eval'")) problems.push("script-src contains 'unsafe-eval'");
    if (scriptSrc.includes("'unsafe-inline'")) problems.push("script-src contains 'unsafe-inline'");
    if (/localhost|127\.0\.0\.1/i.test(policy)) problems.push("policy contains localhost/127.0.0.1 sources");
    for (const hash of inlineScriptHashes(html)) {
        if (!scriptSrc.includes(hash)) problems.push(`script-src is missing ${hash} for an inline <script>`);
    }
    return problems;
}
