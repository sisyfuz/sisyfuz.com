// src/tui/TuiLive.jsx
import { useState, useEffect, useRef, useMemo } from "react";
import Hls from "hls.js";
import { client } from "../sanityClient";
import { ASCII_DIVIDER, ASCII_RAMP } from "../utils/ascii";
import { useDisco } from "../context/DiscoContext";

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";
const DEFAULT_STREAM_URL = isLocalhost ? "http://localhost:9988" : "";

const GLITCH_CHARS = ["█", "▓", "▒", "░", "#", "+", "*", "~", "/", "\\", "%", "$", ">", "_"];

// Helper component to render text with cellular ASCII wipe animation
function AsciiWipeItem({ text, progress, startIndex = 0, totalLength = 110 }) {
    if (progress <= 0.005) return null;

    // Full reveal fallback: Guarantee all characters are 100% visible and resolved
    if (progress >= 0.95) {
        return (
            <span className="inline-block whitespace-pre font-mono">
                {text}
            </span>
        );
    }

    // Dynamic wave progression with 1.35x headroom so wave sweeps completely past the end
    const wavePos = progress * 1.35;

    return (
        <span className="inline-block whitespace-pre font-mono">
            {text.split("").map((char, idx) => {
                const i = startIndex + idx;
                const normX = i / Math.max(1, totalLength);
                const stagger = ((i * 17) % 7) * 0.015;
                const threshold = normX + stagger;
                const delta = wavePos - threshold;

                if (delta > 0.05) {
                    // Fully resolved crisp character
                    return <span key={idx}>{char}</span>;
                } else if (delta >= -0.04 && delta <= 0.05) {
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
    const { asciiLiveMode, setAsciiLiveMode, discoMode } = useDisco();
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
    const [viewerCount, setViewerCount] = useState(1);
    const [isMuted, setIsMuted] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("sisyfuz_live_muted");
            return saved !== "false"; // default muted true
        }
        return true;
    });
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
    const progressRef = useRef(0);
    const isVisibleRef = useRef(typeof document !== "undefined" ? !document.hidden : true);
    const touchTimeoutRef = useRef(null);

    const handleMobileToggle = (e) => {
        if (e) e.stopPropagation();
        setIsHoverTop(prev => {
            const next = !prev;
            if (next) {
                if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
                touchTimeoutRef.current = setTimeout(() => {
                    setIsHoverTop(false);
                }, 7000);
            }
            return next;
        });
    };

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
        return () => {
            cancelAnimationFrame(frameId);
            if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
        };
    }, [isHoverTop]);

    // Check Worker & Sanity for live stream URL (poll every 4s)
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
        const poll = setInterval(checkLiveStatus, 4000);
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

    // Page Visibility API Optimization (Throttle background tabs to save battery & CPU)
    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = !document.hidden;
            isVisibleRef.current = visible;
            const video = videoRef.current;
            if (video) {
                if (!visible) {
                    video.pause();
                } else if (isLive) {
                    video.play().catch(() => {});
                }
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [isLive]);

    // Audio Mute / Unmute Toggle
    const toggleAudio = () => {
        setIsMuted(prev => {
            const next = !prev;
            if (videoRef.current) {
                videoRef.current.muted = next;
                if (!next) {
                    videoRef.current.volume = 1.0;
                    videoRef.current.play().catch(() => {});
                }
            }
            if (typeof localStorage !== "undefined") {
                localStorage.setItem("sisyfuz_live_muted", String(next));
            }
            setModeToast(next ? "AUDIO: MUTED" : "AUDIO: ACTIVE");
            return next;
        });
    };

    const toggleFullscreen = () => {
        const el = containerRef.current;
        const video = videoRef.current;
        if (!el) return;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (el.requestFullscreen) {
                el.requestFullscreen().catch(err => console.warn(err));
            } else if (video?.webkitEnterFullscreen) {
                video.webkitEnterFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    };

    // Keyboard Shortcuts: Tab (Cover/Fit), M (Audio), A (ASCII), F (Fullscreen), Esc (Home)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                setDisplayMode(prev => {
                    const next = prev === "cover" ? "fit" : "cover";
                    setModeToast(next === "cover" ? "MODE: COVER (100% FILL)" : "MODE: FIT (1:1 BEST FIT)");
                    return next;
                });
            } else if (e.key === "m" || e.key === "M") {
                e.preventDefault();
                toggleAudio();
            } else if (e.key === "a" || e.key === "A") {
                e.preventDefault();
                setAsciiLiveMode(prev => {
                    const next = !prev;
                    setModeToast(next ? "ASCII STREAM: ACTIVE" : "VIDEO STREAM: ACTIVE");
                    return next;
                });
            } else if (e.key === "f" || e.key === "F") {
                e.preventDefault();
                toggleFullscreen();
            } else if (e.key === "Escape") {
                if (onNavigate) {
                    onNavigate("home");
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onNavigate, setAsciiLiveMode]);

    // Toast auto-hide
    useEffect(() => {
        if (!modeToast) return;
        const timer = setTimeout(() => setModeToast(""), 1600);
        return () => clearTimeout(timer);
    }, [modeToast]);

    // 1. Direct Low-Latency Hardware HLS Video Engine (60 FPS)
    useEffect(() => {
        let isMounted = true;
        const isHttp = streamUrl && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"));

        if (!isHttp) {
            setIsLive(false);
            return;
        }

        const video = videoRef.current;
        if (!video) return;

        // Apply saved mute state
        video.muted = isMuted;

        const cleanUrl = streamUrl.replace(/\/+$/, "");
        const hlsUrl = cleanUrl.includes(".m3u8")
            ? cleanUrl
            : `${cleanUrl}/live/index.m3u8`;

        let hlsInstance = null;

        if (Hls.isSupported()) {
            const hls = new Hls({
                lowLatencyMode: false,
                liveSyncDuration: 1.2,
                liveMaxLatencyDuration: 2.5,
                maxLiveSyncPlaybackRate: 1.05,
                enableWorker: true,
                backBufferLength: 2,
                maxBufferLength: 4,
                maxMaxBufferLength: 8,
            });
            hlsRef.current = hls;
            hlsInstance = hls;

            hls.loadSource(hlsUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (isMounted) {
                    video.play().catch(() => {});
                    setIsLive(true);
                }
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            setTimeout(() => {
                                if (isMounted && hls) hls.startLoad();
                            }, 1500);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hls.recoverMediaError();
                            break;
                        default:
                            break;
                    }
                }
            });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari Native HLS
            video.src = hlsUrl;
            const onLoaded = () => {
                if (isMounted) {
                    video.play().catch(() => {});
                    setIsLive(true);
                }
            };
            video.addEventListener("loadedmetadata", onLoaded);
        }

        return () => {
            isMounted = false;
            if (hlsInstance) {
                hlsInstance.destroy();
                hlsRef.current = null;
            }
            if (video) {
                video.pause();
                video.removeAttribute("src");
                video.load();
            }
        };
    }, [streamUrl, isMuted]);

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

    // 2.5 Real-Time 60 FPS Full-Page ASCII Stream Engine
    useEffect(() => {
        if (!isLive || !asciiLiveMode) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const offscreen = document.createElement("canvas");
        const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
        if (!offCtx) return;

        let animId;
        let callbackId;

        const renderAscii = () => {
            if (!isVisibleRef.current) {
                scheduleNext();
                return;
            }

            if (!video || video.paused || video.ended || video.readyState < 2) {
                scheduleNext();
                return;
            }

            const width = window.innerWidth;
            const height = window.innerHeight;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }

            const isMobile = width < 640;
            const cellW = isMobile ? 6 : 8;
            const cellH = Math.round(cellW / 0.55);
            const cols = Math.floor(width / cellW);
            const rows = Math.floor(height / cellH);

            if (cols <= 0 || rows <= 0) {
                scheduleNext();
                return;
            }

            if (offscreen.width !== cols || offscreen.height !== rows) {
                offscreen.width = cols;
                offscreen.height = rows;
            }

            const vW = video.videoWidth || 1920;
            const vH = video.videoHeight || 1080;
            const vAspect = vW / vH;
            const targetAspect = width / height;

            let sX = 0, sY = 0, sW = vW, sH = vH;
            if (displayMode === "cover") {
                if (vAspect > targetAspect) {
                    sW = vH * targetAspect;
                    sX = (vW - sW) / 2;
                } else {
                    sH = vW / targetAspect;
                    sY = (vH - sH) / 2;
                }
                offCtx.drawImage(video, sX, sY, sW, sH, 0, 0, cols, rows);
            } else {
                offCtx.fillStyle = "#000000";
                offCtx.fillRect(0, 0, cols, rows);
                let dX = 0, dY = 0, dW = cols, dH = rows;
                if (vAspect > targetAspect) {
                    dH = cols / vAspect;
                    dY = (rows - dH) / 2;
                } else {
                    dW = rows * vAspect;
                    dX = (cols - dW) / 2;
                }
                offCtx.drawImage(video, 0, 0, vW, vH, Math.round(dX), Math.round(dY), Math.round(dW), Math.round(dH));
            }

            const imgData = offCtx.getImageData(0, 0, cols, rows);
            const data = imgData.data;

            ctx.fillStyle = "#050505";
            ctx.fillRect(0, 0, width, height);

            ctx.font = `${cellH - 1}px monospace`;
            ctx.textBaseline = "top";

            const ramp = ASCII_RAMP;
            const rampLen = ramp.length;
            const now = performance.now();

            for (let y = 0; y < rows; y++) {
                const yPos = y * cellH;
                const rowOffset = y * cols * 4;
                for (let x = 0; x < cols; x++) {
                    const idx = rowOffset + x * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];

                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    if (lum < 16) continue;

                    const charIdx = Math.min(rampLen - 1, Math.floor((1 - lum / 255) * rampLen));
                    const char = ramp[charIdx];
                    if (!char || char === " ") continue;

                    if (discoMode) {
                        const hue = (x * 4 + y * 6 + now * 0.1) % 360;
                        ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
                    } else {
                        ctx.fillStyle = `rgb(${r},${g},${b})`;
                    }

                    ctx.fillText(char, x * cellW, yPos);
                }
            }

            scheduleNext();
        };

        const scheduleNext = () => {
            if (video.requestVideoFrameCallback) {
                callbackId = video.requestVideoFrameCallback(renderAscii);
            } else {
                animId = requestAnimationFrame(renderAscii);
            }
        };

        scheduleNext();

        return () => {
            if (callbackId && video.cancelVideoFrameCallback) {
                video.cancelVideoFrameCallback(callbackId);
            }
            if (animId) {
                cancelAnimationFrame(animId);
            }
        };
    }, [isLive, asciiLiveMode, displayMode, discoMode]);

    // 3. Multi-User Telemetry WebSocket Connection to TouchDesigner
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

                // Receive real-time server stats from TouchDesigner
                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === "stats") {
                            if (typeof msg.viewers === "number") {
                                setViewerCount(Math.max(1, msg.viewers));
                            }
                        }
                    } catch {}
                };

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

    // 4. Creative Kinetic & Environmental Telemetry Engine (Streams to TouchDesigner at 60 FPS)
    const lastMouseSendRef = useRef(0);
    const isMouseDownRef = useRef(false);
    const isTouchRef = useRef(false);
    const prevCoordRef = useRef({ u: 0.5, v: 0.5, time: performance.now() });
    const clickStartRef = useRef(0);
    const totalClicksRef = useRef(0);

    const sendTelemetry = (clientX, clientY, isDown = isMouseDownRef.current) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const now = performance.now();
        // If tab is in background, throttle to 500ms
        const throttleMs = isVisibleRef.current ? 16 : 500;
        if (now - lastMouseSendRef.current < throttleMs) return;
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

        // Kinetic Velocity Calculation
        const dt = Math.max(0.001, (now - prevCoordRef.current.time) / 1000);
        const du = u - prevCoordRef.current.u;
        const dv = v - prevCoordRef.current.v;
        const vx = Number((du / dt).toFixed(3));
        const vy = Number((dv / dt).toFixed(3));
        const speed = Number(Math.hypot(vx, vy).toFixed(3));

        prevCoordRef.current = { u, v, time: now };

        // Click Duration
        let clickDur = 0;
        if (isDown) {
            if (!clickStartRef.current) clickStartRef.current = now;
            clickDur = Number(((now - clickStartRef.current) / 1000).toFixed(2));
        } else {
            clickStartRef.current = 0;
        }

        // Environmental: Local Time of Day (e.g. 15.35 = 3:21 PM) & Timezone
        const d = new Date();
        const localHour = Number((d.getHours() + d.getMinutes() / 60).toFixed(2));
        const tzOffset = -Number((d.getTimezoneOffset() / 60).toFixed(1));

        const packet = {
            type: "mouse",
            id: sessionIdRef.current,
            u: Number(u.toFixed(4)),
            v: Number(v.toFixed(4)),
            vx,
            vy,
            speed,
            click: isDown ? 1 : 0,
            click_dur: clickDur,
            clicks: totalClicksRef.current,
            inside,
            is_touch: isTouchRef.current ? 1 : 0,
            aspect: Number((window.innerWidth / Math.max(1, window.innerHeight)).toFixed(2)),
            hour: localHour,
            tz: tzOffset,
            dark: window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0,
            audio: isMuted ? 0 : 1,
            visible: isVisibleRef.current ? 1 : 0,
            fps: fps || 60,
            mode: displayMode,
        };

        try {
            wsRef.current.send(JSON.stringify(packet));
        } catch {}
    };

    const handleMouseMove = (e) => {
        isTouchRef.current = false;
        if (e.clientY < 70) {
            setIsHoverTop(true);
        } else {
            setIsHoverTop(false);
        }
        sendTelemetry(e.clientX, e.clientY);
    };

    const handleMouseDown = (e) => {
        isMouseDownRef.current = true;
        totalClicksRef.current++;
        clickStartRef.current = performance.now();
        sendTelemetry(e.clientX, e.clientY, true);
    };

    const handleMouseUp = (e) => {
        isMouseDownRef.current = false;
        sendTelemetry(e.clientX, e.clientY, false);
    };

    const handleTouchMove = (e) => {
        if (!e.touches || !e.touches[0]) return;
        isTouchRef.current = true;
        const t = e.touches[0];
        if (t.clientY < 70) {
            setIsHoverTop(true);
        } else {
            setIsHoverTop(false);
        }
        sendTelemetry(t.clientX, t.clientY, true);
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
            {/* 1. TOP HOVER / TOUCH TRIGGER ZONE (Top 65px) */}
            <div
                onMouseEnter={() => setIsHoverTop(true)}
                onTouchStart={handleMobileToggle}
                className="fixed top-0 left-0 w-full h-16 z-50 pointer-events-auto"
            />

            {/* Mobile quick-reveal pill when menu is hidden */}
            <button
                type="button"
                onClick={handleMobileToggle}
                className="sm:hidden fixed top-2 left-1/2 -translate-x-1/2 z-40 bg-black/95 text-neutral-300 px-3 py-1 text-[10px] uppercase font-mono tracking-wider cursor-pointer shadow-lg"
                style={{
                    opacity: wipeProgress < 0.2 ? 0.85 : 0,
                    pointerEvents: wipeProgress < 0.2 ? "auto" : "none",
                    transition: "opacity 200ms ease"
                }}
            >
                [MENU // STATS]
            </button>

            {/* 2. TOP OPTIONS BAR REVEAL (CELLULAR ASCII WIPE ANIMATION) */}
            <div
                style={{
                    opacity: wipeProgress > 0.01 ? 1 : 0,
                    pointerEvents: wipeProgress > 0.5 ? "auto" : "none",
                }}
                className="fixed top-0 left-0 w-full z-50 transition-opacity duration-150 bg-black/95 backdrop-blur-md px-4 sm:px-12 pt-2.5 sm:pt-3 pb-1"
            >
                <div className="flex flex-wrap items-center justify-between gap-3 uppercase">
                    
                    {/* Left: Site Navigation */}
                    <div className="flex flex-wrap items-center gap-3 sm:gap-6">
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
                                        startIndex={idx * 8}
                                        totalLength={110}
                                    />
                                </button>
                            );
                        })}
                    </div>

                    {/* Right: Live Telemetry, Audio, Mode, Fullscreen */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs">
                        
                        {/* Telemetry: LIVE // 60 FPS // N VIEWERS */}
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full inline-block ${
                                isLive ? "bg-[#ff0080] animate-pulse" : "bg-neutral-600"
                            }`} />
                            <span className={isLive ? "text-white font-bold" : "text-neutral-500"}>
                                <AsciiWipeItem
                                    text={
                                        isLive
                                            ? `LIVE ${fps > 0 ? `// ${fps} FPS` : ""} // ${viewerCount} ${viewerCount === 1 ? "VIEWER" : "VIEWERS"}`
                                            : "OFFLINE"
                                    }
                                    progress={wipeProgress}
                                    startIndex={48}
                                    totalLength={110}
                                />
                            </span>
                        </div>

                        {/* ASCII Stream Toggle: [A: ASCII] / [A: VIDEO] */}
                        {isLive && (
                            <button
                                onClick={() => {
                                    setAsciiLiveMode(prev => {
                                        const next = !prev;
                                        setModeToast(next ? "ASCII STREAM: ACTIVE" : "VIDEO STREAM: ACTIVE");
                                        return next;
                                    });
                                }}
                                className={`px-1 uppercase cursor-pointer transition-colors ${
                                    asciiLiveMode
                                        ? "text-[#ff0080] font-bold hover:bg-[#ff0080] hover:text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                title="Press A to toggle ASCII mode"
                            >
                                <AsciiWipeItem
                                    text={asciiLiveMode ? "[A: ASCII]" : "[A: VIDEO]"}
                                    progress={wipeProgress}
                                    startIndex={62}
                                    totalLength={110}
                                />
                            </button>
                        )}

                        {/* Audio Toggle: [M: MUTED] / [M: AUDIO ON] */}
                        {isLive && (
                            <button
                                onClick={toggleAudio}
                                className={`px-1 uppercase cursor-pointer transition-colors ${
                                    !isMuted
                                        ? "text-[#ff0080] font-bold hover:bg-[#ff0080] hover:text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                title="Press M to toggle audio"
                            >
                                <AsciiWipeItem
                                    text={isMuted ? "[M: MUTED]" : "[M: AUDIO ON]"}
                                    progress={wipeProgress}
                                    startIndex={74}
                                    totalLength={110}
                                />
                            </button>
                        )}

                        {/* Tab Mode: [TAB: COVER] / [TAB: FIT] */}
                        <button
                            onClick={() => setDisplayMode(prev => prev === "cover" ? "fit" : "cover")}
                            className="text-neutral-300 hover:bg-white hover:text-black px-1 uppercase cursor-pointer"
                            title="Press Tab to toggle anytime"
                        >
                            <AsciiWipeItem
                                text={`[TAB: ${displayMode.toUpperCase()}]`}
                                progress={wipeProgress}
                                startIndex={86}
                                totalLength={110}
                            />
                        </button>

                        {/* Fullscreen Toggle */}
                        <button
                            onClick={toggleFullscreen}
                            className="text-neutral-400 hover:bg-[#ff0080] hover:text-black px-1 uppercase cursor-pointer"
                            title="Press F to toggle fullscreen"
                        >
                            <AsciiWipeItem
                                text="[F: FULLSCREEN]"
                                progress={wipeProgress}
                                startIndex={98}
                                totalLength={110}
                            />
                        </button>
                    </div>
                </div>

                {/* Raw ASCII character divider replacing modern CSS border */}
                <div className="text-neutral-700 select-none overflow-hidden whitespace-nowrap leading-none pt-2 font-mono text-[11px]">
                    <AsciiWipeItem
                        text={ASCII_DIVIDER}
                        progress={wipeProgress}
                        startIndex={0}
                        totalLength={110}
                    />
                </div>
            </div>

            {/* 3. VISUAL DISPLAY: FULL VIEWPORT (COVER OR FIT) */}
            <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
                
                {/* Ultra-Low Latency Hardware Video Feed */}
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isMuted}
                    onPlaying={() => setIsLive(true)}
                    className={`select-none pointer-events-none transition-opacity duration-300 ${
                        isLive && !asciiLiveMode ? "opacity-100 block" : "opacity-0 pointer-events-none absolute"
                    } ${
                        displayMode === "cover"
                            ? "w-full h-full object-cover"
                            : "w-full h-full object-contain max-w-[1280px] max-h-[1280px]"
                    }`}
                />

                {/* Full-Page Real-time 60 FPS ASCII Stream Canvas */}
                <canvas
                    ref={canvasRef}
                    className={`select-none pointer-events-none transition-opacity duration-300 absolute inset-0 w-full h-full ${
                        isLive && asciiLiveMode ? "opacity-100 block" : "opacity-0 pointer-events-none hidden"
                    }`}
                />

                {/* STANDBY: PURE PROCEDURAL ASCII OSCILLOSCOPE */}
                {!isLive && (
                    <div className="flex flex-col items-center justify-center p-4 sm:p-6 text-center space-y-4 sm:space-y-6 select-none animate-fadeIn max-w-full overflow-hidden">
                        <pre className="text-[9px] xs:text-[10px] sm:text-xs leading-none text-neutral-400 font-mono overflow-x-auto no-scrollbar">
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
                    <div className="bg-black/95 text-[#ff0080] font-bold px-4 py-2 uppercase tracking-widest text-xs animate-fadeIn shadow-2xl font-mono">
                        [ {modeToast} ]
                    </div>
                </div>
            )}
        </div>
    );
}

function renderOscilloscope(frame) {
    const width = 42;
    const lines = [];

    lines.push("+------------------------------------------+");
    for (let y = 0; y < 11; y++) {
        let row = "|";
        for (let x = 0; x < width; x++) {
            const wave1 = Math.sin((x + frame * 2) * 0.18) * 3.8 + 5;
            const wave2 = Math.cos((x - frame * 1.6) * 0.14) * 2.5 + 5;
            const isWave = Math.round(wave1) === y || Math.round(wave2) === y;
            const isCenter = y === 5 && x > 11 && x < 31;

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
    lines.push("+------------------------------------------+");

    return lines.join("\n");
}
