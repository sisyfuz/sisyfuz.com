import { useState, useEffect, useRef, useMemo } from "react";
import { client } from "../sanityClient";
import { ASCII_DIVIDER, ASCII_RAMP } from "../utils/ascii";
import { useDisco } from "../context/DiscoContext";
import { useA11y } from "../context/A11yContext";
import { sanitizeUrlParam, sanitizeChat, sanitizeStreamUrl } from "../utils/sanitize";

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";
const DEFAULT_STREAM_URL = isLocalhost ? "http://localhost:9988" : "";

const GLITCH_CHARS = ["█", "▓", "▒", "░", "#", "+", "*", "~", "/", "\\", "%", "$", ">", "_"];

const RAMP_LOOKUP = new Array(256);
for (let l = 0; l < 256; l++) {
    if (l < 16) {
        RAMP_LOOKUP[l] = " ";
    } else {
        const charIdx = Math.min(ASCII_RAMP.length - 1, Math.floor((1 - l / 255) * ASCII_RAMP.length));
        RAMP_LOOKUP[l] = ASCII_RAMP[charIdx] || " ";
    }
}

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
    const len = text.length;
    const items = [];
    const glitchOffset = Math.floor(progress * 25);
    const denom = Math.max(1, totalLength);

    for (let idx = 0; idx < len; idx++) {
        const i = startIndex + idx;
        const normX = i / denom;
        const stagger = ((i * 17) % 7) * 0.015;
        const threshold = normX + stagger;
        const delta = wavePos - threshold;

        if (delta > 0.05) {
            // Fully resolved crisp character
            items.push(<span key={idx}>{text[idx]}</span>);
        } else if (delta >= -0.04 && delta <= 0.05) {
            // Active wave front: Hot-pink glitch
            const g = GLITCH_CHARS[(i + glitchOffset) % GLITCH_CHARS.length];
            items.push(
                <span key={idx} className="text-[#ff0080] font-bold">
                    {g}
                </span>
            );
        } else {
            // Pre-wave: dim trailing ASCII glyph
            const dimChar = ((i + idx) % 2 === 0) ? "·" : " ";
            items.push(
                <span key={idx} className="text-neutral-700 select-none">
                    {dimChar}
                </span>
            );
        }
    }

    return (
        <span className="inline-block whitespace-pre font-mono">
            {items}
        </span>
    );
}

export default function TuiLive({ onNavigate }) {
    const { asciiLiveMode, setAsciiLiveMode, discoMode } = useDisco();
    const { lowPowerMode, reducedMotion } = useA11y();
    const scheduleNextAsciiRef = useRef(null);
    const checkLiveStatusRef = useRef(null);

    const [streamUrl, setStreamUrl] = useState(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const queryUrl = params.get("stream") || params.get("s");
            if (queryUrl) return sanitizeStreamUrl(queryUrl) || DEFAULT_STREAM_URL;
            const saved = localStorage.getItem("sisyfuz_td_url");
            if (saved && isLocalhost) return sanitizeStreamUrl(saved) || DEFAULT_STREAM_URL;
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
    const [transport, setTransport] = useState(""); // "WEBRTC" | "HLS" | ""
    const [showMode, setShowMode] = useState("AUTO");

    // Live Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [unreadChatCount, setUnreadChatCount] = useState(0);
    const [chatInputText, setChatInputText] = useState("");
    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [chatUsername, setChatUsername] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("sisyfuz_chat_user");
            if (saved) return saved;
            const rand = `guest_${Math.random().toString(36).slice(2, 6)}`;
            localStorage.setItem("sisyfuz_chat_user", rand);
            return rand;
        }
        return "guest";
    });
    const chatScrollRef = useRef(null);
    const isChatOpenRef = useRef(isChatOpen);

    useEffect(() => {
        isChatOpenRef.current = isChatOpen;
        if (isChatOpen) {
            setUnreadChatCount(0);
            setTimeout(() => {
                if (chatScrollRef.current) {
                    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
                }
            }, 50);
        }
    }, [isChatOpen]);

    // Auto-scroll chat on new messages
    useEffect(() => {
        if (isChatOpen && chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages, isChatOpen]);

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
    const isVisibleRef = useRef(typeof document !== "undefined" ? !document.hidden : true);
    const touchTimeoutRef = useRef(null);
    const displayModeRef = useRef(displayMode);
    const isMutedRef = useRef(isMuted);
    const fpsRef = useRef(fps);
    const lastKnownAspectRef = useRef(1.0);

    useEffect(() => {
        displayModeRef.current = displayMode;
    }, [displayMode]);

    useEffect(() => {
        isMutedRef.current = isMuted;
        if (videoRef.current) {
            videoRef.current.muted = isMuted;
        }
    }, [isMuted]);

    useEffect(() => {
        fpsRef.current = fps;
    }, [fps]);

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

    // Check Worker & Sanity for live stream URL (poll every 4s with debounce)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("stream") || params.get("s")) return;

        let consecutiveFails = 0;

        const checkLiveStatus = async () => {
            try {
                const res = await fetch(WORKER_LIVE_URL);
                if (res.ok) {
                    const data = await res.json();
                    if (data.active && data.url) {
                        consecutiveFails = 0;
                        setStreamUrl((prev) => (prev === data.url ? prev : data.url));
                        return;
                    }
                }
            } catch {}

            // Try Sanity fallback
            try {
                if (typeof document !== "undefined" && document.hidden) return;
                const doc = await client.fetch(`*[_id == "site-live-stream"][0]`);
                if (doc?.active && doc?.url) {
                    consecutiveFails = 0;
                    setStreamUrl((prev) => (prev === doc.url ? prev : doc.url));
                    return;
                }
            } catch {}

            // Require 3 consecutive failed checks (12s) before declaring offline
            consecutiveFails++;
            if (consecutiveFails >= 3 && !isLocalhost) {
                setStreamUrl("");
                setIsLive(false);
            }
        };

        checkLiveStatusRef.current = checkLiveStatus;
        checkLiveStatus();
        const poll = setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) return;
            checkLiveStatus();
        }, 4000);
        return () => {
            checkLiveStatusRef.current = null;
            clearInterval(poll);
        };
    }, []);

    // Procedural ASCII oscilloscope for standby state (halt on background or reduced motion)
    useEffect(() => {
        if (isLive || reducedMotion) return;
        const interval = setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) return;
            setAnimFrame(prev => (prev + 1) % 100);
        }, 120);
        return () => clearInterval(interval);
    }, [isLive, reducedMotion]);

    // Page Visibility API Optimization (Re-sync playback and live status on tab return)
    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = !document.hidden;
            isVisibleRef.current = visible;
            const video = videoRef.current;
            if (video && visible && isLive && video.paused) {
                video.play().catch(() => {});
            }
            if (visible && isLive && asciiLiveMode) {
                scheduleNextAsciiRef.current?.();
            }
            if (visible) {
                checkLiveStatusRef.current?.();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [isLive, asciiLiveMode]);

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

    // Keyboard Shortcuts: Tab (Cover/Fit), M (Audio), A (ASCII), F (Fullscreen), C (Chat), Esc (Home/Close Chat)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Never hijack typing inside input or textarea
            if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
                if (e.key === "Escape") {
                    e.target.blur();
                }
                return;
            }

            if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                setIsChatOpen(prev => !prev);
            } else if (e.key === "Tab") {
                e.preventDefault();
                setDisplayMode(prev => {
                    const next = prev === "cover" ? "fit" : "cover";
                    displayModeRef.current = next;
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
                if (isChatOpenRef.current) {
                    setIsChatOpen(false);
                    return;
                }
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

    // 1. WebRTC-First Ultra-Low Latency Video Engine with HLS Fallback (60 FPS)
    useEffect(() => {
        let isMounted = true;
        const isHttp = streamUrl && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"));

        if (!isHttp) {
            setIsLive(false);
            return;
        }

        const video = videoRef.current;
        if (!video) return;

        const cleanUrl = streamUrl.replace(/\/+$/, "");
        let hlsInstance = null;

        // Autoplay guarantee: attempt playback respecting user mute state; fallback to muted if blocked
        const playVideoSafe = async () => {
            if (!video || !isMounted) return;
            try {
                video.muted = isMutedRef.current;
                await video.play();
            } catch (err) {
                console.warn("[TuiLive] Play failed, falling back to muted autoplay:", err);
                video.muted = true;
                try {
                    await video.play();
                } catch (e2) {
                    console.warn("[TuiLive] Autoplay blocked, waiting for interaction:", e2);
                    const resumeOnGesture = () => {
                        if (video) video.play().catch(() => {});
                        window.removeEventListener("pointerdown", resumeOnGesture);
                        window.removeEventListener("keydown", resumeOnGesture);
                    };
                    window.addEventListener("pointerdown", resumeOnGesture, { once: true });
                    window.addEventListener("keydown", resumeOnGesture, { once: true });
                }
            }
        };

        // --- HLS fallback: exact same code path as before, with clean buffer reset ---
        const startHLS = async () => {
            if (!isMounted) return;

            // Clean up any remaining WebRTC state
            if (pcRef.current) {
                try {
                    pcRef.current.getSenders?.().forEach(s => s.track && s.track.stop());
                    pcRef.current.getReceivers?.().forEach(r => r.track && r.track.stop());
                    pcRef.current.close();
                } catch {}
                pcRef.current = null;
            }

            // Cleanly detach WebRTC MediaStream before attaching HLS
            if (video.srcObject) {
                try {
                    const stream = video.srcObject;
                    if (stream && stream.getTracks) {
                        stream.getTracks().forEach((track) => track.stop());
                    }
                } catch {}
                video.srcObject = null;
            }
            video.removeAttribute("src");
            video.load();

            const hlsUrl = cleanUrl.includes(".m3u8")
                ? cleanUrl
                : `${cleanUrl}/live/index.m3u8`;

            if (video.canPlayType("application/vnd.apple.mpegurl")) {
                // Safari Native HLS
                video.src = hlsUrl;
                const onLoaded = () => {
                    if (isMounted) {
                        playVideoSafe();
                        setIsLive(true);
                        setTransport("HLS");
                    }
                };
                video.addEventListener("loadedmetadata", onLoaded, { once: true });
                return;
            }

            try {
                const { default: Hls } = await import("hls.js/dist/hls.light.min.mjs");
                if (!isMounted) return;

                if (Hls.isSupported()) {
                    const hls = new Hls({
                        lowLatencyMode: true,
                        liveSyncDurationCount: 3,
                        liveMaxLatencyDurationCount: 6,
                        maxLiveSyncPlaybackRate: 1.02,
                        backBufferLength: 0,
                        enableWorker: true,
                        maxBufferLength: 4,
                        maxMaxBufferLength: 8,
                        highBufferWatchdogPeriod: 2,
                        nudgeOffset: 0.1,
                        nudgeMaxRetry: 5,
                        manifestLoadingMaxRetry: 8,
                        fragLoadingMaxRetry: 6,
                        levelLoadingMaxRetry: 6,
                    });
                    hlsRef.current = hls;
                    hlsInstance = hls;

                    hls.loadSource(hlsUrl);
                    hls.attachMedia(video);

                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (isMounted) {
                            playVideoSafe();
                            setIsLive(true);
                            setTransport("HLS");
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
                }
            } catch (err) {
                console.warn("[HLS] Failed to load hls.js dynamically:", err);
            }
        };

        // --- WebRTC WHEP connection ---
        const connectWebRTC = async () => {
            if (!isMounted) return;

            // Check RTCPeerConnection support
            if (typeof RTCPeerConnection === "undefined") {
                startHLS();
                return;
            }

            try {
                // Fetch ICE server config (falls back to STUN-only on error)
                let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
                try {
                    const turnRes = await fetch(`${cleanUrl}/turn-config`);
                    if (turnRes.ok) {
                        const turnData = await turnRes.json();
                        if (turnData.iceServers) iceServers = turnData.iceServers;
                    }
                } catch {}

                if (!isMounted) return;

                const pc = new RTCPeerConnection({ iceServers });
                pcRef.current = pc;

                // Add recvonly transceivers for video and audio
                pc.addTransceiver("video", { direction: "recvonly" });
                pc.addTransceiver("audio", { direction: "recvonly" });

                // On remote track: attach to video element
                pc.ontrack = (event) => {
                    if (event.streams && event.streams[0]) {
                        video.srcObject = event.streams[0];
                    } else {
                        const stream = video.srcObject || new MediaStream();
                        stream.addTrack(event.track);
                        video.srcObject = stream;
                    }
                };

                // Create SDP offer
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                // Wait for ICE candidate gathering (host + STUN + TURN) before POSTing offer
                await new Promise((resolve) => {
                    if (pc.iceGatheringState === "complete") return resolve();
                    let gatherTimeout;
                    const cleanup = () => {
                        clearTimeout(gatherTimeout);
                        pc.removeEventListener("icecandidate", onCandidate);
                        pc.removeEventListener("icegatheringstatechange", onGatheringChange);
                        resolve();
                    };
                    const onCandidate = (e) => {
                        if (!e.candidate) cleanup(); // null candidate indicates gathering complete
                    };
                    const onGatheringChange = () => {
                        if (pc.iceGatheringState === "complete") cleanup();
                    };
                    pc.addEventListener("icecandidate", onCandidate);
                    pc.addEventListener("icegatheringstatechange", onGatheringChange);
                    gatherTimeout = setTimeout(cleanup, 1200); // 1.2s ceiling
                });

                if (!isMounted) {
                    pc.close();
                    return;
                }

                // 6-second timeout for WHEP signaling
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 6000);

                const whepRes = await fetch(`${cleanUrl}/live/whep`, {
                    method: "POST",
                    headers: { "Content-Type": "application/sdp" },
                    body: pc.localDescription.sdp,
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!whepRes.ok) throw new Error(`WHEP ${whepRes.status}`);

                const answerSdp = await whepRes.text();
                await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));

                // Parse ICE candidates from Link headers if present
                const linkHeader = whepRes.headers.get("Link");
                if (linkHeader) {
                    const candidateMatches = linkHeader.matchAll(/<([^>]+)>;\s*rel="ice-candidate"/g);
                    for (const m of candidateMatches) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate({ candidate: m[1], sdpMid: "0" }));
                        } catch {}
                    }
                }

                // Wait for connection with 3.5-second timeout (falls back to LL-HLS to preserve TURN quota)
                await new Promise((resolve, reject) => {
                    const connTimeout = setTimeout(() => reject(new Error("WebRTC connection timeout (falling back to HLS)")), 3500);

                    const onStateChange = () => {
                        const state = pc.connectionState;
                        if (state === "connected") {
                            clearTimeout(connTimeout);
                            pc.removeEventListener("connectionstatechange", onStateChange);
                            resolve();
                        } else if (state === "failed" || state === "closed") {
                            clearTimeout(connTimeout);
                            pc.removeEventListener("connectionstatechange", onStateChange);
                            reject(new Error(`WebRTC ${state}`));
                        }
                    };

                    // If already connected (fast path)
                    if (pc.connectionState === "connected") {
                        clearTimeout(connTimeout);
                        resolve();
                        return;
                    }

                    pc.addEventListener("connectionstatechange", onStateChange);
                });

                if (!isMounted) {
                    pc.close();
                    return;
                }

                await playVideoSafe();
                setIsLive(true);
                setTransport("WEBRTC");

                // Monitor ongoing connection health — fallback to HLS on runtime failure
                pc.addEventListener("connectionstatechange", () => {
                    const state = pc.connectionState;
                    if (state === "failed" || state === "disconnected") {
                        console.warn(`[WebRTC] Connection ${state}, falling back to HLS`);
                        try {
                            pc.close();
                        } catch {}
                        pcRef.current = null;
                        if (isMounted) {
                            startHLS();
                        }
                    }
                });
            } catch (err) {
                console.warn("[WebRTC] Handshake failed, falling back to HLS:", err);
                if (pcRef.current) {
                    try {
                        pcRef.current.close();
                    } catch {}
                    pcRef.current = null;
                }
                if (isMounted) {
                    startHLS();
                }
            }
        };

        connectWebRTC();

        return () => {
            isMounted = false;
            if (pcRef.current) {
                try {
                    pcRef.current.getSenders?.().forEach(s => s.track && s.track.stop());
                    pcRef.current.getReceivers?.().forEach(r => r.track && r.track.stop());
                    pcRef.current.close();
                } catch {}
                pcRef.current = null;
            }
            if (hlsInstance) {
                try {
                    hlsInstance.destroy();
                } catch {}
                hlsRef.current = null;
            }
            if (video) {
                video.pause();
                if (video.srcObject) {
                    try {
                        const stream = video.srcObject;
                        if (stream && stream.getTracks) {
                            stream.getTracks().forEach((track) => track.stop());
                        }
                    } catch {}
                    video.srcObject = null;
                }
                video.removeAttribute("src");
                video.load();
            }
            setTransport("");
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

    // 2.5 Real-Time 60 FPS Full-Page ASCII Stream Engine
    useEffect(() => {
        if (!isLive || !asciiLiveMode) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const offscreen = document.createElement("canvas");
        const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
        if (!offCtx) return;

        let animId;
        let callbackId;

        let lastW = 0;
        let lastH = 0;
        let cellW = 8;
        let cellH = 14;
        let cols = 0;
        let rows = 0;
        let rowChars = [];

        const updateGridMetrics = (width, height) => {
            const isMobile = width < 768;
            const fontSize = isMobile ? (lowPowerMode ? 14 : 11) : 13;
            ctx.font = `${fontSize}px monospace`;
            ctx.textBaseline = "top";

            const charW = ctx.measureText("M").width || (isMobile ? 7 : 8);
            cellW = charW;
            cellH = Math.round(cellW / 0.55);
            const calculatedCols = Math.floor(width / cellW);
            // Adaptive resolution scaling: clamp sampling grid to ~38 cols on phone / low-power
            cols = (isMobile || lowPowerMode) ? Math.min(calculatedCols, 38) : calculatedCols;
            rows = Math.floor(height / cellH);

            if (cols > 0 && (!rowChars || rowChars.length !== cols)) {
                rowChars = new Array(cols);
            }
            lastW = width;
            lastH = height;
        };

        const renderAscii = () => {
            if (!isVisibleRef.current) {
                // Pause completely when tab is backgrounded / screen is locked (0% CPU)
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
                updateGridMetrics(width, height);
            } else if (width !== lastW || height !== lastH) {
                updateGridMetrics(width, height);
            }

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
            let dX = 0, dY = 0, dW = cols, dH = rows;

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

            // Step 1: Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Step 2: Draw text rows in white with table-lookup & integer math
            ctx.fillStyle = "#ffffff";
            const now = performance.now();

            for (let y = 0; y < rows; y++) {
                const rowOffset = y * cols * 4;
                for (let x = 0; x < cols; x++) {
                    const idx = rowOffset + x * 4;
                    const lum = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
                    rowChars[x] = RAMP_LOOKUP[lum];
                }
                ctx.fillText(rowChars.join(""), 0, y * cellH);
            }

            // Step 3: Composite exact video colors or disco gradient onto ASCII glyphs
            ctx.globalCompositeOperation = "source-in";
            if (discoMode) {
                const grad = ctx.createLinearGradient(0, 0, width, height);
                const h1 = (now * 0.06) % 360;
                grad.addColorStop(0, `hsl(${h1}, 100%, 65%)`);
                grad.addColorStop(0.5, `hsl(${(h1 + 120) % 360}, 100%, 65%)`);
                grad.addColorStop(1, `hsl(${(h1 + 240) % 360}, 100%, 65%)`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, width, height);
            } else {
                if (displayMode === "cover") {
                    ctx.drawImage(video, sX, sY, sW, sH, 0, 0, width, height);
                } else {
                    const scaleX = width / cols;
                    const scaleY = height / rows;
                    ctx.drawImage(
                        video,
                        0,
                        0,
                        vW,
                        vH,
                        Math.round(dX * scaleX),
                        Math.round(dY * scaleY),
                        Math.round(dW * scaleX),
                        Math.round(dH * scaleY)
                    );
                }
            }

            // Step 4: Paint background behind colored glyphs
            ctx.globalCompositeOperation = "destination-over";
            ctx.fillStyle = "#050505";
            ctx.fillRect(0, 0, width, height);

            // Step 5: Reset composite mode
            ctx.globalCompositeOperation = "source-over";

            scheduleNext();
        };

        const scheduleNext = () => {
            if (!isVisibleRef.current) return;
            if (video.requestVideoFrameCallback && !video.paused && !video.ended && video.readyState >= 2) {
                callbackId = video.requestVideoFrameCallback(renderAscii);
            } else {
                animId = requestAnimationFrame(renderAscii);
            }
        };

        scheduleNextAsciiRef.current = scheduleNext;
        scheduleNext();

        return () => {
            scheduleNextAsciiRef.current = null;
            if (callbackId && video.cancelVideoFrameCallback) {
                video.cancelVideoFrameCallback(callbackId);
            }
            if (animId) {
                cancelAnimationFrame(animId);
            }
            offscreen.width = 0;
            offscreen.height = 0;
        };
    }, [isLive, asciiLiveMode, lowPowerMode, displayMode, discoMode]);

    // Canvas buffer memory cleanup on unmount
    useEffect(() => {
        return () => {
            if (canvasRef.current) {
                canvasRef.current.width = 0;
                canvasRef.current.height = 0;
            }
        };
    }, []);

    // 3. Multi-User Telemetry WebSocket Connection to TouchDesigner
    const sessionIdRef = useRef("usr_" + Math.random().toString(36).substring(2, 7));

    useEffect(() => {
        let isMounted = true;
        let ws = null;
        let reconnectTimer = null;

        let wsUrl = "";
        if (isLocalhost) {
            wsUrl = "ws://localhost:9988/ws";
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

                // Receive real-time server stats, chat history & live messages
                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === "stats") {
                            if (typeof msg.viewers === "number") {
                                setViewerCount(Math.max(1, msg.viewers));
                            }
                        } else if (msg.type === "chat_history") {
                            if (Array.isArray(msg.messages)) {
                                setChatMessages(msg.messages);
                            }
                        } else if (msg.type === "chat") {
                            setChatMessages((prev) => [...prev.slice(-49), msg]);
                            if (!isChatOpenRef.current) {
                                setUnreadChatCount((prev) => prev + 1);
                            }
                        } else if (msg.type === "mode") {
                            if (msg.mode) {
                                setShowMode(msg.mode);
                            }
                        } else if (msg.type === "status") {
                            if (msg.mode) {
                                setShowMode(msg.mode);
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

    // Send a real-time audience chat message
    const sendChatMessage = (e) => {
        if (e) e.preventDefault();
        const text = sanitizeChat(chatInputText);
        if (!text) return;

        const user = sanitizeChat(chatUsername, 24) || "anon";

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const packet = {
                type: "chat",
                user,
                text,
            };
            wsRef.current.send(JSON.stringify(packet));
            setChatInputText("");
        } else {
            const cleanUrl = streamUrl ? streamUrl.replace(/\/+$/, "") : "";
            if (cleanUrl) {
                fetch(`${cleanUrl}/chat/send`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ user, text }),
                }).catch(() => {});
                setChatInputText("");
            }
        }
    };

    // 4. Creative Kinetic & Environmental Telemetry Engine (Streams to TouchDesigner at 60 FPS)
    const lastMouseSendRef = useRef(0);
    const isMouseDownRef = useRef(false);
    const isTouchRef = useRef(false);
    const prevCoordRef = useRef({ u: 0.5, v: 0.5, time: performance.now() });
    const clickStartRef = useRef(0);
    const totalClicksRef = useRef(0);

    const sendTelemetry = (clientX, clientY, isDown = isMouseDownRef.current) => {
        // Halt all telemetry parsing and network transmission when backgrounded / hidden
        if (!isVisibleRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const now = performance.now();
        const throttleMs = 16;
        if (now - lastMouseSendRef.current < throttleMs) return;
        lastMouseSendRef.current = now;

        const currentMode = displayModeRef.current;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        if (!viewportWidth || !viewportHeight) return;

        const viewportAspect = viewportWidth / Math.max(1, viewportHeight);

        const video = videoRef.current;
        if (video && video.videoWidth > 0 && video.videoHeight > 0) {
            lastKnownAspectRef.current = video.videoWidth / video.videoHeight;
        }
        const vAspect = lastKnownAspectRef.current;

        let imgX = 0;
        let imgY = 0;
        let imgW = viewportWidth;
        let imgH = viewportHeight;

        if (currentMode === "cover") {
            if (vAspect > viewportAspect) {
                imgH = viewportHeight;
                imgW = viewportHeight * vAspect;
                imgX = (viewportWidth - imgW) / 2;
                imgY = 0;
            } else {
                imgW = viewportWidth;
                imgH = viewportWidth / vAspect;
                imgX = 0;
                imgY = (viewportHeight - imgH) / 2;
            }
        } else {
            // currentMode === "fit" (object-contain)
            if (vAspect > viewportAspect) {
                imgW = viewportWidth;
                imgH = viewportWidth / vAspect;
                imgX = 0;
                imgY = (viewportHeight - imgH) / 2;
            } else {
                imgH = viewportHeight;
                imgW = viewportHeight * vAspect;
                imgX = (viewportWidth - imgW) / 2;
                imgY = 0;
            }
        }

        const cursorX = clientX;
        const cursorY = clientY;

        // Image-relative coordinates: bottom-left is (0, 0), top-right is (1, 1)
        const rawU = (cursorX - imgX) / imgW;
        const rawV = 1.0 - ((cursorY - imgY) / imgH);

        const inside = (rawU >= 0 && rawU <= 1 && rawV >= 0 && rawV <= 1) ? 1 : 0;
        const u = Math.max(0, Math.min(1, rawU));
        const v = Math.max(0, Math.min(1, rawV));

        // Kinetic Velocity Calculation based on image UVs
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
            raw_u: Number(rawU.toFixed(4)),
            raw_v: Number(rawV.toFixed(4)),
            vx,
            vy,
            speed,
            click: isDown ? 1 : 0,
            click_dur: clickDur,
            clicks: totalClicksRef.current,
            inside,
            is_touch: isTouchRef.current ? 1 : 0,
            aspect: Number(viewportAspect.toFixed(2)),
            img_aspect: Number(vAspect.toFixed(2)),
            hour: localHour,
            tz: tzOffset,
            dark: window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0,
            audio: isMutedRef.current ? 0 : 1,
            visible: isVisibleRef.current ? 1 : 0,
            fps: fpsRef.current || 60,
            mode: currentMode,
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

    const handleTouchStart = (e) => {
        isMouseDownRef.current = true;
        isTouchRef.current = true;
        totalClicksRef.current++;
        clickStartRef.current = performance.now();
        if (e.touches && e.touches[0]) {
            sendTelemetry(e.touches[0].clientX, e.touches[0].clientY, true);
        }
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

    // Global Capture-Phase Tracking Listeners (Ensures 60 FPS tracking works over all text, buttons, and inputs)
    useEffect(() => {
        const onMouseMove = (e) => handleMouseMove(e);
        const onMouseDown = (e) => handleMouseDown(e);
        const onMouseUp = (e) => handleMouseUp(e);
        const onTouchStart = (e) => handleTouchStart(e);
        const onTouchMove = (e) => handleTouchMove(e);
        const onTouchEnd = (e) => handleMouseUp(e);
        const onMouseLeave = () => {
            setIsHoverTop(false);
            isMouseDownRef.current = false;
        };

        window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
        window.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
        window.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
        window.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
        window.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
        window.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
        window.addEventListener("mouseleave", onMouseLeave, { passive: true });

        return () => {
            window.removeEventListener("mousemove", onMouseMove, { capture: true });
            window.removeEventListener("mousedown", onMouseDown, { capture: true });
            window.removeEventListener("mouseup", onMouseUp, { capture: true });
            window.removeEventListener("touchstart", onTouchStart, { capture: true });
            window.removeEventListener("touchmove", onTouchMove, { capture: true });
            window.removeEventListener("touchend", onTouchEnd, { capture: true });
            window.removeEventListener("mouseleave", onMouseLeave);
        };
    }, []);

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
                                            ? `LIVE ${transport ? `// ${transport}` : ""} ${fps > 0 ? `// ${fps} FPS` : ""} // [${String(showMode || "AUTO").toUpperCase()}] // ${viewerCount} ${viewerCount === 1 ? "VIEWER" : "VIEWERS"}`
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
                            onClick={() => {
                                setDisplayMode(prev => {
                                    const next = prev === "cover" ? "fit" : "cover";
                                    displayModeRef.current = next;
                                    return next;
                                });
                            }}
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

                        {/* Chat Toggle: [C: CHAT] */}
                        <button
                            onClick={() => setIsChatOpen(prev => !prev)}
                            className={`px-1 uppercase cursor-pointer transition-colors ${
                                isChatOpen
                                    ? "text-[#ff0080] font-bold hover:bg-[#ff0080] hover:text-black"
                                    : unreadChatCount > 0
                                    ? "text-yellow-400 font-bold hover:bg-yellow-400 hover:text-black"
                                    : "text-neutral-300 hover:bg-white hover:text-black"
                            }`}
                            title="Press C to toggle Live Chat"
                        >
                            <AsciiWipeItem
                                text={isChatOpen ? "[C: CHAT (ON)]" : unreadChatCount > 0 ? `[C: CHAT (${unreadChatCount})]` : "[C: CHAT]"}
                                progress={wipeProgress}
                                startIndex={86}
                                totalLength={120}
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
                                totalLength={120}
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
                            : "w-full h-full object-contain"
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

            {/* 4. ASCII / TUI LIVE CHAT DRAWER */}
            {isChatOpen && (
                <aside
                    className="absolute top-12 bottom-4 right-3 z-40 w-80 max-w-[calc(100vw-24px)] bg-black/95 border border-neutral-700 backdrop-blur-md flex flex-col font-mono text-xs shadow-2xl select-text animate-fadeIn"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header Bar */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 bg-neutral-900/90 text-neutral-300">
                        <span className="font-bold tracking-wider text-[#ff0080] flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#ff0080] animate-pulse" />
                            LIVE CHAT [{chatMessages.length}]
                        </span>
                        <button
                            onClick={() => setIsChatOpen(false)}
                            className="text-neutral-400 hover:text-white px-1.5 py-0.5 hover:bg-neutral-800 cursor-pointer font-bold"
                            title="Close Chat (Esc or C)"
                        >
                            [X]
                        </button>
                    </div>

                    {/* Handle Customization Bar */}
                    <div className="px-3 py-1.5 border-b border-neutral-800 bg-neutral-950 flex items-center justify-between text-[11px] text-neutral-400">
                        <div className="flex items-center gap-1.5 truncate">
                            <span className="text-neutral-500">ID:</span>
                            {isEditingUsername ? (
                                <input
                                    type="text"
                                    defaultValue={chatUsername}
                                    maxLength={20}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            const val = sanitizeChat(e.target.value, 20);
                                            if (val) {
                                                setChatUsername(val);
                                                localStorage.setItem("sisyfuz_chat_user", val);
                                            }
                                            setIsEditingUsername(false);
                                        } else if (e.key === "Escape") {
                                            setIsEditingUsername(false);
                                        }
                                    }}
                                    onBlur={(e) => {
                                        const val = sanitizeChat(e.target.value, 20);
                                        if (val) {
                                            setChatUsername(val);
                                            localStorage.setItem("sisyfuz_chat_user", val);
                                        }
                                        setIsEditingUsername(false);
                                    }}
                                    className="bg-neutral-800 text-white px-1.5 py-0.5 outline-none border border-neutral-600 rounded text-[11px]"
                                />
                            ) : (
                                <button
                                    onClick={() => setIsEditingUsername(true)}
                                    className="text-white hover:text-[#ff0080] cursor-pointer truncate max-w-[140px] flex items-center gap-1 underline underline-offset-2"
                                    title="Click to change your username"
                                >
                                    <span>{chatUsername}</span>
                                    <span className="text-[10px] text-neutral-500">✎</span>
                                </button>
                            )}
                        </div>
                        <span className="text-[10px] text-neutral-500 uppercase">{transport || "CONNECTED"}</span>
                    </div>

                    {/* Message Stream */}
                    <div
                        ref={chatScrollRef}
                        className="flex-1 overflow-y-auto p-3 space-y-2 select-text font-mono text-[11px] leading-relaxed"
                    >
                        {chatMessages.length === 0 ? (
                            <div className="text-neutral-600 italic py-12 text-center text-xs">
                                No messages yet.<br />Say something to the stream!
                            </div>
                        ) : (
                            chatMessages.map((m, idx) => (
                                <div key={m.id || idx} className="break-words">
                                    <span className="text-neutral-500 text-[10px] mr-1.5 select-none">
                                        {m.time ? new Date(m.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                                    </span>
                                    {m.isHost || m.user?.startsWith("[HOST]") ? (
                                        <span className="text-[#ff0080] font-bold mr-1.5">[HOST]</span>
                                    ) : (
                                        <span className="text-neutral-300 font-bold mr-1.5">{m.user}:</span>
                                    )}
                                    <span className={m.isHost ? "text-white font-medium" : "text-neutral-200"}>
                                        {m.text}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Chat Input Bar */}
                    <form
                        onSubmit={sendChatMessage}
                        className="p-2 border-t border-neutral-700 bg-neutral-900/90 flex gap-1.5 items-center"
                    >
                        <input
                            type="text"
                            value={chatInputText}
                            onChange={(e) => setChatInputText(e.target.value)}
                            placeholder="Type a message... (Enter)"
                            maxLength={200}
                            className="flex-1 bg-black text-white px-2.5 py-1.5 border border-neutral-700 focus:border-[#ff0080] outline-none text-xs rounded-none placeholder:text-neutral-600"
                        />
                        <button
                            type="submit"
                            disabled={!chatInputText.trim()}
                            className="px-2.5 py-1.5 bg-neutral-800 hover:bg-[#ff0080] hover:text-black text-white disabled:opacity-30 disabled:hover:bg-neutral-800 disabled:hover:text-white cursor-pointer uppercase text-[11px] font-bold transition-colors"
                        >
                            SEND
                        </button>
                    </form>
                </aside>
            )}

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
