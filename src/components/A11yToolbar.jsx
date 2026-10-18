// src/components/A11yToolbar.jsx
import { useEffect, useRef } from "react";
import { useA11y } from "../context/A11yContext";

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
            } catch {}
            triggerRef.current = null;
        }
    }, [isA11yToolbarOpen]);

    // Focus management, focus trap, and Escape key listener
    useEffect(() => {
        if (!isA11yToolbarOpen) return;

        // Autofocus close button on modal open
        try {
            closeBtnRef.current?.focus();
        } catch {}

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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none"
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
                className="w-full max-w-lg bg-[#0a0a0a] border border-neutral-600 text-[#f0f0f0] font-mono text-xs sm:text-sm shadow-2xl p-4 sm:p-6 space-y-5 animate-fadeIn focus:outline-none"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-neutral-700 pb-3">
                    <div>
                        <div id="a11y-toolbar-title" className="font-bold text-white flex items-center gap-2">
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
                        className="touch-target border border-neutral-600 px-2 py-1 text-[11px] font-bold uppercase hover:bg-[#ff0080] hover:text-black hover:border-[#ff0080] focus:outline-2 focus:outline-[#ff0080] cursor-pointer transition-colors"
                        aria-label="Close accessibility toolbar (Escape)"
                    >
                        [ESC / CLOSE ✕]
                    </button>
                </div>

                {/* Options List */}
                <div className="space-y-4">
                    {/* 1. Reduced Motion */}
                    <div className="border border-neutral-800 p-3 space-y-2 hover:border-neutral-700 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold uppercase text-white">
                                01 // REDUCED MOTION
                            </span>
                            <button
                                type="button"
                                onClick={toggleReducedMotion}
                                className={`touch-target px-3 py-1 font-bold uppercase text-xs cursor-pointer border transition-colors focus:outline-2 focus:outline-[#ff0080] ${
                                    reducedMotion
                                        ? "bg-pink-500 text-black border-pink-500"
                                        : "bg-transparent text-neutral-400 border-neutral-700 hover:text-white hover:border-white"
                                }`}
                                aria-label={`Toggle Reduced Motion (currently ${reducedMotion ? "reduced" : "normal"})`}
                                aria-pressed={reducedMotion}
                            >
                                {reducedMotion ? "[REDUCED ●]" : "[NORMAL ○]"}
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-normal">
                            Pauses rapid canvas animations, disco hue-rotation, and decorative scanlines.
                        </p>
                    </div>

                    {/* 2. High-Legibility Font */}
                    <div className="border border-neutral-800 p-3 space-y-2 hover:border-neutral-700 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold uppercase text-white">
                                02 // HIGH-LEGIBILITY FONT
                            </span>
                            <button
                                type="button"
                                onClick={toggleHighLegibilityFont}
                                className={`touch-target px-3 py-1 font-bold uppercase text-xs cursor-pointer border transition-colors focus:outline-2 focus:outline-[#ff0080] ${
                                    highLegibilityFont
                                        ? "bg-pink-500 text-black border-pink-500"
                                        : "bg-transparent text-neutral-400 border-neutral-700 hover:text-white hover:border-white"
                                }`}
                                aria-label={`Toggle High-Legibility Font (currently ${highLegibilityFont ? "sans-serif font" : "brutalist monospace"})`}
                                aria-pressed={highLegibilityFont}
                            >
                                {highLegibilityFont ? "[SANS FONT ●]" : "[BRUTALIST MONO ○]"}
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-normal">
                            Replaces monospaced type with clean, high-readability sans-serif for improved legibility.
                        </p>
                    </div>

                    {/* 3. High Contrast */}
                    <div className="border border-neutral-800 p-3 space-y-2 hover:border-neutral-700 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold uppercase text-white">
                                03 // HIGH CONTRAST
                            </span>
                            <button
                                type="button"
                                onClick={toggleHighContrast}
                                className={`touch-target px-3 py-1 font-bold uppercase text-xs cursor-pointer border transition-colors focus:outline-2 focus:outline-[#ff0080] ${
                                    highContrast
                                        ? "bg-pink-500 text-black border-pink-500"
                                        : "bg-transparent text-neutral-400 border-neutral-700 hover:text-white hover:border-white"
                                }`}
                                aria-label={`Toggle High Contrast (currently ${highContrast ? "enhanced contrast" : "standard contrast"})`}
                                aria-pressed={highContrast}
                            >
                                {highContrast ? "[ENHANCED ●]" : "[STANDARD ○]"}
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-normal">
                            Maximizes border clarity and luminance contrast for low-vision environments.
                        </p>
                    </div>

                    {/* 4. Low Power & 30 FPS Cap */}
                    <div className="border border-neutral-800 p-3 space-y-2 hover:border-neutral-700 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold uppercase text-white">
                                04 // LOW POWER ENGINE (30 FPS)
                            </span>
                            <button
                                type="button"
                                onClick={toggleLowPowerMode}
                                className={`touch-target px-3 py-1 font-bold uppercase text-xs cursor-pointer border transition-colors focus:outline-2 focus:outline-[#ff0080] ${
                                    lowPowerMode
                                        ? "bg-pink-500 text-black border-pink-500"
                                        : "bg-transparent text-neutral-400 border-neutral-700 hover:text-white hover:border-white"
                                }`}
                                aria-label={`Toggle Low Power Engine (currently ${lowPowerMode ? "30 FPS capped" : "60 FPS full power"})`}
                                aria-pressed={lowPowerMode}
                            >
                                {lowPowerMode ? "[30 FPS CAP ●]" : "[60 FPS ○]"}
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-normal">
                            Caps render loops to 30 FPS to reduce CPU/GPU heat and extend mobile battery life.
                        </p>
                    </div>

                    {/* 5. Plain Media Alternative */}
                    <div className="border border-neutral-800 p-3 space-y-2 hover:border-neutral-700 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold uppercase text-white">
                                05 // PLAIN MEDIA ALTERNATIVE
                            </span>
                            <button
                                type="button"
                                onClick={toggleAsciiAltMode}
                                className={`touch-target px-3 py-1 font-bold uppercase text-xs cursor-pointer border transition-colors focus:outline-2 focus:outline-[#ff0080] ${
                                    asciiAltMode
                                        ? "bg-pink-500 text-black border-pink-500"
                                        : "bg-transparent text-neutral-400 border-neutral-700 hover:text-white hover:border-white"
                                }`}
                                aria-label={`Toggle Plain Media Alternative (currently ${asciiAltMode ? "plain photographic images" : "ASCII character shaders"})`}
                                aria-pressed={asciiAltMode}
                            >
                                {asciiAltMode ? "[PLAIN MEDIA ●]" : "[ASCII SHADERS ○]"}
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-normal">
                            Renders clean photographic assets directly without ASCII character quantization.
                        </p>
                    </div>
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-2 border-t border-neutral-800 text-[11px]">
                    <button
                        type="button"
                        onClick={resetA11yPreferences}
                        aria-label="Reset all accessibility preferences to defaults"
                        className="touch-target text-neutral-500 hover:text-white hover:underline focus:outline-2 focus:outline-[#ff0080] cursor-pointer"
                    >
                        [RESET_ALL_DEFAULTS]
                    </button>
                    <span className="text-neutral-600">
                        PREFERENCES SAVED LOCALLY
                    </span>
                </div>
            </div>
        </div>
    );
}
