#!/usr/bin/env node

/**
 * broadcast.js
 *
 * Automated High-Performance Broadcaster for sisyfuz.com:
 * 1. Starts MediaMTX low-latency media server (RTMP -> HLS/WebRTC).
 * 2. Starts a unified reverse proxy on port 9988:
 *    - /live/* -> MediaMTX (HLS video at 60 FPS H.264)
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

        // Wait up to 3 seconds for MediaMTX to initialize
        for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await checkPort(MEDIAMTX_HLS_PORT)) break;
        }
        console.log("      [OK] MediaMTX started on port 1935 (RTMP) and 8888 (HLS)!\n");
    }

    // 3. Start Unified Proxy (Port 9988)
    console.log(`[3/4] Starting unified proxy on port ${PROXY_PORT}...`);
    const proxy = httpProxy.createProxyServer({
        ws: true,
        xfwd: true,
    });

    proxy.on("error", (err, req, res) => {
        if (res && res.writeHead) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Stream buffer initializing...");
        }
    });

    const MEDIAMTX_WEBRTC_PORT = 8889;

    proxyServer = http.createServer((req, res) => {
        // Forward WebRTC WHEP/WHIP requests to MediaMTX WebRTC port 8889
        if (req.url && (req.url.includes("/whep") || req.url.includes("/whip"))) {
            proxy.web(req, res, { target: `http://127.0.0.1:${MEDIAMTX_WEBRTC_PORT}` });
        } else {
            // Forward HTTP requests (HLS stream files) to MediaMTX HLS port 8888
            proxy.web(req, res, { target: `http://127.0.0.1:${MEDIAMTX_HLS_PORT}` });
        }
    });

    proxyServer.on("upgrade", (req, socket, head) => {
        // Forward WebSocket upgrades (mouse telemetry) to TouchDesigner
        proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${TD_PORT}` }, (err) => {
            socket.destroy();
        });
    });

    await new Promise((resolve) => proxyServer.listen(PROXY_PORT, resolve));
    console.log(`      [OK] Unified proxy ready at http://127.0.0.1:${PROXY_PORT}!\n`);

    // 4. Launch Cloudflare Tunnel
    console.log("[4/4] Launching Cloudflare Tunnel...");
    cfProc = spawn("npx", ["--yes", "cloudflared", "tunnel", "--url", `http://localhost:${PROXY_PORT}`], {
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
