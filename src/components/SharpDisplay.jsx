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
    const { discoMode, setDiscoMode, setSearchQuery } = useDisco();

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

        const routes = ["work", "archive", "about", "contact", "press", "live", "home"];

        if (val.endsWith("disco")) {
            setDiscoMode(prev => !prev);
            setBuffer("");
            bufferRef.current = "";
            setSearchQuery("");
            inputRef.current?.blur();
        } else if (routes.some(r => val.endsWith(r))) {
            const matchedRoute = routes.find(r => val.endsWith(r));
            setActiveSection(matchedRoute);
            navigate(matchedRoute === "home" ? "/" : `/${matchedRoute}`);
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
            </main>

            {/* Subtle Minimal Footer */}
            <footer className="pt-8 pb-4 text-neutral-600 flex flex-wrap items-center justify-between gap-2 uppercase z-10 text-[11px] sm:text-xs">
                <span>SISYFUZ // DORUS KLEIJNE</span>
                <span>UTRECHT, NL</span>
            </footer>

            {/* EXPLICIT TERMINAL SEARCH BAR */}
            <div
                className="sticky bottom-0 z-50 w-full bg-[#050505]/95 backdrop-blur-sm border-t border-white/10 pt-2.5 pb-[calc(0.6rem+env(safe-area-inset-bottom))] px-2 mt-auto"
            >
                <div className="max-w-xl mx-auto flex items-center justify-between font-mono text-xs">
                    <div
                        onClick={() => inputRef.current?.focus()}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 border transition-colors cursor-text ${
                            isSearchFocused
                                ? "border-pink-500 bg-black text-white"
                                : buffer
                                ? "border-neutral-500 bg-neutral-950 text-white"
                                : "border-neutral-800 bg-neutral-950/80 text-neutral-400 hover:border-neutral-700"
                        }`}
                    >
                        <span className="text-pink-500 font-bold select-none">&gt;</span>
                        <input
                            ref={inputRef}
                            type="text"
                            value={buffer}
                            placeholder="SEARCH OR TYPE COMMAND..."
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                            onChange={(e) => {
                                const cleanVal = e.target.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(-30);
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
                            className="bg-transparent text-white placeholder-neutral-600 outline-none w-full font-mono text-xs uppercase"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck="false"
                        />
                        {isSearchFocused && !buffer && (
                            <span className="animate-pulse w-1.5 h-3 bg-pink-500 select-none"></span>
                        )}
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
                                className="text-neutral-500 hover:text-white px-1 font-bold uppercase select-none cursor-pointer"
                                title="Clear query (ESC)"
                            >
                                [ESC]
                            </button>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}
