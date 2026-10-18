// src/components/SharpDisplay.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useDisco } from "../context/DiscoContext";
import { SISYFUZ_BANNER, ASCII_DIVIDER } from "../utils/ascii";
import TuiWork from "../tui/TuiWork";
import TuiArchive from "../tui/TuiArchive";
import TuiAbout from "../tui/TuiAbout";
import TuiContact from "../tui/TuiContact";
import TuiPress from "../tui/TuiPress";
import TuiLive from "../tui/TuiLive";
import TuiPrivacy from "../tui/TuiPrivacy";

const SECTIONS = [
    { key: "work", label: "work" },
    { key: "archive", label: "archive" },
    { key: "about", label: "about" },
    { key: "contact", label: "contact" },
    { key: "press", label: "press" },
    { key: "live", label: "live" },
];

export default function SharpDisplay() {
    const navigate = useNavigate();
    const location = useLocation();
    const { discoMode, setDiscoMode, setSearchQuery, setAsciiLiveMode } = useDisco();

    const [activeSection, setActiveSection] = useState("home");
    const [selectedWorkId, setSelectedWorkId] = useState(null);
    const [buffer, setBuffer] = useState("");
    const [isSearchFocused, setIsSearchFocused] = useState(false);

    const inputRef = useRef(null);
    const bufferRef = useRef(buffer);

    useEffect(() => {
        bufferRef.current = buffer;
    }, [buffer]);

    // Sync route with active section
    useEffect(() => {
        const path = location.pathname.replace(/^\//, "").toLowerCase();
        if (path === "" || path === "home") {
            setActiveSection("home");
            setSelectedWorkId(null);
        } else if (path === "privacy" || path === "legal") {
            setActiveSection("privacy");
            setSelectedWorkId(null);
        } else if (SECTIONS.some(s => s.key === path)) {
            setActiveSection(path);
            if (location.hash) {
                setSelectedWorkId(location.hash.replace("#", ""));
            } else {
                setSelectedWorkId(null);
            }
        }
    }, [location.pathname, location.hash]);

    const handleSwitchSection = (sectionKey) => {
        setActiveSection(sectionKey);
        setSelectedWorkId(null);
        setBuffer("");
        bufferRef.current = "";
        setSearchQuery("");
        navigate(sectionKey === "home" ? "/" : `/${sectionKey}`);
    };

    const processCommand = useCallback((val) => {
        setBuffer(val);
        bufferRef.current = val;

        const routes = ["work", "archive", "about", "contact", "press", "live", "home", "privacy", "legal"];

        if (val.endsWith("disco")) {
            setDiscoMode(prev => !prev);
            setBuffer("");
            bufferRef.current = "";
            setSearchQuery("");
            inputRef.current?.blur();
        } else if (val.endsWith("ascii")) {
            setAsciiLiveMode(prev => (location.pathname === "/live" ? !prev : true));
            setActiveSection("live");
            navigate("/live");
            setBuffer("");
            bufferRef.current = "";
            setSearchQuery("");
            inputRef.current?.blur();
        } else if (routes.some(r => val.endsWith(r))) {
            const matchedRoute = routes.find(r => val.endsWith(r));
            const targetSection = matchedRoute === "legal" ? "privacy" : matchedRoute;
            setActiveSection(targetSection);
            navigate(targetSection === "home" ? "/" : `/${targetSection}`);
            setBuffer("");
            bufferRef.current = "";
            setSearchQuery("");
            inputRef.current?.blur();
        } else {
            const q = val.trim();
            setSearchQuery(q);
            if (q.length > 0 && activeSection !== "work") {
                setActiveSection("work");
                navigate("/work");
            }
        }
    }, [activeSection, navigate, setDiscoMode, setSearchQuery]);

    // Clear search on global Escape key
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            if (e.key === "Escape") {
                setBuffer("");
                bufferRef.current = "";
                setSearchQuery("");
                inputRef.current?.blur();
            }
        };

        window.addEventListener("keydown", handleGlobalKeyDown);
        return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    }, [setSearchQuery]);

    return (
        <div className={`min-h-screen w-full bg-[#050505] text-[#f0f0f0] font-mono text-xs sm:text-[13px] leading-relaxed px-4 sm:px-8 md:px-16 lg:px-24 py-6 sm:py-8 md:py-12 flex flex-col justify-between select-text relative ${
            discoMode ? "animate-disco" : ""
        }`}>
            
            {/* Top Raw Header */}
            <div className="space-y-4 pb-8 sm:pb-10 z-10">
                <header className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 uppercase">
                    <button
                        onClick={() => handleSwitchSection("home")}
                        className="font-bold cursor-pointer hover:bg-white hover:text-black px-1 -mx-1"
                    >
                        sisyfuz
                    </button>

                    <nav className="flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-1.5">
                        {SECTIONS.map((sec) => {
                            const isActive = activeSection === sec.key;
                            return (
                                <button
                                    key={sec.key}
                                    onClick={() => handleSwitchSection(sec.key)}
                                    className={`cursor-pointer px-1 -mx-1 font-mono uppercase transition-colors ${
                                        isActive
                                            ? "bg-pink-500 text-black font-bold"
                                            : "text-neutral-400 hover:bg-white hover:text-black"
                                    }`}
                                >
                                    [{sec.label}]
                                </button>
                            );
                        })}
                    </nav>
                </header>

                <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>
            </div>

            {/* Main Content Body */}
            <main className="flex-1 pb-16 z-10">
                {activeSection === "home" && (
                    <div className="space-y-10 animate-fadeIn max-w-3xl">
                        {/* ASCII Banner */}
                        <pre className="text-[9px] xs:text-[10px] sm:text-xs leading-none font-bold text-neutral-300 select-none overflow-x-auto whitespace-pre no-scrollbar">
                            {SISYFUZ_BANNER}
                        </pre>

                        {/* Raw Statement */}
                        <div className="space-y-4 text-neutral-300">
                            <p className="font-bold text-white uppercase">
                                DORUS KLEIJNE (2006)
                            </p>
                            <p>
                                Dorus Kleijne maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.
                            </p>
                            <p className="text-neutral-400 italic">
                                &gt; "Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."
                            </p>
                        </div>

                        {/* Raw Jump Links with Reverse-Video */}
                        <div className="pt-4 flex flex-wrap gap-x-4 gap-y-2 sm:gap-6 uppercase">
                            <button
                                onClick={() => handleSwitchSection("work")}
                                className="text-white hover:bg-white hover:text-black font-bold px-1 -mx-1 cursor-pointer"
                            >
                                [VIEW_SELECTED_WORKS →]
                            </button>
                            <button
                                onClick={() => handleSwitchSection("archive")}
                                className="text-neutral-400 hover:bg-white hover:text-black px-1 -mx-1 cursor-pointer"
                            >
                                [SYSTEM_ARCHIVE →]
                            </button>
                            <button
                                onClick={() => handleSwitchSection("about")}
                                className="text-neutral-400 hover:bg-white hover:text-black px-1 -mx-1 cursor-pointer"
                            >
                                [ABOUT_INFO →]
                            </button>
                            <button
                                onClick={() => handleSwitchSection("contact")}
                                className="text-neutral-400 hover:bg-white hover:text-black px-1 -mx-1 cursor-pointer"
                            >
                                [CONTACT →]
                            </button>
                        </div>
                    </div>
                )}

                {activeSection === "work" && (
                    <TuiWork selectedId={selectedWorkId} />
                )}

                {activeSection === "archive" && (
                    <TuiArchive onSelectWork={(id) => {
                        setSelectedWorkId(id);
                        setActiveSection("work");
                        navigate(`/work#${id}`);
                    }} />
                )}

                {activeSection === "about" && (
                    <TuiAbout onNavigate={handleSwitchSection} />
                )}

                {activeSection === "contact" && (
                    <TuiContact />
                )}

                {activeSection === "press" && (
                    <TuiPress />
                )}

                {activeSection === "live" && (
                    <TuiLive onNavigate={handleSwitchSection} />
                )}

                {activeSection === "privacy" && (
                    <TuiPrivacy onNavigate={handleSwitchSection} />
                )}
            </main>

            {/* Subtle Minimal Footer with Privacy & Legal Notice */}
            <footer className="pt-8 pb-16 text-neutral-600 flex flex-wrap items-center justify-between gap-y-2 gap-x-4 uppercase z-10 text-[11px] sm:text-xs">
                <div className="flex items-center gap-3">
                    <span>SISYFUZ // DORUS KLEIJNE</span>
                    <span>UTRECHT, NL</span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleSwitchSection("privacy")}
                        className={`hover:bg-white hover:text-black px-1 -mx-1 cursor-pointer transition-none ${
                            activeSection === "privacy" ? "text-white font-bold bg-neutral-800" : "text-neutral-500"
                        }`}
                        title="Privacyverklaring & Colofon (AVG/GDPR)"
                    >
                        [PRIVACY_&_LEGAL]
                    </button>
                </div>
            </footer>

            {/* RAW ASCII FLOATING SEARCH BOX */}
            <div
                className="fixed z-50 select-none cursor-pointer"
                style={{
                    bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
                    left: '50%',
                    transform: 'translateX(-50%)'
                }}
                onClick={() => inputRef.current?.focus()}
            >
                <div
                    style={activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? { textShadow: '0 1px 3px rgba(0,0,0,0.95)' } : undefined}
                    className={`w-[285px] xs:w-[320px] sm:w-[380px] font-mono text-xs uppercase transition-colors ${
                        isSearchFocused
                            ? "text-white"
                            : buffer
                            ? "text-neutral-200"
                            : "text-neutral-400 hover:text-neutral-200"
                    }`}
                >
                    {/* Top ASCII border line */}
                    <div className={`flex items-center leading-none select-none overflow-hidden whitespace-nowrap ${
                        activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? "text-neutral-400" : "text-neutral-600"
                    }`}>
                        <span>+--[</span>
                        <span className="text-[#ff0080] font-bold px-1">&gt;</span>
                        <span className={`font-bold transition-colors ${
                            isSearchFocused
                                ? "text-white"
                                : activeSection === "live" || location.pathname.toLowerCase().startsWith("/live")
                                ? "text-neutral-300"
                                : "text-neutral-400"
                        }`}>
                            SEARCH
                        </span>
                        <span>]</span>
                        <span className={`flex-1 overflow-hidden whitespace-nowrap ${
                            activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? "text-neutral-500" : "text-neutral-700"
                        }`}>
                            ----------------------------------------------------
                        </span>
                        <span>+</span>
                    </div>

                    {/* Middle ASCII interactive row */}
                    <div className={`flex items-center px-1 py-1 transition-colors ${
                        activeSection === "live" || location.pathname.toLowerCase().startsWith("/live")
                            ? "bg-transparent"
                            : "bg-black/95"
                    } ${
                        isSearchFocused ? "text-white" : "text-neutral-300"
                    }`}>
                        <span className={`mr-2 select-none ${
                            activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? "text-neutral-400" : "text-neutral-600"
                        }`}>|</span>
                        <span className="text-[#ff0080] font-bold mr-1.5 select-none">&gt;</span>

                        <input
                            ref={inputRef}
                            type="text"
                            value={buffer}
                            placeholder={isSearchFocused ? "" : "PRESS_TO_SEARCH"}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                            onChange={(e) => {
                                const cleanVal = e.target.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(-25);
                                processCommand(cleanVal);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.target.blur();
                                } else if (e.key === "Escape") {
                                    setBuffer("");
                                    bufferRef.current = "";
                                    setSearchQuery("");
                                    e.target.blur();
                                }
                            }}
                            className={`bg-transparent text-white font-mono text-xs uppercase tracking-widest outline-none border-none p-0 flex-1 min-w-0 ${
                                activeSection === "live" || location.pathname.toLowerCase().startsWith("/live")
                                    ? "placeholder:text-neutral-400"
                                    : "placeholder:text-neutral-600"
                            }`}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck="false"
                        />

                        {/* Blinking Pink ASCII Cursor */}
                        <span className="animate-pulse text-[#ff0080] font-bold select-none mr-2">
                            {isSearchFocused ? "█" : "_"}
                        </span>

                        {/* ESC Clear Button */}
                        {buffer && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setBuffer("");
                                    bufferRef.current = "";
                                    setSearchQuery("");
                                    inputRef.current?.blur();
                                }}
                                className="font-mono text-[11px] font-bold uppercase text-neutral-400 hover:bg-[#ff0080] hover:text-black px-1 cursor-pointer select-none transition-none mr-1 shrink-0"
                                title="Clear query (ESC)"
                            >
                                [ESC]
                            </button>
                        )}

                        <span className={`ml-auto select-none ${
                            activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? "text-neutral-400" : "text-neutral-600"
                        }`}>|</span>
                    </div>

                    {/* Bottom ASCII border line */}
                    <div className={`flex items-center leading-none select-none overflow-hidden whitespace-nowrap ${
                        activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? "text-neutral-400" : "text-neutral-600"
                    }`}>
                        <span>+</span>
                        <span className={`flex-1 overflow-hidden whitespace-nowrap ${
                            activeSection === "live" || location.pathname.toLowerCase().startsWith("/live") ? "text-neutral-500" : "text-neutral-700"
                        }`}>
                            ----------------------------------------------------
                        </span>
                        <span>+</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
