// src/components/SharpDisplay.jsx
import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useDisco } from "../context/DiscoContext";
import { useA11y } from "../context/A11yContext";
import { SISYFUZ_BANNER, ASCII_DIVIDER } from "../utils/ascii";
import { parseRoute, sectionPath, isPlainLeftClick } from "../utils/routing";
import { parseCommand, isCommandPrefix, normalizeSearchInput } from "../utils/commands";
import A11yToolbar from "./A11yToolbar";
import MobileCommandBar from "./MobileCommandBar";

const TuiWork = lazy(() => import("../tui/TuiWork"));
const TuiArchive = lazy(() => import("../tui/TuiArchive"));
const TuiAbout = lazy(() => import("../tui/TuiAbout"));
const TuiContact = lazy(() => import("../tui/TuiContact"));
const TuiPress = lazy(() => import("../tui/TuiPress"));
const TuiLive = lazy(() => import("../tui/TuiLive"));
const TuiPrivacy = lazy(() => import("../tui/TuiPrivacy"));

function AsciiSectionLoader() {
    return (
        <div className="py-[4lh] font-mono uppercase text-neutral-500 animate-pulse select-none">
            [ LOADING_VIEW... ]
        </div>
    );
}

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
    const { discoMode, setDiscoMode, searchQuery, setSearchQuery, setAsciiLiveMode } = useDisco();
    const { isA11yToolbarOpen, toggleA11yToolbar } = useA11y();

    // The URL is the source of truth for the active view and project detail.
    const route = useMemo(
        () => parseRoute(location.pathname, location.hash),
        [location.pathname, location.hash]
    );
    const activeSection = route.section;
    const selectedWorkSlug = route.slug;
    const isWorkList = activeSection === "work" && !selectedWorkSlug;

    const [buffer, setBuffer] = useState("");
    const [isSearchFocused, setIsSearchFocused] = useState(false);

    const inputRef = useRef(null);

    const isLive = activeSection === "live" || location.pathname.toLowerCase().startsWith("/live");

    // Legacy URLs (e.g. /work#slug) are replaced with their canonical form.
    useEffect(() => {
        if (route.redirect) navigate(route.redirect, { replace: true });
    }, [route.redirect, navigate]);

    // Reset the search buffer + active filter, optionally blurring the input.
    const clearSearch = useCallback(({ blur = true } = {}) => {
        setBuffer("");
        setSearchQuery("");
        if (blur) inputRef.current?.blur();
    }, [setSearchQuery]);

    const resetForNavigation = () => {
        clearSearch({ blur: false });
        window.scrollTo({ top: 0, behavior: 'instant' });
    };

    // For views that navigate imperatively (TuiAbout, TuiLive, TuiPrivacy).
    const handleSwitchSection = (sectionKey) => {
        resetForNavigation();
        navigate(sectionPath(sectionKey));
    };

    // onClick for nav <Link>s: same side effects as handleSwitchSection, but only
    // for plain clicks, so ctrl/cmd/middle-click can open a new tab untouched.
    const handleNavLinkClick = (e) => {
        if (isPlainLeftClick(e)) resetForNavigation();
    };

    // While typing, the buffer is always a search filter. Jump to the /work list
    // to show results, unless the buffer may still become a command name (e.g. "arch").
    const handleSearchInput = useCallback((raw) => {
        const clean = normalizeSearchInput(raw, 25);
        setBuffer(clean);
        const q = clean.trim();
        setSearchQuery(q);
        if (q.length > 0 && !isWorkList && !isCommandPrefix(q)) {
            navigate("/work");
        }
    }, [isWorkList, navigate, setSearchQuery]);

    // On Enter: run the command if the whole buffer is exactly one, else keep the filter.
    const submitSearch = useCallback(() => {
        const command = parseCommand(buffer);
        if (!command) {
            if (buffer.trim().length > 0 && !isWorkList) {
                navigate("/work");
            }
            inputRef.current?.blur();
            return;
        }

        if (command.type === "toggleA11y") {
            toggleA11yToolbar();
        } else if (command.type === "toggleDisco") {
            setDiscoMode(prev => !prev);
        } else if (command.type === "ascii") {
            setAsciiLiveMode(prev => (isLive ? !prev : true));
            navigate(command.to);
        } else if (command.type === "navigate") {
            navigate(command.to);
        }
        clearSearch();
    }, [buffer, clearSearch, isLive, isWorkList, navigate, setAsciiLiveMode, setDiscoMode, toggleA11yToolbar]);

    // Clear search on global Escape key
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            if (e.key === "Escape") {
                clearSearch();
            }
        };

        window.addEventListener("keydown", handleGlobalKeyDown);
        return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    }, [clearSearch]);

    return (
        <div className={`min-h-[round(down,100dvh,1lh)] w-full bg-[#050505] text-[#f0f0f0] font-mono px-[2ch] sm:px-[4ch] md:px-[8ch] lg:px-[12ch] py-[1lh] sm:py-[2lh] md:py-[2lh] flex flex-col justify-between select-text relative ${
            discoMode ? "animate-disco" : ""
        }`}>
            {/* Keyboard Skip to Content */}
            <a
                href="#main-content"
                onClick={(e) => {
                    e.preventDefault();
                    const main = document.getElementById("main-content");
                    if (main) {
                        main.focus();
                        main.scrollIntoView({ behavior: "smooth" });
                    }
                }}
                className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-[#ff0080] focus:text-black focus:font-mono focus:font-bold focus:px-[2ch] focus:py-[0.5lh] focus:outline-none"
            >
                [SKIP_TO_CONTENT]
            </a>
            
            {/* Top Raw Header */}
            <div className="term-snap space-y-[1lh] pb-[2lh] z-10">
                <header role="banner" className="flex flex-wrap items-center justify-between gap-y-[1lh] gap-x-[2ch] uppercase">
                    <Link
                        to="/"
                        onClick={handleNavLinkClick}
                        className="font-bold cursor-pointer hover:bg-white hover:text-black"
                    >
                        sisyfuz
                    </Link>

                    <nav role="navigation" aria-label="Main Navigation" className="flex flex-wrap items-center gap-x-[2ch] sm:gap-x-[3ch]">
                        {SECTIONS.map((sec) => {
                            const isActive = activeSection === sec.key;
                            return (
                                <Link
                                    key={sec.key}
                                    to={sectionPath(sec.key)}
                                    onClick={handleNavLinkClick}
                                    aria-current={isActive ? "page" : undefined}
                                    className={`cursor-pointer font-mono uppercase transition-colors ${
                                        isActive
                                            ? "bg-pink-500 text-black font-bold"
                                            : "text-neutral-400 hover:bg-white hover:text-black"
                                    }`}
                                >
                                    [{sec.label}]
                                </Link>
                            );
                        })}

                        {/* Accessibility Settings Toggle */}
                        <button
                            type="button"
                            onClick={toggleA11yToolbar}
                            className={`cursor-pointer font-mono uppercase transition-colors ${
                                isA11yToolbarOpen
                                    ? "bg-[#ff0080] text-black font-bold"
                                    : "text-[#ff0080] hover:bg-[#ff0080] hover:text-black"
                            }`}
                            aria-label="Open Accessibility & Performance Toolbar"
                            aria-expanded={isA11yToolbarOpen}
                        >
                            [A11Y]
                        </button>
                    </nav>
                </header>

                <div aria-hidden="true" className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>
            </div>

            {/* Dedicated screen-reader live announcements for search and filter updates */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {searchQuery ? `Active filter: ${searchQuery}` : ""}
            </div>

            {/* Main Content Body */}
            <main id="main-content" tabIndex="-1" role="main" className="term-snap flex-1 pb-[6lh] md:pb-[3lh] z-10 outline-none">
                {activeSection === "home" && (
                    <div className="space-y-[2lh] animate-fadeIn max-w-[96ch]">
                        {/* ASCII Banner */}
                        <h1 className="sr-only">SISYFUZ - Dorus Kleijne Portfolio</h1>
                        <pre aria-hidden="true" className="font-bold text-neutral-300 select-none overflow-x-auto whitespace-pre no-scrollbar">
                            {SISYFUZ_BANNER}
                        </pre>

                        {/* Raw Statement */}
                        <div className="space-y-[1lh] text-neutral-300">
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
                        <div className="pt-[1lh] flex flex-wrap gap-x-[2ch] sm:gap-x-[3ch] sm:gap-y-[1lh] uppercase">
                            <Link
                                to="/work"
                                onClick={handleNavLinkClick}
                                className="text-white hover:bg-white hover:text-black font-bold cursor-pointer"
                            >
                                [VIEW_SELECTED_WORKS →]
                            </Link>
                            <Link
                                to="/archive"
                                onClick={handleNavLinkClick}
                                className="text-neutral-400 hover:bg-white hover:text-black cursor-pointer"
                            >
                                [SYSTEM_ARCHIVE →]
                            </Link>
                            <Link
                                to="/about"
                                onClick={handleNavLinkClick}
                                className="text-neutral-400 hover:bg-white hover:text-black cursor-pointer"
                            >
                                [ABOUT_INFO →]
                            </Link>
                            <Link
                                to="/contact"
                                onClick={handleNavLinkClick}
                                className="text-neutral-400 hover:bg-white hover:text-black cursor-pointer"
                            >
                                [CONTACT →]
                            </Link>
                        </div>
                    </div>
                )}

                <Suspense fallback={<AsciiSectionLoader />}>
                    {activeSection === "work" && (
                        <TuiWork selectedId={selectedWorkSlug} />
                    )}

                    {activeSection === "archive" && (
                        <TuiArchive />
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
                </Suspense>
            </main>

            {/* Subtle Minimal Footer with Privacy & Legal Notice */}
            <footer role="contentinfo" className="term-snap pt-[2lh] pb-[6lh] md:pb-[3lh] text-neutral-600 flex flex-wrap items-center justify-between gap-x-[2ch] uppercase z-10">
                <div className="flex items-center gap-x-[2ch] gap-y-[1lh]">
                    <span>SISYFUZ // DORUS KLEIJNE</span>
                    <span>UTRECHT, NL</span>
                </div>
                <div className="flex items-center gap-x-[2ch] gap-y-[1lh]">
                    <Link
                        to="/privacy"
                        onClick={handleNavLinkClick}
                        className={`hover:bg-white hover:text-black cursor-pointer transition-none ${
                            activeSection === "privacy" ? "text-white font-bold bg-neutral-800" : "text-neutral-500"
                        }`}
                        title="Privacyverklaring & Colofon (AVG/GDPR)"
                    >
                        [PRIVACY_&_LEGAL]
                    </Link>
                </div>
            </footer>

            {/* RAW ASCII FLOATING SEARCH BOX */}
            <div
                className="fixed z-30 select-none cursor-pointer bottom-[calc(3.75rem+env(safe-area-inset-bottom))] md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2"
                onClick={() => inputRef.current?.focus()}
            >
                <div
                    style={isLive ? { textShadow: '0 1px 3px rgba(0,0,0,0.95)' } : undefined}
                    className={`w-[38ch] xs:w-[42ch] sm:w-[48ch] font-mono uppercase transition-colors ${
                        isSearchFocused
                            ? "text-white"
                            : buffer
                            ? "text-neutral-200"
                            : "text-neutral-400 hover:text-neutral-200"
                    }`}
                >
                    {/* Top ASCII border line */}
                    <div className={`flex items-center select-none overflow-hidden whitespace-nowrap ${
                        isLive ? "text-neutral-400" : "text-neutral-600"
                    }`}>
                        <span>+--[</span>
                        <span className="text-[#ff0080] font-bold">&gt;</span>
                        <span className={`font-bold transition-colors ${
                            isSearchFocused
                                ? "text-white"
                                : isLive
                                ? "text-neutral-300"
                                : "text-neutral-400"
                        }`}>
                            SEARCH
                        </span>
                        <span>]</span>
                        <span className={`flex-1 overflow-hidden whitespace-nowrap ${
                            isLive ? "text-neutral-500" : "text-neutral-700"
                        }`}>
                            ----------------------------------------------------
                        </span>
                        <span>+</span>
                    </div>

                    {/* Middle ASCII interactive row */}
                    <div className={`flex items-center transition-colors ${
                        isLive
                            ? "bg-transparent"
                            : "bg-black/95"
                    } ${
                        isSearchFocused ? "text-white" : "text-neutral-300"
                    }`}>
                        <span className={`mr-[1ch] select-none ${
                            isLive ? "text-neutral-400" : "text-neutral-600"
                        }`}>|</span>
                        <span className="text-[#ff0080] font-bold mr-[1ch] select-none">&gt;</span>

                        <input
                            ref={inputRef}
                            type="text"
                            value={buffer}
                            placeholder={isSearchFocused ? "" : "PRESS_TO_SEARCH"}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                            onChange={(e) => handleSearchInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    submitSearch();
                                } else if (e.key === "Escape") {
                                    clearSearch();
                                }
                            }}
                            className={`bg-transparent text-white font-mono uppercase outline-none border-none p-0 flex-1 min-w-0 ${
                                isLive
                                    ? "placeholder:text-neutral-400"
                                    : "placeholder:text-neutral-600"
                            }`}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck="false"
                        />

                        {/* Blinking Pink ASCII Cursor */}
                        <span className="cell animate-pulse text-[#ff0080] font-bold select-none mr-[1ch]">
                            {isSearchFocused ? "█" : "_"}
                        </span>

                        {/* ESC Clear Button */}
                        {buffer && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    clearSearch();
                                }}
                                className="font-mono font-bold uppercase text-neutral-400 hover:bg-[#ff0080] hover:text-black cursor-pointer select-none transition-none shrink-0"
                                title="Clear query (ESC)"
                            >
                                [ESC]
                            </button>
                        )}

                        <span className={`ml-auto select-none ${
                            isLive ? "text-neutral-400" : "text-neutral-600"
                        }`}>|</span>
                    </div>

                    {/* Bottom ASCII border line */}
                    <div className={`flex items-center select-none overflow-hidden whitespace-nowrap ${
                        isLive ? "text-neutral-400" : "text-neutral-600"
                    }`}>
                        <span>+</span>
                        <span className={`flex-1 overflow-hidden whitespace-nowrap ${
                            isLive ? "text-neutral-500" : "text-neutral-700"
                        }`}>
                            ----------------------------------------------------
                        </span>
                        <span>+</span>
                    </div>
                </div>
            </div>

            {/* Mobile TUI Command Dock (<768px) */}
            <MobileCommandBar
                activeSection={activeSection}
                onLinkClick={handleNavLinkClick}
                isSearchFocused={isSearchFocused}
            />

            {/* Accessibility Settings Toolbar Modal */}
            <A11yToolbar />

        </div>
    );
}
