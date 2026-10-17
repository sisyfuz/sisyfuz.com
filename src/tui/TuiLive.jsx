// src/tui/TuiLive.jsx
import { useState, useEffect, useRef } from "react";
import { ASCII_DIVIDER } from "../utils/ascii";
import { client } from "../sanityClient";

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const DEFAULT_STREAM_URL = isLocalhost ? "ws://localhost:9980" : "wss://polo-jake-physicians-twist.trycloudflare.com";

export default function TuiLive() {
    const [streamUrl, setStreamUrl] = useState(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const queryUrl = params.get("stream") || params.get("s");
            if (queryUrl) return queryUrl;
            const saved = localStorage.getItem("sisyfuz_td_url");
            if (saved) return saved;
        }
        return DEFAULT_STREAM_URL;
    });
    const [isLive, setIsLive] = useState(false);
    const [fps, setFps] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [showMacGuide, setShowMacGuide] = useState(false);
    const [tempUrl, setTempUrl] = useState(streamUrl);
    const [animFrame, setAnimFrame] = useState(0);
    const [copied, setCopied] = useState(false);

    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const wsRef = useRef(null);
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(Date.now());

    // Check Sanity for globally active live stream URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("stream") || params.get("s")) return;

        client.fetch(`*[_id == "site-live-stream"][0]`).then(doc => {
            if (doc?.active && doc?.url) {
                setStreamUrl(doc.url);
                setTempUrl(doc.url);
            }
        }).catch(() => {});
    }, []);

    // Procedural ASCII oscilloscope for standby state
    useEffect(() => {
        if (isLive) return;
        const interval = setInterval(() => {
            setAnimFrame(prev => (prev + 1) % 100);
        }, 120);
        return () => clearInterval(interval);
    }, [isLive]);

    // WebSocket / HTTP Connection Engine for TouchDesigner Mac
    useEffect(() => {
        let isMounted = true;
        let reconnectTimer = null;

        const isWs = streamUrl.startsWith("ws://") || streamUrl.startsWith("wss://");

        if (isWs) {
            // WEBSOCKET MODE: Native TouchDesigner on Mac (WebSocket Server DAT)
            const connectWs = () => {
                if (!isMounted) return;

                try {
                    const ws = new WebSocket(streamUrl);
                    ws.binaryType = "blob";
                    wsRef.current = ws;

                    ws.onopen = () => {
                        if (isMounted) setIsLive(true);
                    };

                    ws.onmessage = async (e) => {
                        if (!isMounted) return;
                        setIsLive(true);

                        // FPS Calculation
                        frameCountRef.current++;
                        const now = Date.now();
                        if (now - lastFpsTimeRef.current >= 1000) {
                            setFps(frameCountRef.current);
                            frameCountRef.current = 0;
                            lastFpsTimeRef.current = now;
                        }

                        // Draw incoming TouchDesigner 1280x1280 binary frame onto canvas
                        try {
                            const bitmap = await createImageBitmap(e.data);
                            const canvas = canvasRef.current;
                            if (canvas) {
                                if (canvas.width !== 1280 || canvas.height !== 1280) {
                                    canvas.width = 1280;
                                    canvas.height = 1280;
                                }
                                const ctx = canvas.getContext("2d");
                                if (ctx) {
                                    ctx.drawImage(bitmap, 0, 0, 1280, 1280);
                                }
                            }
                            bitmap.close();
                        } catch (err) {
                            console.warn("Frame draw error:", err);
                        }
                    };

                    ws.onerror = () => {
                        if (isMounted) setIsLive(false);
                    };

                    ws.onclose = () => {
                        if (isMounted) {
                            setIsLive(false);
                            // Auto-reconnect every 3 seconds
                            reconnectTimer = setTimeout(connectWs, 3000);
                        }
                    };
                } catch (err) {
                    if (isMounted) {
                        setIsLive(false);
                        reconnectTimer = setTimeout(connectWs, 3000);
                    }
                }
            };

            connectWs();
        } else {
            // HTTP MJPEG MODE: For tunnels or standard HTTP endpoints
            const testImg = new Image();
            testImg.onload = () => isMounted && setIsLive(true);
            testImg.onerror = () => isMounted && setIsLive(false);
            testImg.src = `${streamUrl}?t=${Date.now()}`;
        }

        return () => {
            isMounted = false;
            if (wsRef.current) wsRef.current.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [streamUrl]);

    const handleSaveUrl = (e) => {
        e.preventDefault();
        const trimmed = tempUrl.trim();
        setStreamUrl(trimmed);
        localStorage.setItem("sisyfuz_td_url", trimmed);
        setShowSettings(false);
    };

    const toggleFullscreen = () => {
        const el = containerRef.current;
        if (!el) return;
        if (!document.fullscreenElement) {
            el.requestFullscreen().catch(err => console.warn(err));
        } else {
            document.exitFullscreen();
        }
    };

    const handleCopyShareLink = () => {
        const publicStream = streamUrl.startsWith("wss://") 
            ? streamUrl 
            : "wss://polo-jake-physicians-twist.trycloudflare.com";
        const link = `https://sisyfuz.com/live?stream=${encodeURIComponent(publicStream)}`;
        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    const isHttp = streamUrl.startsWith("http://") || streamUrl.startsWith("https://");

    return (
        <div className="space-y-6 max-w-4xl animate-fadeIn text-xs sm:text-[13px] leading-relaxed font-mono">
            
            {/* Header & Status */}
            <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2 uppercase">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full inline-block ${
                            isLive ? "bg-pink-500 animate-pulse" : "bg-neutral-600"
                        }`} />
                        <span className="font-bold text-white">
                            TOUCHDESIGNER // 1280×1280 REALTIME TOP (MAC)
                        </span>
                        {isLive && fps > 0 && (
                            <span className="text-pink-500 font-bold ml-2">[{fps} FPS]</span>
                        )}
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                        <button
                            onClick={handleCopyShareLink}
                            className="text-pink-400 hover:bg-pink-500 hover:text-black font-bold px-1 uppercase cursor-pointer"
                            title="Copy public link to share with anyone"
                        >
                            [{copied ? "LINK_COPIED!" : "SHARE_LINK"}]
                        </button>
                        <button
                            onClick={() => setShowMacGuide(prev => !prev)}
                            className="text-neutral-400 hover:bg-white hover:text-black px-1 uppercase cursor-pointer"
                        >
                            [{showMacGuide ? "HIDE_MAC_SETUP" : "MAC_SETUP"}]
                        </button>
                        <button
                            onClick={() => setShowSettings(prev => !prev)}
                            className="text-neutral-400 hover:bg-white hover:text-black px-1 uppercase cursor-pointer"
                        >
                            [{showSettings ? "HIDE_URL" : "CONFIG_URL"}]
                        </button>
                        {isLive && (
                            <button
                                onClick={toggleFullscreen}
                                className="text-white hover:bg-pink-500 hover:text-black font-bold uppercase px-1 cursor-pointer"
                            >
                                [FULLSCREEN]
                            </button>
                        )}
                    </div>
                </div>

                <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>
            </div>

            {/* Mac TouchDesigner Step-by-Step Box */}
            {showMacGuide && (
                <div className="space-y-4 bg-black/80 border border-pink-500/40 p-5 text-neutral-300">
                    <span className="uppercase font-bold text-pink-500 block">
                        MAC TOUCHDESIGNER NATIVE SETUP (NO VIDEO STREAM OUT NEEDED):
                    </span>
                    <p className="text-xs">
                        On macOS, TouchDesigner does not have `Video Stream Out TOP` (Windows-only). Instead, we use TouchDesigner's native **Web Server DAT** which supports WebSockets out-of-the-box on Mac with zero plugins!
                    </p>
                    <div className="space-y-2 text-xs">
                        <div><b>1. Add node:</b> Press <kbd className="bg-neutral-800 px-1">Tab</kbd> &rarr; DAT &rarr; create a <b>Web Server DAT</b> (named <code>webserver1</code>). It auto-creates <code>webserver1_callbacks</code>.</div>
                        <div><b>2. Settings:</b> On <code>webserver1</code>, set <b>Port</b> to <code>9980</code> and <b>Active</b> to <code>On</code>.</div>
                        <div><b>3. Callbacks:</b> In <code>webserver1_callbacks</code>, replace the code with the script below to track browser connections and broadcast frames.</div>
                        <div><b>4. Trigger:</b> Press <kbd className="bg-neutral-800 px-1">Tab</kbd> &rarr; DAT &rarr; create an <b>Execute DAT</b> (<code>execute1</code>). Turn on <b>Frame End: On</b>.</div>
                    </div>

                    <div className="text-xs text-neutral-400 font-bold uppercase pt-2">A. Paste into `webserver1_callbacks`:</div>
                    <pre className="bg-neutral-950 p-3 border border-white/20 text-xs text-white overflow-x-auto select-all">
{`# webserver1_callbacks
active_clients = set()

def onServerStart(webServerDAT):
    active_clients.clear()

def onWebSocketOpen(webServerDAT, client, uri):
    active_clients.add(client)

def onWebSocketClose(webServerDAT, client):
    active_clients.discard(client)

def broadcastFrame(webServerDAT, top_name='null1'):
    if not active_clients:
        return # 0% CPU when no browser is watching
    data = op(top_name).saveByteArray('.jpg')
    for client in list(active_clients):
        try:
            webServerDAT.webSocketSendBinary(client, data)
        except Exception:
            active_clients.discard(client)`}
                    </pre>

                    <div className="text-xs text-neutral-400 font-bold uppercase pt-2">B. Paste into `execute1` (Execute DAT):</div>
                    <pre className="bg-neutral-950 p-3 border border-white/20 text-xs text-white overflow-x-auto select-all">
{`def onFrameEnd(frame):
    # Sends the current 1280x1280 frame from 'null1' to all open browsers
    cb = op('webserver1_callbacks')
    if cb and hasattr(cb.module, 'broadcastFrame'):
        cb.module.broadcastFrame(op('webserver1'), 'null1')`}
                    </pre>

                    <div className="text-neutral-400 text-xs pt-1">
                        That's it! As soon as TouchDesigner is running with this, this page connects to <code>ws://localhost:9980</code> automatically and renders your visual TOP in real time.
                    </div>
                </div>
            )}

            {/* URL Config Form */}
            {showSettings && (
                <form onSubmit={handleSaveUrl} className="space-y-3 bg-black/60 border border-white/20 p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="uppercase font-bold text-white block">STREAM_ENDPOINT_CONFIG:</span>
                        <div className="flex items-center gap-2 text-xs">
                            <button
                                type="button"
                                onClick={() => {
                                    setTempUrl("ws://localhost:9980");
                                    setStreamUrl("ws://localhost:9980");
                                    localStorage.setItem("sisyfuz_td_url", "ws://localhost:9980");
                                }}
                                className="text-neutral-400 hover:text-white uppercase cursor-pointer"
                            >
                                [USE_LOCAL_9980]
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const tun = "wss://polo-jake-physicians-twist.trycloudflare.com";
                                    setTempUrl(tun);
                                    setStreamUrl(tun);
                                    localStorage.setItem("sisyfuz_td_url", tun);
                                }}
                                className="text-pink-400 hover:underline uppercase cursor-pointer"
                            >
                                [USE_CLOUDFLARE_TUNNEL]
                            </button>
                        </div>
                    </div>
                    <p className="text-neutral-400 text-xs">
                        Local Mac: <code>ws://localhost:9980</code> (Fastest for local testing)<br />
                        Public Cloudflare: <code>wss://&lt;subdomain&gt;.trycloudflare.com</code> (For everyone on the internet)
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        <input
                            type="text"
                            value={tempUrl}
                            onChange={(e) => setTempUrl(e.target.value)}
                            className="flex-1 bg-black border border-white/40 px-3 py-1.5 text-xs text-white font-mono outline-none focus:border-pink-500"
                            placeholder="ws://localhost:9980 or wss://...trycloudflare.com"
                        />
                        <button
                            type="submit"
                            className="bg-white text-black font-bold px-4 py-1.5 hover:bg-pink-500 hover:text-white uppercase cursor-pointer"
                        >
                            CONNECT
                        </button>
                    </div>
                </form>
            )}

            {/* 1280x1280 SQUARE DISPLAY CONTAINER */}
            <div
                ref={containerRef}
                className="relative aspect-square w-full max-w-[720px] bg-black border border-white/20 overflow-hidden flex items-center justify-center select-none"
            >
                {/* WebSocket Canvas Renderer (Native Mac) */}
                <canvas
                    ref={canvasRef}
                    className={`w-full h-full object-contain ${isLive && !isHttp ? "block" : "hidden"}`}
                />

                {/* HTTP MJPEG Fallback Renderer */}
                {isLive && isHttp && (
                    <img
                        src={streamUrl}
                        alt="TouchDesigner Live TOP"
                        className="w-full h-full object-contain select-none"
                    />
                )}

                {/* STANDBY PROCEDURAL ASCII TEST PATTERN */}
                {!isLive && (
                    <div className="flex flex-col items-center justify-center p-6 text-center space-y-6">
                        <pre className="text-[10px] sm:text-xs leading-none text-neutral-400 font-mono select-none">
                            {renderOscilloscope(animFrame)}
                        </pre>

                        <div className="space-y-2 uppercase">
                            <span className="text-pink-500 font-bold block">
                                [ STANDBY // CARRIER SIGNAL ABSENT ]
                            </span>
                            <p className="text-neutral-500 text-[11px] max-w-md">
                                WAITING FOR TOUCHDESIGNER TRANSMISSION ON PORT 9980...<br />
                                AUTOMATIC RECONNECTION ENGAGED.
                            </p>
                        </div>

                        <div className="text-neutral-600 text-[10px] uppercase">
                            NATIVE MAC ENGINE // WEBSOCKET PORT 9980 // 1280 × 1280 TOP
                        </div>
                    </div>
                )}
            </div>

            {/* Stream Metadata Footer */}
            <div className="flex items-center justify-between text-neutral-500 uppercase text-xs pt-2">
                <span>
                    {isLive ? `● LIVE STREAM ACTIVE` : "○ SEARCHING CARRIER..."}
                </span>
                <span>ENDPOINT: {streamUrl}</span>
            </div>

        </div>
    );
}

function renderOscilloscope(frame) {
    const width = 42;
    const lines = [];

    lines.push("+------------------------------------------+");
    for (let y = 0; y < 9; y++) {
        let row = "|";
        for (let x = 0; x < width; x++) {
            const wave1 = Math.sin((x + frame * 2) * 0.2) * 3 + 4;
            const wave2 = Math.cos((x - frame * 1.5) * 0.15) * 2 + 4;
            const isWave = Math.round(wave1) === y || Math.round(wave2) === y;
            const isCenter = y === 4 && x > 12 && x < 30;

            if (isCenter && y === 4) {
                row += "=".slice(0, 1);
            } else if (isWave) {
                row += (frame % 2 === 0 ? "~" : "*");
            } else {
                row += " ";
            }
        }
        row += "|";
        lines.push(row);
    }
    lines.push("+------------------------------------------+");

    return lines.join("\n");
}
