// src/components/A11yToolbar.jsx
import { useEffect, useRef } from "react";
import { useA11y } from "../context/A11yContext";
import { ASCII_DIVIDER } from "../utils/ascii";

export default function A11yToolbar() {
    const {
        isA11yToolbarOpen,
        toggleA11yToolbar,
        reducedMotion,
        toggleReducedMotion,
        highLegibilityFont,
        toggleHighLegibilityFont,
        highContrast,
        toggleHighContrast,
        lowPowerMode,
        toggleLowPowerMode,
        asciiAltMode,
        toggleAsciiAltMode,
        resetA11yPreferences,
    } = useA11y();

    const dialogRef = useRef(null);
    const closeBtnRef = useRef(null);
    const triggerRef = useRef(null);

    // Save previous active element for focus restoration on close
    useEffect(() => {
        if (isA11yToolbarOpen) {
            triggerRef.current = document.activeElement;
        } else if (triggerRef.current && typeof triggerRef.current.focus === "function") {
            try {
                triggerRef.current.focus();
            } catch { /* best-effort: ignore */ }
            triggerRef.current = null;
        }
    }, [isA11yToolbarOpen]);

    // Focus management, focus trap, and Escape key listener
    useEffect(() => {
        if (!isA11yToolbarOpen) return;

        // Autofocus close button on modal open
        try {
            closeBtnRef.current?.focus();
        } catch { /* best-effort: ignore */ }

        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                toggleA11yToolbar();
                return;
            }

            if (e.key === "Tab" && dialogRef.current) {
                const focusable = dialogRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusable.length === 0) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isA11yToolbarOpen, toggleA11yToolbar]);

    if (!isA11yToolbarOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center px-[2ch] py-[1lh] bg-black/85 backdrop-blur-xs select-none"
            onClick={toggleA11yToolbar}
            role="presentation"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="a11y-toolbar-title"
                aria-describedby="a11y-toolbar-desc"
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[64ch] bg-[#050505] text-[#f0f0f0] font-mono shadow-2xl px-[2ch] py-[1lh] sm:px-[3ch] sm:py-[1lh] space-y-[1lh] focus:outline-none"
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <div id="a11y-toolbar-title" className="font-bold text-white flex items-center gap-x-[1ch]">
                            <span className="text-[#ff0080] font-bold">&gt;</span>
                            <span>[ACCESSIBILITY & PERFORMANCE // A11Y]</span>
                        </div>
                        <p id="a11y-toolbar-desc" className="sr-only">
                            Configure accessibility options including reduced motion, high-legibility typography, contrast enhancements, and power saving modes.
                        </p>
                    </div>
                    <button
                        ref={closeBtnRef}
                        type="button"
                        onClick={toggleA11yToolbar}
                        className="touch-target text-neutral-400 hover:bg-white hover:text-black font-bold uppercase cursor-pointer transition-none"
                        aria-label="Close accessibility toolbar (Escape)"
                    >
                        [ESC / CLOSE ✕]
                    </button>
                </div>

                <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>

                {/* Options List */}
                <div className="">
                    {/* 1. Reduced Motion */}
                    <div className="px-[1ch] -mx-[1ch] hover:bg-neutral-900/50 transition-none">
                        <div className="flex flex-wrap items-center justify-between gap-x-[1ch]">
                            <span className="font-bold uppercase text-white">
                                01 // REDUCED MOTION
                            </span>
                            <button
                                type="button"
                                onClick={toggleReducedMotion}
                                className={`touch-target px-[1ch] font-bold uppercase cursor-pointer transition-none ${
                                    reducedMotion
                                        ? "bg-pink-500 text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                aria-label={`Toggle Reduced Motion (currently ${reducedMotion ? "reduced" : "normal"})`}
                                aria-pressed={reducedMotion}
                            >
                                {reducedMotion ? <span>[REDUCED <span className="cell">●</span>]</span> : <span>[NORMAL <span className="cell">○</span>]</span>}
                            </button>
                        </div>
                        <p className="text-neutral-400">
                            Pauses rapid canvas animations, disco hue-rotation, and decorative scanlines.
                        </p>
                    </div>

                    {/* 2. High-Legibility Font */}
                    <div className="px-[1ch] -mx-[1ch] hover:bg-neutral-900/50 transition-none">
                        <div className="flex flex-wrap items-center justify-between gap-x-[1ch]">
                            <span className="font-bold uppercase text-white">
                                02 // HIGH-LEGIBILITY FONT
                            </span>
                            <button
                                type="button"
                                onClick={toggleHighLegibilityFont}
                                className={`touch-target px-[1ch] font-bold uppercase cursor-pointer transition-none ${
                                    highLegibilityFont
                                        ? "bg-pink-500 text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                aria-label={`Toggle High-Legibility Font (currently ${highLegibilityFont ? "sans-serif font" : "brutalist monospace"})`}
                                aria-pressed={highLegibilityFont}
                            >
                                {highLegibilityFont ? <span>[SANS FONT <span className="cell">●</span>]</span> : <span>[BRUTALIST MONO <span className="cell">○</span>]</span>}
                            </button>
                        </div>
                        <p className="text-neutral-400">
                            Replaces monospaced type with clean, high-readability sans-serif for improved legibility.
                        </p>
                    </div>

                    {/* 3. High Contrast */}
                    <div className="px-[1ch] -mx-[1ch] hover:bg-neutral-900/50 transition-none">
                        <div className="flex flex-wrap items-center justify-between gap-x-[1ch]">
                            <span className="font-bold uppercase text-white">
                                03 // HIGH CONTRAST
                            </span>
                            <button
                                type="button"
                                onClick={toggleHighContrast}
                                className={`touch-target px-[1ch] font-bold uppercase cursor-pointer transition-none ${
                                    highContrast
                                        ? "bg-pink-500 text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                aria-label={`Toggle High Contrast (currently ${highContrast ? "enhanced contrast" : "standard contrast"})`}
                                aria-pressed={highContrast}
                            >
                                {highContrast ? <span>[ENHANCED <span className="cell">●</span>]</span> : <span>[STANDARD <span className="cell">○</span>]</span>}
                            </button>
                        </div>
                        <p className="text-neutral-400">
                            Maximizes luminance contrast for low-vision environments.
                        </p>
                    </div>

                    {/* 4. Low Power & 30 FPS Cap */}
                    <div className="px-[1ch] -mx-[1ch] hover:bg-neutral-900/50 transition-none">
                        <div className="flex flex-wrap items-center justify-between gap-x-[1ch]">
                            <span className="font-bold uppercase text-white">
                                04 // LOW POWER ENGINE (30 FPS)
                            </span>
                            <button
                                type="button"
                                onClick={toggleLowPowerMode}
                                className={`touch-target px-[1ch] font-bold uppercase cursor-pointer transition-none ${
                                    lowPowerMode
                                        ? "bg-pink-500 text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                aria-label={`Toggle Low Power Engine (currently ${lowPowerMode ? "30 FPS capped" : "60 FPS full power"})`}
                                aria-pressed={lowPowerMode}
                            >
                                {lowPowerMode ? <span>[30 FPS CAP <span className="cell">●</span>]</span> : <span>[60 FPS <span className="cell">○</span>]</span>}
                            </button>
                        </div>
                        <p className="text-neutral-400">
                            Caps render loops to 30 FPS to reduce CPU/GPU heat and extend mobile battery life.
                        </p>
                    </div>

                    {/* 5. Plain Media Alternative */}
                    <div className="px-[1ch] -mx-[1ch] hover:bg-neutral-900/50 transition-none">
                        <div className="flex flex-wrap items-center justify-between gap-x-[1ch]">
                            <span className="font-bold uppercase text-white">
                                05 // PLAIN MEDIA ALTERNATIVE
                            </span>
                            <button
                                type="button"
                                onClick={toggleAsciiAltMode}
                                className={`touch-target px-[1ch] font-bold uppercase cursor-pointer transition-none ${
                                    asciiAltMode
                                        ? "bg-pink-500 text-black"
                                        : "text-neutral-400 hover:bg-white hover:text-black"
                                }`}
                                aria-label={`Toggle Plain Media Alternative (currently ${asciiAltMode ? "plain photographic images" : "ASCII character shaders"})`}
                                aria-pressed={asciiAltMode}
                            >
                                {asciiAltMode ? <span>[PLAIN MEDIA <span className="cell">●</span>]</span> : <span>[ASCII SHADERS <span className="cell">○</span>]</span>}
                            </button>
                        </div>
                        <p className="text-neutral-400">
                            Renders clean photographic assets directly without ASCII character quantization.
                        </p>
                    </div>
                </div>

                {/* Footer Controls */}
                <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>
                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={resetA11yPreferences}
                        aria-label="Reset all accessibility preferences to defaults"
                        className="touch-target text-neutral-500 hover:bg-white hover:text-black cursor-pointer transition-none uppercase"
                    >
                        [RESET_ALL_DEFAULTS]
                    </button>
                    <span className="text-neutral-600 uppercase">
                        PREFERENCES SAVED LOCALLY
                    </span>
                </div>
            </div>
        </div>
    );
}
