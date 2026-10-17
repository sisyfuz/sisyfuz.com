// src/tui/TuiLive.jsx
import { useState, useEffect, useRef, useMemo } from "react";
import { client } from "../sanityClient";

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";
const DEFAULT_STREAM_URL = isLocalhost ? "ws://localhost:9980" : "";

const GLITCH_CHARS = ["█", "▓", "▒", "░", "#", "+", "*", "~", "/", "\\", "%", "$", ">", "_"];

// Helper component to render text with cellular ASCII wipe animation
function AsciiWipeItem({ text, progress, startIndex = 0, totalLength = 80 }) {
    if (progress <= 0.005) return null;

    return (
        <span className="inline-block whitespace-pre font-mono">
            {text.split("").map((char, idx) => {
                const i = startIndex + idx;
                const normX = i / Math.max(1, totalLength);
                const stagger = ((i * 17) % 7) * 0.018;
                const threshold = normX + stagger;
                const delta = progress - threshold;

                if (delta > 0.06) {
                    // Fully resolved crisp character
                    return <span key={idx}>{char}</span>;
                } else if (delta >= -0.04 && delta <= 0.06) {
                    // Active wave front: Hot-pink glitch
                    const g = GLITCH_CHARS[(i + Math.floor(progress * 25)) % GLITCH_CHARS.length];
                    return (
                        <span key={idx} className="text-[#ff0080] font-bold">
                            {g}
                        </span>
                    );
                } else {
                    // Pre-wave: dim trailing ASCII glyph
                    const dimChar = ((i + idx) % 2 === 0) ? "·" : " ";
                    return (
                        <span key={idx} className="text-neutral-700 select-none">
                            {dimChar}
                        </span>
                    );
                }
            })}
        </span>
    );
}

export default function TuiLive({ onNavigate }) {
    const [streamUrl, setStreamUrl] = useState(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const queryUrl = params.get("stream") || params.get("s");
            if (queryUrl) return queryUrl;
            const saved = localStorage.getItem("sisyfuz_td_url");
            if (saved && isLocalhost) return saved;
        }
        return DEFAULT_STREAM_URL;
    });

    const [isLive, setIsLive] = useState(false);
    const [fps, setFps] = useState(0);
    const [displayMode, setDisplayMode] = useState("cover"); // "cover" | "fit"
    const [modeToast, setModeToast] = useState("");
    const [animFrame, setAnimFrame] = useState(0);

    // Top Header Auto-Reveal with ASCII Cellular Wipe
    const [isHoverTop, setIsHoverTop] = useState(false);
    const [wipeProgress, setWipeProgress] = useState(0);

    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const wsRef = useRef(null);
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(Date.now());
    const progressRef = useRef(0);

    // Smooth animation loop for top-bar ASCII cellular wipe
    useEffect(() => {
        const target = isHoverTop ? 1.0 : 0.0;
        let frameId;

        const animate = () => {
            const cur = progressRef.current;
            const diff = target - cur;

            if (Math.abs(diff) < 0.01) {
                progressRef.current = target;
                setWipeProgress(target);
                return;
            }

            const next = cur + diff * 0.18;
            progressRef.current = next;
            setWipeProgress(next);
            frameId = requestAnimationFrame(animate);
        };

        frameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frameId);
    }, [isHoverTop]);

    // Check Worker & Sanity for live stream URL (poll every 6s)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("stream") || params.get("s")) return;

        const checkLiveStatus = async () => {
            try {
                const res = await fetch(WORKER_LIVE_URL);
                if (res.ok) {
                    const data = await res.json();
                    if (data.active && data.url) {
                        setStreamUrl(data.url);
                    } else if (!isLocalhost) {
                        setStreamUrl("");
                        setIsLive(false);
                    }
                }
            } catch {
                client.fetch(`*[_id == "site-live-stream"][0]`).then(doc => {
                    if (doc?.active && doc?.url) {
                        setStreamUrl(doc.url);
                    }
                }).catch(() => {});
            }
        };

        checkLiveStatus();
        const poll = setInterval(checkLiveStatus, 6000);
        return () => clearInterval(poll);
    }, []);

    // Procedural ASCII oscilloscope for standby state
    useEffect(() => {
        if (isLive) return;
        const interval = setInterval(() => {
            setAnimFrame(prev => (prev + 1) % 100);
        }, 120);
        return () => clearInterval(interval);
    }, [isLive]);

    // Keyboard Shortcuts: Tab toggles Fit / Cover, Escape exits
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                setDisplayMode(prev => {
                    const next = prev === "cover" ? "fit" : "cover";
                    setModeToast(next === "cover" ? "MODE: COVER (100% FILL)" : "MODE: FIT (1:1 BEST FIT)");
                    return next;
                });
            } else if (e.key === "Escape") {
                if (onNavigate) {
                    onNavigate("home");
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onNavigate]);

    // Toast auto-hide
    useEffect(() => {
        if (!modeToast) return;
        const timer = setTimeout(() => setModeToast(""), 1600);
        return () => clearTimeout(timer);
    }, [modeToast]);

    // WebSocket Stream Client for TouchDesigner
    useEffect(() => {
        let isMounted = true;
        let reconnectTimer = null;

        if (!streamUrl) {
            setIsLive(false);
            return;
        }

        const isWs = streamUrl.startsWith("ws://") || streamUrl.startsWith("wss://");

        if (isWs) {
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
                            reconnectTimer = setTimeout(connectWs, 3000);
                        }
                    };
                } catch {
                    if (isMounted) {
                        setIsLive(false);
                        reconnectTimer = setTimeout(connectWs, 3000);
                    }
                }
            };

            connectWs();
        } else {
            // HTTP fallback
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

    // Mouse coordinates tracker (sends normalized u,v coordinates back to TouchDesigner)
    const handleMouseMove = (e) => {
        // Detect top hover zone (top 70px)
        if (e.clientY < 70) {
            setIsHoverTop(true);
        } else {
            setIsHoverTop(false);
        }

        // Send mouse tracking back to TouchDesigner
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect && rect.width && rect.height) {
                const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
                try {
                    wsRef.current.send(JSON.stringify({ type: "mouse", u: Number(u.toFixed(4)), v: Number(v.toFixed(4)) }));
                } catch {}
            }
        }
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

    const navItems = useMemo(() => [
        { key: "home", label: "sisyfuz" },
        { key: "work", label: "[work]" },
        { key: "press", label: "[press]" },
        { key: "about", label: "[about]" },
        { key: "archive", label: "[archive]" },
        { key: "live", label: "[live]" },
    ], []);

    const isHttp = streamUrl.startsWith("http://") || streamUrl.startsWith("https://");

    return (
        <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setIsHoverTop(false)}
            className="fixed inset-0 w-screen h-screen z-40 bg-[#050505] overflow-hidden select-none cursor-crosshair font-mono text-xs sm:text-[13px]"
        >
            {/* 1. TOP HOVER TRIGGER ZONE (Top 65px) */}
            <div
                onMouseEnter={() => setIsHoverTop(true)}
                className="fixed top-0 left-0 w-full h-16 z-50 pointer-events-auto"
            />

            {/* 2. TOP OPTIONS BAR REVEAL (CELLULAR ASCII WIPE ANIMATION) */}
            <div
                style={{
                    opacity: wipeProgress > 0.01 ? 1 : 0,
                    pointerEvents: wipeProgress > 0.5 ? "auto" : "none",
                }}
                className="fixed top-0 left-0 w-full z-50 transition-opacity duration-150 bg-black/85 backdrop-blur-md border-b border-white/10 px-6 sm:px-12 py-3"
            >
                <div className="flex items-center justify-between flex-wrap gap-4 uppercase">
                    
                    {/* Left: Site Navigation */}
                    <div className="flex items-center gap-4 sm:gap-6">
                        {navItems.map((item, idx) => {
                            const isLiveTab = item.key === "live";
                            return (
                                <button
                                    key={item.key}
                                    onClick={() => onNavigate && onNavigate(item.key)}
                                    className={`cursor-pointer px-1 -mx-1 transition-colors ${
                                        isLiveTab
                                            ? "text-[#ff0080] font-bold hover:bg-[#ff0080] hover:text-black"
                                            : "text-white hover:bg-white hover:text-black"
                                    }`}
                                >
                                    <AsciiWipeItem
                                        text={item.label}
                                        progress={wipeProgress}
                                        startIndex={idx * 10}
                                        totalLength={85}
                                    />
                                </button>
                            );
                        })}
                    </div>

                    {/* Right: Live Telemetry & Quick Controls */}
                    <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full inline-block ${
                                isLive ? "bg-[#ff0080] animate-pulse" : "bg-neutral-600"
                            }`} />
                            <span className={isLive ? "text-white font-bold" : "text-neutral-500"}>
                                <AsciiWipeItem
                                    text={isLive ? `LIVE ${fps > 0 ? `// ${fps} FPS` : ""}` : "OFFLINE"}
                                    progress={wipeProgress}
                                    startIndex={50}
                                    totalLength={85}
                                />
                            </span>
                        </div>

                        <button
                            onClick={() => setDisplayMode(prev => prev === "cover" ? "fit" : "cover")}
                            className="text-neutral-300 hover:bg-white hover:text-black px-1 uppercase cursor-pointer"
                            title="Press Tab to toggle anytime"
                        >
                            <AsciiWipeItem
                                text={`[TAB: ${displayMode.toUpperCase()}]`}
                                progress={wipeProgress}
                                startIndex={65}
                                totalLength={85}
                            />
                        </button>

                        <button
                            onClick={toggleFullscreen}
                            className="text-neutral-400 hover:bg-[#ff0080] hover:text-black px-1 uppercase cursor-pointer"
                        >
                            <AsciiWipeItem
                                text="[FULLSCREEN]"
                                progress={wipeProgress}
                                startIndex={75}
                                totalLength={85}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* 3. VISUAL DISPLAY: FULL VIEWPORT (COVER OR FIT) */}
            <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
                
                {/* WebSocket Canvas Stream (Native Mac 1280x1280) */}
                <canvas
                    ref={canvasRef}
                    className={`select-none pointer-events-none ${
                        isLive && !isHttp ? "block" : "hidden"
                    } ${
                        displayMode === "cover"
                            ? "w-full h-full object-cover"
                            : "w-full h-full object-contain max-w-[1280px] max-h-[1280px]"
                    }`}
                />

                {/* HTTP Fallback */}
                {isLive && isHttp && (
                    <img
                        src={streamUrl}
                        alt="TouchDesigner Live Feed"
                        className={`select-none pointer-events-none ${
                            displayMode === "cover"
                                ? "w-full h-full object-cover"
                                : "w-full h-full object-contain max-w-[1280px] max-h-[1280px]"
                        }`}
                    />
                )}

                {/* STANDBY: PURE PROCEDURAL ASCII OSCILLOSCOPE */}
                {!isLive && (
                    <div className="flex flex-col items-center justify-center p-6 text-center space-y-6 select-none animate-fadeIn">
                        <pre className="text-xs sm:text-sm leading-none text-neutral-400 font-mono">
                            {renderOscilloscope(animFrame)}
                        </pre>

                        <div className="space-y-1 uppercase tracking-wider text-xs">
                            <span className="text-[#ff0080] font-bold block">
                                [ STANDBY // CARRIER SIGNAL SEARCHING ]
                            </span>
                            <span className="text-neutral-500 block text-[11px]">
                                AUTO_RECONNECT: ACTIVE
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* 4. TAB MODE SWITCH TOAST (Minimal Center Notification) */}
            {modeToast && (
                <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
                    <div className="bg-black/90 border border-white/20 text-[#ff0080] font-bold px-4 py-2 uppercase tracking-widest text-xs animate-fadeIn shadow-2xl">
                        {modeToast}
                    </div>
                </div>
            )}
        </div>
    );
}

function renderOscilloscope(frame) {
    const width = 50;
    const lines = [];

    lines.push("+--------------------------------------------------+");
    for (let y = 0; y < 11; y++) {
        let row = "|";
        for (let x = 0; x < width; x++) {
            const wave1 = Math.sin((x + frame * 2) * 0.18) * 3.8 + 5;
            const wave2 = Math.cos((x - frame * 1.6) * 0.14) * 2.5 + 5;
            const isWave = Math.round(wave1) === y || Math.round(wave2) === y;
            const isCenter = y === 5 && x > 14 && x < 36;

            if (isCenter) {
                row += "=";
            } else if (isWave) {
                row += (frame % 2 === 0 ? "~" : "*");
            } else {
                row += " ";
            }
        }
        row += "|";
        lines.push(row);
    }
    lines.push("+--------------------------------------------------+");

    return lines.join("\n");
}
