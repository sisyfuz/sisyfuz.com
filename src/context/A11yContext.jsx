// src/context/A11yContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";

const A11yContext = createContext(null);

const STORAGE_KEY = "sisyfuz_a11y";

function getSystemReducedMotion() {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

function getSystemLowPowerDefault() {
    if (typeof window === "undefined") return false;
    // Default to low-power (30 FPS) if on mobile or low core count
    const isMobile = window.innerWidth < 768 || (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
    const isLowCore = typeof navigator !== "undefined" && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    return Boolean(isMobile || isLowCore);
}

function loadSavedPreferences() {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
        }
    } catch (e) {
        console.warn("Failed to load a11y preferences from localStorage:", e);
    }
    return {};
}

export function A11yProvider({ children }) {
    const saved = loadSavedPreferences();

    const [reducedMotion, setReducedMotionState] = useState(() => {
        if (typeof saved.reducedMotion === "boolean") return saved.reducedMotion;
        return getSystemReducedMotion();
    });

    const [highLegibilityFont, setHighLegibilityFontState] = useState(() => {
        return Boolean(saved.highLegibilityFont);
    });

    const [highContrast, setHighContrastState] = useState(() => {
        return Boolean(saved.highContrast);
    });

    const [lowPowerMode, setLowPowerModeState] = useState(() => {
        if (typeof saved.lowPowerMode === "boolean") return saved.lowPowerMode;
        return getSystemLowPowerDefault();
    });

    const [asciiAltMode, setAsciiAltModeState] = useState(() => {
        return Boolean(saved.asciiAltMode);
    });

    const [isA11yToolbarOpen, setIsA11yToolbarOpen] = useState(false);

    // Save preferences to localStorage whenever they change
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const state = {
                reducedMotion,
                highLegibilityFont,
                highContrast,
                lowPowerMode,
                asciiAltMode,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("Failed to save a11y preferences:", e);
        }
    }, [reducedMotion, highLegibilityFont, highContrast, lowPowerMode, asciiAltMode]);

    // Apply classes to root <html> element for CSS styling
    useEffect(() => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;

        if (reducedMotion) {
            root.classList.add("reduced-motion");
        } else {
            root.classList.remove("reduced-motion");
        }

        if (highLegibilityFont) {
            root.classList.add("high-legibility");
        } else {
            root.classList.remove("high-legibility");
        }

        if (highContrast) {
            root.classList.add("high-contrast");
        } else {
            root.classList.remove("high-contrast");
        }

        if (lowPowerMode) {
            root.classList.add("low-power");
        } else {
            root.classList.remove("low-power");
        }
    }, [reducedMotion, highLegibilityFont, highContrast, lowPowerMode]);

    // Listen to system prefers-reduced-motion media query changes
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        try {
            const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
            if (!mediaQuery) return;

            const handler = (e) => {
                const currentSaved = loadSavedPreferences();
                // Only update if user hasn't explicitly set in localStorage
                if (currentSaved.reducedMotion === undefined) {
                    setReducedMotionState(Boolean(e.matches));
                }
            };

            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener("change", handler);
                return () => mediaQuery.removeEventListener("change", handler);
            } else if (mediaQuery.addListener) {
                mediaQuery.addListener(handler);
                return () => mediaQuery.removeListener(handler);
            }
        } catch { /* best-effort: ignore */ }
    }, []);

    const toggleReducedMotion = useCallback(() => {
        setReducedMotionState(prev => !prev);
    }, []);

    const toggleHighLegibilityFont = useCallback(() => {
        setHighLegibilityFontState(prev => !prev);
    }, []);

    const toggleHighContrast = useCallback(() => {
        setHighContrastState(prev => !prev);
    }, []);

    const toggleLowPowerMode = useCallback(() => {
        setLowPowerModeState(prev => !prev);
    }, []);

    const toggleAsciiAltMode = useCallback(() => {
        setAsciiAltModeState(prev => !prev);
    }, []);

    const toggleA11yToolbar = useCallback(() => {
        setIsA11yToolbarOpen(prev => !prev);
    }, []);

    const resetA11yPreferences = useCallback(() => {
        const defaultMotion = getSystemReducedMotion();
        const defaultLowPower = getSystemLowPowerDefault();
        setReducedMotionState(defaultMotion);
        setHighLegibilityFontState(false);
        setHighContrastState(false);
        setLowPowerModeState(defaultLowPower);
        setAsciiAltModeState(false);
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // ignore
        }
    }, []);

    return (
        <A11yContext.Provider value={{
            reducedMotion,
            setReducedMotion: setReducedMotionState,
            toggleReducedMotion,

            highLegibilityFont,
            setHighLegibilityFont: setHighLegibilityFontState,
            toggleHighLegibilityFont,

            highContrast,
            setHighContrast: setHighContrastState,
            toggleHighContrast,

            lowPowerMode,
            setLowPowerMode: setLowPowerModeState,
            toggleLowPowerMode,

            asciiAltMode,
            setAsciiAltMode: setAsciiAltModeState,
            toggleAsciiAltMode,

            isA11yToolbarOpen,
            setIsA11yToolbarOpen,
            toggleA11yToolbar,

            resetA11yPreferences,
        }}>
            {children}
        </A11yContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useA11y() {
    const context = useContext(A11yContext);
    if (!context) {
        // Fallback default state if used outside provider
        return {
            reducedMotion: false,
            setReducedMotion: () => {},
            toggleReducedMotion: () => {},
            highLegibilityFont: false,
            setHighLegibilityFont: () => {},
            toggleHighLegibilityFont: () => {},
            highContrast: false,
            setHighContrast: () => {},
            toggleHighContrast: () => {},
            lowPowerMode: false,
            setLowPowerMode: () => {},
            toggleLowPowerMode: () => {},
            asciiAltMode: false,
            setAsciiAltMode: () => {},
            toggleAsciiAltMode: () => {},
            isA11yToolbarOpen: false,
            setIsA11yToolbarOpen: () => {},
            toggleA11yToolbar: () => {},
            resetA11yPreferences: () => {},
        };
    }
    return context;
}
