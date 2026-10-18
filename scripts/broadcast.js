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
import { WebSocketServer, WebSocket } from "ws";

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
const BROADCAST_SECRET = process.env.BROADCAST_SECRET || "";

// Metered.ca TURN credentials (optional — WebRTC falls back to STUN-only if unset)
const TURN_USERNAME = process.env.METERED_TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.METERED_TURN_CREDENTIAL || "";
const TURN_HOST = process.env.METERED_TURN_HOST || "global.relay.metered.ca";
const TURN_URL = process.env.METERED_TURN_URL || (TURN_USERNAME ? `turn:${TURN_HOST}:80` : "");

// Chat & Security constants
const URL_REGEX = /(https?:\/\/|www\.|\.com\/|\.org\/|\.net\/|\.xyz|\.ru|\.top|\.cn|discord\.gg|t\.me)/i;
const clientChatTimes = new Map();

// Helper to detect if request originated from local machine (127.0.0.1 / localhost)
// and NOT forwarded through Cloudflare Tunnel or external proxy
function isLocalRequest(req) {
    if (!req) return false;
    // Cloudflare Tunnel injects CF-* headers for all forwarded traffic
    if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["cf-visitor"]) {
        return false;
    }
    const host = (req.headers["host"] || "").toLowerCase();
    if (host.includes("trycloudflare.com") || host.includes("sisyfuz.com")) {
        return false;
    }
    const remote = req.socket?.remoteAddress || "";
    const isLoopbackIp = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    return isLoopbackIp && isLocalHost;
}

function sanitizeChatText(str) {
    return String(str || "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "") // strip control characters
        .trim()
        .slice(0, 200);
}

function sanitizeUsername(str, isHost = false) {
    let clean = String(str || "anon")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .trim()
        .slice(0, 24) || "anon";
    if (!isHost) {
        clean = clean.replace(/^\[HOST\]\s*/i, "").trim() || "anon";
    }
    return clean;
}

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

// Publish/Unpublish status to worker with optional authentication
async function setLiveState(url, active) {
    try {
        const headers = { "Content-Type": "application/json" };
        if (BROADCAST_SECRET) {
            headers["X-Broadcast-Secret"] = BROADCAST_SECRET;
        }
        const res = await fetch(WORKER_LIVE_URL, {
            method: "POST",
            headers,
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

    // 2. Start MediaMTX with Watchdog
    console.log("[2/4] Starting MediaMTX low-latency engine...");
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

    const launchMediaMTX = () => {
        if (isShuttingDown) return;
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
                console.error(`      [WATCHDOG] MediaMTX stopped unexpectedly (code: ${code}, signal: ${sig}). Restarting in 1s...`);
                setTimeout(() => {
                    killPort(MEDIAMTX_HLS_PORT);
                    killPort(MEDIAMTX_WEBRTC_PORT);
                    killPort(1935);
                    launchMediaMTX();
                }, 1000);
            }
        });
    };

    const isHlsListening = await checkPort(MEDIAMTX_HLS_PORT);
    const isRtmpListening = await checkPort(1935);

    if (isHlsListening && isRtmpListening) {
        console.log("      [OK] MediaMTX is already active on port 1935 / 8888.\n");
    } else {
        // Clear any half-open/stale ports before starting fresh
        killPort(MEDIAMTX_HLS_PORT);
        killPort(MEDIAMTX_WEBRTC_PORT);
        killPort(1935);
        killPort(9997);
        await new Promise((r) => setTimeout(r, 300));

        launchMediaMTX();

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

    function getAlternatePath(url) {
        if (!url || typeof url !== "string") return null;
        if (url === "/live/whep") return "/live/live/whep";
        if (url.startsWith("/live/whep/")) return url.replace("/live/whep/", "/live/live/whep/");
        if (url === "/live/live/whep") return "/live/whep";
        if (url.startsWith("/live/live/whep/")) return url.replace("/live/live/whep/", "/live/whep/");
        if (url.startsWith("/live/live/")) return url.replace("/live/live/", "/live/");
        if (url.startsWith("/live/")) return url.replace("/live/", "/live/live/");
        return null;
    }

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

    // In-memory chat history and client hub
    const chatHistory = [];
    const activeWsClients = new Set();
    let tdSocket = null;
    let tdConnected = false;

    // Connect to TouchDesigner receiver on port 9980 to forward telemetry & chat
    const connectTouchDesigner = () => {
        if (isShuttingDown) return;
        try {
            const ws = new WebSocket(`ws://127.0.0.1:${TD_PORT}`);
            tdSocket = ws;

            ws.on("open", () => {
                tdConnected = true;
                console.log(`      [OK] Connected to TouchDesigner receiver on port ${TD_PORT}`);
                try {
                    ws.send(JSON.stringify({ type: "stats", viewers: Math.max(1, activeWsClients.size) }));
                } catch {}
            });

            ws.on("message", (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === "stats") {
                        const statsStr = JSON.stringify(msg);
                        for (const client of activeWsClients) {
                            if (client.readyState === WebSocket.OPEN) client.send(statsStr);
                        }
                    }
                } catch {}
            });

            ws.on("close", () => {
                tdConnected = false;
                tdSocket = null;
                if (!isShuttingDown) setTimeout(connectTouchDesigner, 3000);
            });

            ws.on("error", () => {
                tdConnected = false;
                if (tdSocket) {
                    try { tdSocket.close(); } catch {}
                    tdSocket = null;
                }
                if (!isShuttingDown) setTimeout(connectTouchDesigner, 3000);
            });
        } catch {
            if (!isShuttingDown) setTimeout(connectTouchDesigner, 3000);
        }
    };

    connectTouchDesigner();

    proxyServer = http.createServer((req, res) => {
        // Universal CORS headers for web browsers (extended for WHEP PATCH/DELETE)
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS, HEAD");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Expose-Headers", "Location, Link, Accept-Post");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        // --- /turn-config: STUN-first to protect Metered.ca quota; LL-HLS fallback for relay ---
        if (req.url && req.url.startsWith("/turn-config")) {
            const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
            const urlObj = new URL(req.url, "http://localhost");
            const allowRelay = urlObj.searchParams.get("relay") === "1" || process.env.ENABLE_METERED_RELAY === "true";
            if (allowRelay && TURN_USERNAME && TURN_CREDENTIAL) {
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

        // --- /chat/history: Fetch recent chat messages ---
        if (req.url === "/chat/history") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ messages: chatHistory }));
            return;
        }

        // --- /chat/send: Send a chat message via HTTP POST ---
        if (req.url === "/chat/send" && req.method === "POST") {
            const isLocal = isLocalRequest(req);
            const clientIp = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client";

            // Basic rate limit check for HTTP chat posts (1 per 1.5s per client IP)
            const now = Date.now();
            const lastPost = clientChatTimes.get(clientIp) || 0;
            if (now - lastPost < 1500) {
                res.writeHead(429, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Slow down. Please wait 1.5s between messages." }));
                return;
            }
            clientChatTimes.set(clientIp, now);

            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => {
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
                    const isHost = isLocal && Boolean(body.isHost);
                    const user = sanitizeUsername(body.user, isHost);
                    const text = sanitizeChatText(body.text);

                    if (!text) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Empty message" }));
                        return;
                    }

                    if (!isHost && URL_REGEX.test(text)) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Links are not permitted in chat." }));
                        return;
                    }

                    const msgObj = {
                        type: "chat",
                        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        user: isHost && !user.startsWith("[HOST]") ? `[HOST] ${user}` : user,
                        text,
                        isHost,
                        time: Math.floor(Date.now() / 1000),
                    };

                    chatHistory.push(msgObj);
                    if (chatHistory.length > 50) chatHistory.shift();

                    const msgStr = JSON.stringify(msgObj);
                    for (const client of activeWsClients) {
                        if (client.readyState === WebSocket.OPEN) client.send(msgStr);
                    }
                    if (tdSocket && tdSocket.readyState === WebSocket.OPEN) {
                        tdSocket.send(msgStr);
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: true, message: msgObj }));
                } catch (e) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // --- /api/status: Broadcast health & stats for Companion App (Localhost Only) ---
        if (req.url === "/api/status") {
            if (!isLocalRequest(req)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Forbidden: Local access only" }));
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                active: Boolean(liveUrl),
                url: liveUrl,
                viewers: Math.max(0, activeWsClients.size),
                tdConnected,
                chatCount: chatHistory.length,
            }));
            return;
        }

        // --- /api/broadcast/stop: Clean shutdown invoked from Companion App (Localhost Only) ---
        if (req.url === "/api/broadcast/stop" && req.method === "POST") {
            if (!isLocalRequest(req)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Forbidden: Local access only" }));
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, message: "Stopping broadcast..." }));
            setTimeout(() => {
                cleanup();
            }, 300);
            return;
        }

        // --- WebRTC signaling proxy (WHEP playback & WHIP ingestion) ---
        if (
            req.url.startsWith("/live/whep") ||
            req.url.startsWith("/live/live/whep") ||
            req.url.startsWith("/live/whip") ||
            req.url.startsWith("/live/live/whip")
        ) {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => {
                const body = Buffer.concat(chunks);
                const sendWhep = (targetPath, isRetry = false) => {
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
                        // If 404 on initial attempt, transparently try alternate path immediately
                        if (whepRes.statusCode === 404 && !isRetry) {
                            const alt = getAlternatePath(targetPath);
                            if (alt) {
                                return sendWhep(alt, true);
                            }
                        }

                        if (whepRes.statusCode >= 200 && whepRes.statusCode < 300) {
                            if (targetPath.includes("/live/live/")) activeStreamPath = "live/live";
                            else if (targetPath.includes("/live/")) activeStreamPath = "live";
                        }

                        const fwdHeaders = {
                            "access-control-allow-origin": "*",
                            "access-control-expose-headers": "Location, Link, Accept-Post",
                        };
                        if (whepRes.headers["content-type"]) fwdHeaders["content-type"] = whepRes.headers["content-type"];
                        if (whepRes.headers["accept-post"]) fwdHeaders["accept-post"] = whepRes.headers["accept-post"];
                        if (whepRes.headers["location"]) {
                            let loc = whepRes.headers["location"];
                            if (activeStreamPath !== "live" && loc.includes(`/${activeStreamPath}/whep`)) {
                                loc = loc.replace(`/${activeStreamPath}/whep`, "/live/whep");
                            }
                            if (activeStreamPath !== "live" && loc.includes(`/${activeStreamPath}/whip`)) {
                                loc = loc.replace(`/${activeStreamPath}/whip`, "/live/whip");
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
                };

                sendWhep(mapStreamUrl(req.url));
            });
            return;
        }

        // --- HLS proxy: Transparent cookie-handling proxy to MediaMTX with auto-retry ---
        const clientKey = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client";
        const sessionCookie = activeCookies.get(clientKey) || "cookieCheck=1";

        const sendHls = (targetPath, isRetry = false) => {
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
                // If 404 on playlist request, transparently retry alternate path
                if (proxyRes.statusCode === 404 && !isRetry && (targetPath.endsWith(".m3u8") || targetPath.includes("/live/"))) {
                    const alt = getAlternatePath(targetPath);
                    if (alt) {
                        return sendHls(alt, true);
                    }
                }

                if (proxyRes.statusCode === 200 || proxyRes.statusCode === 302) {
                    if (targetPath.includes("/live/live/")) activeStreamPath = "live/live";
                    else if (targetPath.includes("/live/")) activeStreamPath = "live";
                }

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
        };

        sendHls(mapStreamUrl(req.url));
    });

    // Set up WebSocketServer for Chat & Multi-User Telemetry Hub
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (clientWs, req) => {
        activeWsClients.add(clientWs);
        clientWs.isLocal = isLocalRequest(req);
        clientWs.isHostClient = false;

        // Send recent chat history and live stats on connect
        try {
            clientWs.send(JSON.stringify({ type: "chat_history", messages: chatHistory }));
            const statsMsg = JSON.stringify({ type: "stats", viewers: Math.max(1, activeWsClients.size) });
            clientWs.send(statsMsg);
            if (tdSocket && tdSocket.readyState === WebSocket.OPEN) {
                tdSocket.send(statsMsg);
            }
        } catch {}

        let lastMessageTime = 0;

        clientWs.on("message", (data) => {
            try {
                const rawStr = data.toString();
                const msg = JSON.parse(rawStr);

                // Handle live audience chat message
                if (msg.type === "chat") {
                    const now = Date.now();
                    // Anti-spam cooldown (1.5s per message per client)
                    if (now - lastMessageTime < 1500) return;
                    lastMessageTime = now;

                    const isHost = clientWs.isLocal && Boolean(msg.isHost || clientWs.isHostClient);
                    const cleanUser = sanitizeUsername(msg.user, isHost);
                    const cleanText = sanitizeChatText(msg.text);
                    if (!cleanText) return;

                    // Filter links from non-host viewers
                    if (!isHost && URL_REGEX.test(cleanText)) {
                        return;
                    }

                    const msgObj = {
                        type: "chat",
                        id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
                        user: isHost && !cleanUser.startsWith("[HOST]") ? `[HOST] ${cleanUser}` : cleanUser,
                        text: cleanText,
                        isHost,
                        time: Math.floor(now / 1000),
                    };

                    chatHistory.push(msgObj);
                    if (chatHistory.length > 50) chatHistory.shift();

                    const broadcastStr = JSON.stringify(msgObj);
                    for (const c of activeWsClients) {
                        if (c.readyState === WebSocket.OPEN) c.send(broadcastStr);
                    }
                    // Forward chat message to TouchDesigner receiver
                    if (tdSocket && tdSocket.readyState === WebSocket.OPEN) {
                        tdSocket.send(broadcastStr);
                    }
                    return;
                }

                // Handle cursor telemetry (forward to TouchDesigner)
                if (msg.type === "mouse" || msg.type === "telemetry") {
                    if (tdSocket && tdSocket.readyState === WebSocket.OPEN) {
                        tdSocket.send(rawStr);
                    }
                    return;
                }

                // Handle Companion App identification (Local only)
                if (msg.type === "host_auth") {
                    if (clientWs.isLocal) {
                        clientWs.isHostClient = true;
                    }
                    return;
                }
            } catch {
                // If message is not JSON, forward raw buffer to TouchDesigner
                if (tdSocket && tdSocket.readyState === WebSocket.OPEN) {
                    tdSocket.send(data);
                }
            }
        });

        clientWs.on("close", () => {
            activeWsClients.delete(clientWs);
            const statsMsg = JSON.stringify({ type: "stats", viewers: Math.max(1, activeWsClients.size) });
            for (const c of activeWsClients) {
                if (c.readyState === WebSocket.OPEN) c.send(statsMsg);
            }
            if (tdSocket && tdSocket.readyState === WebSocket.OPEN) {
                tdSocket.send(statsMsg);
            }
        });

        clientWs.on("error", () => {
            activeWsClients.delete(clientWs);
        });
    });

    // Handle WebSocket upgrades
    proxyServer.on("upgrade", (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
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
            console.log("  OBS STUDIO 60 FPS STREAMING SETTINGS:");
            console.log("  1. Video Source:      macOS Syphon -> Select TouchDesigner");
            console.log("  2. Audio Source:      Sources (+) -> Application Audio Capture -> TouchDesigner");
            console.log("                        (Or Audio Input Capture -> Your Mic / BlackHole)");
            console.log("  3. Audio Monitoring:  In Audio Mixer gear -> Advanced Audio Properties -> Monitor Off");
            console.log("  4. Video Canvas/FPS:  1280x1280 @ 60 FPS (Settings -> Video)");
            console.log("  5. Stream (Option A - WHIP ~150ms with Native Opus Audio):");
            console.log("       Service:         WHIP");
            console.log("       Server:          http://localhost:8889/live/whip (or http://localhost:9988/live/whip)");
            console.log("       Bearer Token:    (leave empty)");
            console.log("     Stream (Option B - RTMP Ingest):");
            console.log("       Service:         Custom");
            console.log("       Server:          rtmp://localhost:1935");
            console.log("       Stream Key:      live");
            console.log("  6. Video Encoder:     Apple VT H264 Hardware (Bitrate: 6000-8000 Kbps, Keyframe: 1s)");
            console.log("  7. Click:             [Start Streaming] in OBS");
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
            if (tdSocket) tdSocket.close();
        } catch {}

        try {
            for (const c of activeWsClients) {
                try { c.close(); } catch {}
            }
            activeWsClients.clear();
        } catch {}

        try {
            wss.close();
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
