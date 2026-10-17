// src/tui/TuiLive.jsx
import { useState, useEffect, useRef, useMemo } from "react";
import Hls from "hls.js";
import { client } from "../sanityClient";

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";
const DEFAULT_STREAM_URL = isLocalhost ? "http://localhost:9988" : "";

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
    const [streamProtocol, setStreamProtocol] = useState("");
    const [displayMode, setDisplayMode] = useState("cover"); // "cover" | "fit"
    const [modeToast, setModeToast] = useState("");
    const [animFrame, setAnimFrame] = useState(0);

    // Top Header Auto-Reveal with ASCII Cellular Wipe
    const [isHoverTop, setIsHoverTop] = useState(false);
    const [wipeProgress, setWipeProgress] = useState(0);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const wsRef = useRef(null);
    const hlsRef = useRef(null);
    const pcRef = useRef(null);
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

    // Check Worker & Sanity for live stream URL (poll every 5s)
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
                        setStreamProtocol("");
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
        const poll = setInterval(checkLiveStatus, 5000);
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

    // 1. Video Player Engine (Ultra-Low Latency: WebRTC WHEP first, then Low-Latency HLS fallback)
    useEffect(() => {
        let isMounted = true;
        const isHttp = streamUrl && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"));

        if (!isHttp) return;

        const video = videoRef.current;
        if (!video) return;

        const cleanUrl = streamUrl.replace(/\/+$/, "");
        const whepUrl = cleanUrl.includes(".m3u8")
            ? cleanUrl.replace(/index\.m3u8.*$/, "whep")
            : `${cleanUrl}/live/whep`;
        const hlsUrl = cleanUrl.includes(".m3u8")
            ? cleanUrl
            : `${cleanUrl}/live/index.m3u8`;

        let hlsInstance = null;
        let pc = null;
        let whepTimeout = null;
        let fallbackTriggered = false;

        const startHls = () => {
            if (!isMounted || fallbackTriggered) return;
            fallbackTriggered = true;

            if (pc) {
                try { pc.close(); } catch {}
                pc = null;
                pcRef.current = null;
            }

            if (Hls.isSupported()) {
                const hls = new Hls({
                    lowLatencyMode: true,
                    liveSyncDuration: 0.5,
                    liveMaxLatencyDuration: 1.2,
                    maxLiveSyncPlaybackRate: 1.25,
                    enableWorker: true,
                    backBufferLength: 0,
                });
                hlsRef.current = hls;
                hlsInstance = hls;

                hls.loadSource(hlsUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (isMounted) {
                        video.play().catch(() => {});
                        setIsLive(true);
                        setStreamProtocol("LL-HLS");
                    }
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hls.recoverMediaError();
                                break;
                            default:
                                if (isMounted) {
                                    setIsLive(false);
                                    setStreamProtocol("");
                                }
                                break;
                        }
                    }
                });
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = hlsUrl;
                const onLoaded = () => {
                    if (isMounted) {
                        video.play().catch(() => {});
                        setIsLive(true);
                        setStreamProtocol("LL-HLS");
                    }
                };
                const onError = () => {
                    if (isMounted) {
                        setIsLive(false);
                        setStreamProtocol("");
                    }
                };
                video.addEventListener("loadedmetadata", onLoaded);
                video.addEventListener("error", onError);
            }
        };

        const startWhep = async () => {
            try {
                pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: "stun:stun.l.google.com:19302" },
                        { urls: "stun:global.stun.twilio.com:3478" }
                    ]
                });
                pcRef.current = pc;

                pc.addTransceiver("video", { direction: "recvonly" });

                pc.ontrack = (event) => {
                    if (!isMounted) return;
                    clearTimeout(whepTimeout);
                    video.srcObject = event.streams[0];
                    video.play().catch(() => {});
                    setIsLive(true);
                    setStreamProtocol("WEBRTC ~150MS");
                };

                pc.oniceconnectionstatechange = () => {
                    if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
                        startHls();
                    }
                };

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                const res = await fetch(whepUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/sdp" },
                    body: offer.sdp,
                });

                if (!res.ok) {
                    throw new Error(`WHEP status ${res.status}`);
                }

                const answerSdp = await res.text();
                if (!isMounted) return;
                await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

                // If no video arrives within 2.5s, fall back cleanly to Low-Latency HLS
                whepTimeout = setTimeout(() => {
                    if (!video.srcObject && isMounted) {
                        startHls();
                    }
                }, 2500);
            } catch {
                startHls();
            }
        };

        // Try ultra-low-latency WebRTC first, fallback to LL-HLS
        startWhep();

        return () => {
            isMounted = false;
            clearTimeout(whepTimeout);
            if (pc) {
                try { pc.close(); } catch {}
                pcRef.current = null;
            }
            if (hlsInstance) {
                hlsInstance.destroy();
                hlsRef.current = null;
            }
            if (video) {
                video.srcObject = null;
                video.src = "";
            }
        };
    }, [streamUrl]);

    // 2. Hardware FPS Meter (via requestVideoFrameCallback)
    useEffect(() => {
        if (!isLive || !videoRef.current) return;
        const video = videoRef.current;

        let frameCount = 0;
        let lastTime = performance.now();
        let callbackId;

        const onFrame = (now) => {
            frameCount++;
            if (now - lastTime >= 1000) {
                setFps(Math.round((frameCount * 1000) / (now - lastTime)));
                frameCount = 0;
                lastTime = now;
            }
            if (video.requestVideoFrameCallback) {
                callbackId = video.requestVideoFrameCallback(onFrame);
            }
        };

        if (video.requestVideoFrameCallback) {
            callbackId = video.requestVideoFrameCallback(onFrame);
        }

        return () => {
            if (callbackId && video.cancelVideoFrameCallback) {
                video.cancelVideoFrameCallback(callbackId);
            }
        };
    }, [isLive]);

    // 3. Multi-User Cursor WebSocket Connection to TouchDesigner
    const sessionIdRef = useRef("usr_" + Math.random().toString(36).substring(2, 7));

    useEffect(() => {
        let isMounted = true;
        let ws = null;
        let reconnectTimer = null;

        let wsUrl = "";
        if (isLocalhost) {
            wsUrl = "ws://localhost:9980";
        } else if (streamUrl) {
            try {
                if (streamUrl.startsWith("wss://") || streamUrl.startsWith("ws://")) {
                    wsUrl = streamUrl;
                } else if (streamUrl.startsWith("https://")) {
                    const u = new URL(streamUrl);
                    wsUrl = `wss://${u.host}/ws`;
                } else if (streamUrl.startsWith("http://")) {
                    const u = new URL(streamUrl);
                    wsUrl = `ws://${u.host}/ws`;
                }
            } catch {}
        }

        if (!wsUrl) return;

        const connectWs = () => {
            if (!isMounted) return;
            try {
                ws = new WebSocket(wsUrl);
                wsRef.current = ws;

                ws.onclose = () => {
                    if (isMounted) {
                        reconnectTimer = setTimeout(connectWs, 3000);
                    }
                };
            } catch {
                if (isMounted) {
                    reconnectTimer = setTimeout(connectWs, 3000);
                }
            }
        };

        connectWs();

        return () => {
            isMounted = false;
            if (ws) ws.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [streamUrl]);

    // Mouse & Touch Tracking Engine (Sends normalized UV coordinates to TouchDesigner)
    const lastMouseSendRef = useRef(0);
    const isMouseDownRef = useRef(false);

    const sendMouse = (clientX, clientY, isDown = isMouseDownRef.current) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const now = performance.now();
        if (now - lastMouseSendRef.current < 16) return; // 60 FPS throttle
        lastMouseSendRef.current = now;

        const targetEl = videoRef.current || canvasRef.current || containerRef.current;
        if (!targetEl) return;

        const rect = targetEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const rawU = (clientX - rect.left) / rect.width;
        const rawV = 1.0 - (clientY - rect.top) / rect.height;

        const inside = rawU >= 0 && rawU <= 1 && rawV >= 0 && rawV <= 1 ? 1 : 0;
        const u = Math.max(0, Math.min(1, rawU));
        const v = Math.max(0, Math.min(1, rawV));

        try {
            wsRef.current.send(JSON.stringify({
                type: "mouse",
                id: sessionIdRef.current,
                u: Number(u.toFixed(4)),
                v: Number(v.toFixed(4)),
                click: isDown ? 1 : 0,
                inside,
            }));
        } catch {}
    };

    const handleMouseMove = (e) => {
        // Detect top hover zone (top 70px)
        if (e.clientY < 70) {
            setIsHoverTop(true);
        } else {
            setIsHoverTop(false);
        }

        sendMouse(e.clientX, e.clientY);
    };

    const handleMouseDown = (e) => {
        isMouseDownRef.current = true;
        sendMouse(e.clientX, e.clientY, true);
    };

    const handleMouseUp = (e) => {
        isMouseDownRef.current = false;
        sendMouse(e.clientX, e.clientY, false);
    };

    const handleTouchMove = (e) => {
        if (!e.touches || !e.touches[0]) return;
        const t = e.touches[0];
        if (t.clientY < 70) {
            setIsHoverTop(true);
        } else {
            setIsHoverTop(false);
        }
        sendMouse(t.clientX, t.clientY, true);
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

    return (
        <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onTouchMove={handleTouchMove}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            onMouseLeave={() => {
                setIsHoverTop(false);
                isMouseDownRef.current = false;
            }}
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
                                    text={isLive ? `LIVE ${fps > 0 ? `// ${fps} FPS` : ""}${streamProtocol ? ` // ${streamProtocol}` : ""}` : "OFFLINE"}
                                    progress={wipeProgress}
                                    startIndex={45}
                                    totalLength={90}
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
                                totalLength={90}
                            />
                        </button>

                        <button
                            onClick={toggleFullscreen}
                            className="text-neutral-400 hover:bg-[#ff0080] hover:text-black px-1 uppercase cursor-pointer"
                        >
                            <AsciiWipeItem
                                text="[FULLSCREEN]"
                                progress={wipeProgress}
                                startIndex={78}
                                totalLength={90}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* 3. VISUAL DISPLAY: FULL VIEWPORT (COVER OR FIT) */}
            <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
                
                {/* Ultra-Low Latency Hardware Video Feed */}
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`select-none pointer-events-none transition-opacity duration-300 ${
                        isLive ? "opacity-100 block" : "opacity-0 hidden"
                    } ${
                        displayMode === "cover"
                            ? "w-full h-full object-cover"
                            : "w-full h-full object-contain max-w-[1280px] max-h-[1280px]"
                    }`}
                />

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
