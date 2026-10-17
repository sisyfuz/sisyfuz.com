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

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === "INPUT" && e.target !== inputRef.current) return;
            if (e.target.tagName === "TEXTAREA") return;

            if (e.key === "Enter" || e.key === "Escape") {
                setBuffer("");
                bufferRef.current = "";
                setSearchQuery("");
                inputRef.current?.blur();
                return;
            }

            if (e.key === "Backspace") {
                processCommand(bufferRef.current.slice(0, -1));
                return;
            }

            const key = e.key.toLowerCase();
            if (key.length === 1 && /[a-z0-9 ]/.test(key)) {
                processCommand((bufferRef.current + key).slice(-25));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [processCommand, setSearchQuery]);

    return (
        <div className={`min-h-screen w-full bg-[#050505] text-[#f0f0f0] font-mono text-xs sm:text-[13px] leading-relaxed px-6 sm:px-12 md:px-16 lg:px-24 py-8 md:py-12 flex flex-col justify-between select-text relative ${
            discoMode ? "animate-disco" : ""
        }`}>
            
            {/* Top Raw Header */}
            <div className="space-y-4 pb-10 z-10">
                <header className="flex items-center justify-between uppercase">
                    <button
                        onClick={() => handleSwitchSection("home")}
                        className="font-bold cursor-pointer hover:bg-white hover:text-black px-1 -mx-1"
                    >
                        sisyfuz
                    </button>

                    <nav className="flex items-center gap-4 sm:gap-6">
                        {SECTIONS.map((sec) => {
                            const isActive = activeSection === sec.key;
                            return (
                                <button
                                    key={sec.key}
                                    onClick={() => handleSwitchSection(sec.key)}
                                    className={`cursor-pointer px-1 -mx-1 font-mono uppercase ${
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
            <main className="flex-1 pb-24 z-10">
                {activeSection === "home" && (
                    <div className="space-y-10 animate-fadeIn max-w-3xl">
                        {/* ASCII Banner */}
                        <pre className="text-[10px] sm:text-xs leading-none font-bold text-neutral-300 select-none overflow-x-auto whitespace-pre">
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
                        <div className="pt-4 flex flex-wrap gap-6 uppercase">
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
            <footer className="pt-8 text-neutral-600 flex items-center justify-between uppercase z-10">
                <span>SISYFUZ // DORUS KLEIJNE</span>
                <span>UTRECHT, NL</span>
            </footer>

            {/* AMBIENT FLOATING SEARCH PROMPT */}
            <div
                className="fixed z-50 text-center pointer-events-auto md:pointer-events-none"
                style={{
                    bottom: 'calc(2.5rem + env(safe-area-inset-bottom))',
                    left: '50%',
                    transform: 'translateX(-50%)'
                }}
                onClick={() => {
                    if (window.innerWidth < 768) inputRef.current?.focus();
                }}
            >
                <input
                    ref={inputRef}
                    type="text"
                    value={buffer}
                    onChange={(e) => {
                        const cleanVal = e.target.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(-25);
                        processCommand(cleanVal);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") {
                            setBuffer("");
                            bufferRef.current = "";
                            setSearchQuery("");
                            e.target.blur();
                        }
                    }}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-text md:hidden font-mono"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                />

                <div className="font-mono text-xs uppercase tracking-[0.3em] text-white flex items-center justify-center">
                    {/* Mobile View */}
                    <div className="md:hidden flex items-center bg-black/90 px-3 py-1.5 border border-white/20 text-neutral-300">
                        <span className="mr-2 text-pink-500">&gt;</span>
                        <span>{buffer || "tap_to_search"}</span>
                        <span className="animate-pulse ml-2 w-1.5 h-3 bg-pink-500"></span>
                    </div>

                    {/* Desktop View */}
                    <div className={`hidden md:flex items-center ${
                        buffer ? "text-white" : "text-neutral-500"
                    }`}>
                        <span className="mr-2 text-pink-500 font-bold">&gt;</span>
                        <span>{buffer || "..."}</span>
                        <span className="animate-pulse ml-1 text-pink-500">_</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
