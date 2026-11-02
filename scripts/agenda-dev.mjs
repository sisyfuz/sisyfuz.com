// scripts/agenda-dev.mjs
// Runs the worker locally on http://localhost:8787 with an in-memory D1, so the
// agenda can be tried with `npm run dev` without Cloudflare. Data is lost on exit.
//
// Reads secrets from worker/.dev.vars (git-ignored), e.g.:
//   AGENDA_SESSION_KEY=...   (>= 32 chars)
//   AGENDA_ADMIN_KEY=...     (>= 32 chars; `npm run agenda:admin -- init-key --local`)
//   AGENDA_PASS_DORUS=...    (optional fixed password)
// Point the site at it with VITE_AGENDA_API=http://localhost:8787 in .env.development.local.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/src/index.js";
import { createFakeD1 } from "../test/helpers/fakeD1.js";

const PORT = Number(process.env.PORT || 8787);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readDevVars() {
    const text = await readFile(path.join(rootDir, "worker/.dev.vars"), "utf8").catch(() => "");
    const vars = {};
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return vars;
}

const env = { ...(await readDevVars()), AGENDA_DB: createFakeD1() };
for (const key of ["AGENDA_SESSION_KEY", "AGENDA_ADMIN_KEY"]) {
    if (!env[key]) console.warn(`[agenda-dev] ${key} is not set in worker/.dev.vars; routes that need it answer 503`);
}

createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("CF-Connecting-IP", req.socket.remoteAddress || "127.0.0.1");

    const response = await worker.fetch(
        new Request(`http://localhost:${PORT}${req.url}`, {
            method: req.method,
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
        }),
        env
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, "127.0.0.1", () => {
    console.log(`[agenda-dev] worker on http://localhost:${PORT}`);
});
