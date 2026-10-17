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

import { spawn, execSync } from "child_process";
import fs from "fs";
import http from "http";
import httpProxy from "http-proxy";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-load .env.local or .env if present
try {
    process.loadEnvFile(path.join(__dirname, "../.env.local"));
} catch {
    try {
        process.loadEnvFile(path.join(__dirname, "../.env"));
    } catch {}
}

const TD_PORT = 9980;
const MEDIAMTX_HLS_PORT = 8888;
const MEDIAMTX_WEBRTC_PORT = 8889;
const PROXY_PORT = 9988;
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";

// Metered.ca TURN credentials (optional — WebRTC falls back to STUN-only if unset)
const TURN_USERNAME = process.env.METERED_TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.METERED_TURN_CREDENTIAL || "";
const TURN_HOST = process.env.METERED_TURN_HOST || "global.relay.metered.ca";
const TURN_URL = process.env.METERED_TURN_URL || (TURN_USERNAME ? `turn:${TURN_HOST}:80` : "");

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

// Gracefully clear any stale zombie process holding a port
function killPort(port) {
    try {
        const out = execSync(`lsof -t -i :${port}`, { encoding: "utf8" }).trim();
        if (out) {
            const pids = out.split(/\s+/).map(Number).filter((p) => p && p !== process.pid);
            for (const pid of pids) {
                try {
                    process.kill(pid, "SIGKILL");
                } catch {}
            }
        }
    } catch {}
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
        console.log("      [OK] MediaMTX is already running on port 1935 / 8888.\n");
    } else {
        const confPath = path.join(__dirname, "mediamtx.yml");
        const mtxEnv = {
            ...process.env,
            PATH: `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin`,
        };
        if (TURN_USERNAME && TURN_CREDENTIAL) {
            mtxEnv.MTX_WEBRTCICESERVERS2 = JSON.stringify([
                { url: "stun:stun.l.google.com:19302" },
                { url: `turn:${TURN_HOST}:80`, username: TURN_USERNAME, password: TURN_CREDENTIAL },
                { url: `turn:${TURN_HOST}:443`, username: TURN_USERNAME, password: TURN_CREDENTIAL },
                { url: `turn:${TURN_HOST}:443?transport=tcp`, username: TURN_USERNAME, password: TURN_CREDENTIAL },
            ]);
        }

        const bin = fs.existsSync("/opt/homebrew/bin/mediamtx")
            ? "/opt/homebrew/bin/mediamtx"
            : (fs.existsSync("/usr/local/bin/mediamtx") ? "/usr/local/bin/mediamtx" : "mediamtx");

        mediamtxProc = spawn(bin, [confPath], {
            env: mtxEnv,
            stdio: ["ignore", "pipe", "pipe"],
        });

        mediamtxProc.on("error", (err) => {
            console.error(`      [ERR] Failed to start MediaMTX binary (${bin}): ${err.message}`);
        });

        mediamtxProc.stdout.on("data", (data) => {
            const line = data.toString().trim();
            if (line.includes("ERR") || line.includes("WARN")) {
                console.error(`      [MediaMTX] ${line}`);
            }
            if (line.includes("is publishing to path 'live'") || line.includes("stream is available") || line.includes("[RTMP]")) {
                console.log(`      [STREAM DETECTED] OBS is broadcasting to MediaMTX!`);
            }
        });

        mediamtxProc.stderr.on("data", (data) => {
            console.error(`      [MediaMTX ERR] ${data.toString().trim()}`);
        });

        mediamtxProc.on("exit", (code, sig) => {
            if (!isShuttingDown) {
                console.error(`      [FATAL] MediaMTX stopped (code: ${code}, signal: ${sig})`);
            }
        });

        // Wait up to 4 seconds for MediaMTX to initialize
        let isStarted = false;
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await checkPort(MEDIAMTX_HLS_PORT)) {
                isStarted = true;
                break;
            }
        }

        if (isStarted) {
            console.log("      [OK] MediaMTX started on port 1935 (RTMP), 8888 (HLS), and 8889 (WebRTC)!\n");
        } else {
            console.error("      [FATAL] MediaMTX failed to start! Make sure mediamtx is installed and port 1935/8888/8889 is free.\n");
        }
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

    let activeStreamPath = "live";

    // Periodically query MediaMTX API to auto-detect whether stream is published to 'live' or 'live/live'
    async function detectActiveStreamPath() {
        try {
            const res = await fetch("http://127.0.0.1:9997/v3/paths/list");
            if (res.ok) {
                const data = await res.json();
                const active = data.items?.find((item) => item.ready && item.online);
                if (active && active.name && active.name !== activeStreamPath) {
                    activeStreamPath = active.name;
                    console.log(`      [STREAM ROUTED] Client traffic automatically routed to active stream: '${activeStreamPath}'`);
                }
            }
        } catch {}
    }
    const pathDetectorInterval = setInterval(detectActiveStreamPath, 1500);

    function mapStreamUrl(url) {
        if (activeStreamPath && activeStreamPath !== "live") {
            if (url === "/live/whep" || url.startsWith("/live/whep/")) {
                return url.replace(/^\/live\/whep/, `/${activeStreamPath}/whep`);
            }
            if (url.startsWith("/live/") && !url.startsWith(`/${activeStreamPath}/`)) {
                return url.replace(/^\/live\//, `/${activeStreamPath}/`);
            }
        }
        return url;
    }

    proxyServer = http.createServer((req, res) => {
        // Universal CORS headers for web browsers (extended for WHEP PATCH/DELETE)
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS, HEAD");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Expose-Headers", "Location, Link");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        // --- /turn-config: Expose ICE server configuration to the frontend ---
        if (req.url === "/turn-config") {
            const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
            if (TURN_USERNAME && TURN_CREDENTIAL) {
                iceServers.push({
                    urls: [
                        `turn:${TURN_HOST}:80`,
                        `turn:${TURN_HOST}:443`,
                        `turn:${TURN_HOST}:443?transport=tcp`,
                    ],
                    username: TURN_USERNAME,
                    credential: TURN_CREDENTIAL,
                });
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ iceServers }));
            return;
        }

        // --- WHEP proxy: Forward WebRTC signaling to MediaMTX (POST/PATCH/DELETE /live/whep*) ---
        if (req.url.startsWith("/live/whep") || (activeStreamPath !== "live" && req.url.startsWith(`/${activeStreamPath}/whep`))) {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => {
                const body = Buffer.concat(chunks);
                const targetPath = mapStreamUrl(req.url);
                const whepReq = http.request({
                    hostname: "127.0.0.1",
                    port: MEDIAMTX_WEBRTC_PORT,
                    path: targetPath,
                    method: req.method,
                    headers: {
                        "content-type": req.headers["content-type"] || "application/sdp",
                        "content-length": body.length,
                    },
                }, (whepRes) => {
                    const fwdHeaders = {
                        "access-control-allow-origin": "*",
                        "access-control-expose-headers": "Location, Link",
                    };
                    if (whepRes.headers["content-type"]) fwdHeaders["content-type"] = whepRes.headers["content-type"];
                    if (whepRes.headers["location"]) {
                        let loc = whepRes.headers["location"];
                        if (activeStreamPath !== "live" && loc.includes(`/${activeStreamPath}/whep`)) {
                            loc = loc.replace(`/${activeStreamPath}/whep`, "/live/whep");
                        }
                        fwdHeaders["location"] = loc;
                    }
                    if (whepRes.headers["link"]) fwdHeaders["link"] = whepRes.headers["link"];

                    res.writeHead(whepRes.statusCode, fwdHeaders);
                    whepRes.pipe(res);
                });

                whepReq.on("error", () => {
                    res.writeHead(502, { "Content-Type": "text/plain" });
                    res.end("WebRTC signaling server unavailable");
                });
                whepReq.write(body);
                whepReq.end();
            });
            return;
        }

        // --- HLS proxy: Transparent cookie-handling proxy to MediaMTX ---
        const clientKey = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client";
        const sessionCookie = activeCookies.get(clientKey) || "cookieCheck=1";
        const targetPath = mapStreamUrl(req.url);

        const proxyReq = http.request({
            agent: httpAgent,
            hostname: "127.0.0.1",
            port: MEDIAMTX_HLS_PORT,
            path: targetPath,
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
                        if (req.url && req.url.includes(".m3u8")) {
                            headers["cache-control"] = "no-cache, no-store, must-revalidate, max-age=0";
                            headers["pragma"] = "no-cache";
                            headers["expires"] = "0";
                        }
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
            if (req.url && req.url.includes(".m3u8")) {
                headers["cache-control"] = "no-cache, no-store, must-revalidate, max-age=0";
                headers["pragma"] = "no-cache";
                headers["expires"] = "0";
            }
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

    if (await checkPort(PROXY_PORT)) {
        killPort(PROXY_PORT);
        await new Promise((r) => setTimeout(r, 400));
    }

    await new Promise((resolve, reject) => {
        proxyServer.once("error", (err) => {
            if (err.code === "EADDRINUSE") {
                killPort(PROXY_PORT);
                setTimeout(() => {
                    proxyServer.listen(PROXY_PORT, "0.0.0.0", resolve);
                }, 500);
            } else {
                reject(err);
            }
        });
        proxyServer.listen(PROXY_PORT, "0.0.0.0", resolve);
    });
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
            console.log(`  WebRTC WHEP Feed:   ${liveUrl}/live/whep`);
            console.log(`  Cursor Telemetry:   wss://${match[1]}/ws`);
            console.log("--------------------------------------------------------------");
            console.log("  OBS STUDIO 60 FPS ULTRA-LOW LATENCY SETTINGS:");
            console.log("  1. Source:            macOS Syphon -> Select TouchDesigner");
            console.log("  2. Video FPS:         60 FPS (Settings -> Video -> Common FPS: 60)");
            console.log("  3. Stream Service:    Custom");
            console.log("  4. Stream Server:     rtmp://localhost:1935");
            console.log("  5. Stream Key:        live  (or Server: rtmp://localhost:1935/live + Key: live)");
            console.log("  6. Output -> Encoder: Apple VT H264 Hardware (or x264)");
            console.log("  7. Keyframe Interval: 1s (Strictly 1 second / 60 frames)");
            console.log("  8. B-Frames:          0 (Zero B-Frames for lowest latency)");
            console.log("  9. Bitrate:           6000 - 8000 Kbps CBR");
            console.log("  10. Click:            [Start Streaming] in OBS");
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
        try { clearInterval(pathDetectorInterval); } catch {}

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
