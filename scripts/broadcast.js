#!/usr/bin/env node

/**
 * broadcast.js
 *
 * Automated High-Performance Broadcaster for sisyfuz.com:
 * 1. Starts MediaMTX low-latency media server (RTMP -> HLS).
 * 2. Starts a unified reverse proxy on port 9988:
 *    - /live/* -> MediaMTX (transparent cookie-handling HLS proxy)
 *    - /ws     -> TouchDesigner webserver1 (multi-user cursor tracking)
 * 3. Launches secure Cloudflare Tunnel.
 * 4. Publishes stream URL to sisyfuz.com via Cloudflare Worker.
 * 5. On Ctrl+C, gracefully stops all services and resets site to standby.
 */

import { spawn } from "child_process";
import http from "http";
import httpProxy from "http-proxy";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TD_PORT = 9980;
const MEDIAMTX_HLS_PORT = 8888;
const PROXY_PORT = 9988;
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";

console.log("\n==============================================================");
console.log("   SISYFUZ // 60+ FPS ULTRA-RAW BROADCASTER                   ");
console.log("   (Syphon GPU -> OBS H.264 -> MediaMTX -> Cloudflare)       ");
console.log("==============================================================\n");

// Check if a local port is listening
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}`, () => resolve(true));
        req.on("error", () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// Publish/Unpublish status to worker
async function setLiveState(url, active) {
    try {
        const res = await fetch(WORKER_LIVE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url || "", active: Boolean(active) }),
        });
        if (!res.ok) {
            console.warn(`[WARN] Cloudflare Worker returned status ${res.status}`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn(`[WARN] Failed to notify Cloudflare Worker: ${err.message}`);
        return false;
    }
}

async function main() {
    let mediamtxProc = null;
    let cfProc = null;
    let proxyServer = null;
    let isShuttingDown = false;

    // 1. Check TouchDesigner for Cursor Tracking
    console.log(`[1/4] Checking TouchDesigner cursor server on port ${TD_PORT}...`);
    const tdRunning = await checkPort(TD_PORT);
    if (!tdRunning) {
        console.log(`      [!] Notice: TouchDesigner 'webserver1' is not active on port ${TD_PORT} yet.`);
        console.log(`          (Mouse tracking will connect automatically once you activate it.)\n`);
    } else {
        console.log(`      [OK] TouchDesigner cursor receiver is active!\n`);
    }

    // 2. Start MediaMTX
    console.log("[2/4] Starting MediaMTX low-latency engine...");
    const mediamtxRunning = await checkPort(MEDIAMTX_HLS_PORT);
    if (mediamtxRunning) {
        console.log("      [OK] MediaMTX is already running.\n");
    } else {
        const confPath = path.join(__dirname, "mediamtx.yml");
        mediamtxProc = spawn("mediamtx", [confPath], {
            stdio: ["ignore", "pipe", "pipe"],
        });

        mediamtxProc.on("error", (err) => {
            console.error(`      [ERR] Failed to start mediamtx: ${err.message}`);
        });

        // Pipe connection logs
        mediamtxProc.stdout.on("data", (data) => {
            const line = data.toString().trim();
            if (line.includes("is publishing to path 'live'") || line.includes("stream is available")) {
                console.log(`      [STREAM DETECTED] OBS is actively broadcasting to MediaMTX!`);
            }
        });

        // Wait up to 3 seconds for MediaMTX to initialize
        for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await checkPort(MEDIAMTX_HLS_PORT)) break;
        }
        console.log("      [OK] MediaMTX started on port 1935 (RTMP) and 8888 (HLS)!\n");
    }

    // 3. Start Transparent Cookie-Handling Proxy (Port 9988)
    console.log(`[3/4] Starting unified proxy on port ${PROXY_PORT}...`);
    const wsProxy = httpProxy.createProxyServer({
        ws: true,
        xfwd: true,
    });

    const activeCookies = new Map();
    const httpAgent = new http.Agent({
        keepAlive: true,
        maxSockets: 100,
        keepAliveMsecs: 5000,
    });

    proxyServer = http.createServer((req, res) => {
        // Universal CORS headers for web browsers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const clientKey = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client";
        const sessionCookie = activeCookies.get(clientKey) || "cookieCheck=1";

        const proxyReq = http.request({
            agent: httpAgent,
            hostname: "127.0.0.1",
            port: MEDIAMTX_HLS_PORT,
            path: req.url,
            method: req.method,
            headers: {
                ...req.headers,
                host: `127.0.0.1:${MEDIAMTX_HLS_PORT}`,
                cookie: sessionCookie,
            },
        }, (proxyRes) => {
            const setCookie = proxyRes.headers["set-cookie"];
            if (setCookie) {
                const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
                activeCookies.set(clientKey, cookieStr);
            }

            // Transparently follow MediaMTX 302 cookieCheck redirects internally
            if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302) {
                const redirectLoc = proxyRes.headers["location"];
                if (redirectLoc) {
                    const nextUrl = new URL(redirectLoc, `http://127.0.0.1:${MEDIAMTX_HLS_PORT}`);
                    const nextCookie = activeCookies.get(clientKey) || "cookieCheck=1";

                    const followReq = http.request({
                        agent: httpAgent,
                        hostname: "127.0.0.1",
                        port: MEDIAMTX_HLS_PORT,
                        path: nextUrl.pathname + nextUrl.search,
                        method: "GET",
                        headers: {
                            host: `127.0.0.1:${MEDIAMTX_HLS_PORT}`,
                            cookie: nextCookie,
                        },
                    }, (followRes) => {
                        const nextSetCookie = followRes.headers["set-cookie"];
                        if (nextSetCookie) {
                            const cookieStr = Array.isArray(nextSetCookie) ? nextSetCookie.join("; ") : nextSetCookie;
                            activeCookies.set(clientKey, cookieStr);
                        }

                        const headers = { ...followRes.headers };
                        headers["access-control-allow-origin"] = "*";
                        delete headers["set-cookie"]; // Don't leak internal cookies
                        res.writeHead(followRes.statusCode, headers);
                        followRes.pipe(res);
                    });

                    followReq.on("error", () => {
                        res.writeHead(502, { "Content-Type": "text/plain" });
                        res.end("Stream buffer initializing...");
                    });
                    followReq.end();
                    return;
                }
            }

            const headers = { ...proxyRes.headers };
            headers["access-control-allow-origin"] = "*";
            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res);
        });

        proxyReq.on("error", () => {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Media server initializing...");
        });

        req.pipe(proxyReq);
    });

    // Forward WebSocket upgrades (mouse telemetry) to TouchDesigner
    proxyServer.on("upgrade", (req, socket, head) => {
        wsProxy.ws(req, socket, head, { target: `ws://127.0.0.1:${TD_PORT}` }, (err) => {
            socket.destroy();
        });
    });

    await new Promise((resolve) => proxyServer.listen(PROXY_PORT, "0.0.0.0", resolve));
    console.log(`      [OK] Unified proxy ready at http://127.0.0.1:${PROXY_PORT}!\n`);

    // 4. Launch Cloudflare Tunnel
    console.log("[4/4] Launching Cloudflare Tunnel...");
    cfProc = spawn("npx", ["--yes", "cloudflared", "tunnel", "--url", `http://127.0.0.1:${PROXY_PORT}`], {
        stdio: ["ignore", "pipe", "pipe"],
    });

    let liveUrl = null;

    const handleOutput = async (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/([a-zA-Z0-9\-]+\.trycloudflare\.com)/);
        if (match && !liveUrl && !isShuttingDown) {
            liveUrl = match[0];

            console.log("\n==============================================================");
            console.log("  ● BROADCAST PIPELINE ACTIVE & READY FOR 60+ FPS!");
            console.log("==============================================================");
            console.log(`  Public Web Page:    https://sisyfuz.com/live`);
            console.log(`  Tunnel Stream URL:  ${liveUrl}`);
            console.log(`  HLS Video Feed:     ${liveUrl}/live/index.m3u8`);
            console.log(`  Cursor Telemetry:   wss://${match[1]}/ws`);
            console.log("--------------------------------------------------------------");
            console.log("  OBS STUDIO CONFIGURATION:");
            console.log("  1. Add Source:      macOS Syphon -> Select TouchDesigner");
            console.log("  2. Output Res:      1280x1280 (60 FPS)");
            console.log("  3. Stream Service:  Custom");
            console.log("  4. Stream Server:   rtmp://localhost:1935");
            console.log("  5. Stream Key:      live");
            console.log("  6. Click:           [Start Streaming] in OBS");
            console.log("==============================================================\n");

            console.log("  Publishing live state to sisyfuz.com...");
            const published = await setLiveState(liveUrl, true);
            if (published) {
                console.log("  [OK] Successfully published to sisyfuz.com/live!");
            }
            console.log("  Press Ctrl+C at any time to end broadcast.\n");
        }
    };

    cfProc.stdout.on("data", handleOutput);
    cfProc.stderr.on("data", handleOutput);

    // Cleanup on exit
    const cleanup = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log("\n[!] Stopping broadcast...");

        try {
            if (cfProc) cfProc.kill("SIGINT");
        } catch {}

        try {
            if (mediamtxProc) mediamtxProc.kill("SIGINT");
        } catch {}

        try {
            if (proxyServer) proxyServer.close();
        } catch {}

        console.log("    Returning sisyfuz.com/live to standby state...");
        await setLiveState("", false);

        console.log("    [OK] Broadcast stopped. Goodbye!\n");
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    cfProc.on("close", async () => {
        if (!isShuttingDown) {
            await cleanup();
        }
    });
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
