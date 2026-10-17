// src/context/TerminalThemeContext.jsx
import { createContext, useContext, useState, useEffect } from "react";

const THEMES = {
    pink: {
        id: "pink",
        name: "SISYFUZ_PINK",
        bg: "bg-[#050505]",
        text: "text-neutral-100",
        accent: "text-[#ff0080]",
        accentBg: "bg-[#ff0080]",
        border: "border-[#ff0080]/40",
        glow: "drop-shadow-[0_0_10px_rgba(255,0,128,0.35)]",
        prompt: "#ff0080",
    },
    green: {
        id: "green",
        name: "MATRIX_GREEN",
        bg: "bg-[#030d05]",
        text: "text-[#00ff66]",
        accent: "text-[#33ff88]",
        accentBg: "bg-[#00ff66]",
        border: "border-[#00ff66]/40",
        glow: "drop-shadow-[0_0_10px_rgba(0,255,102,0.35)]",
        prompt: "#00ff66",
    },
    amber: {
        id: "amber",
        name: "VT220_AMBER",
        bg: "bg-[#0d0700]",
        text: "text-[#ffb000]",
        accent: "text-[#ffc84d]",
        accentBg: "bg-[#ffb000]",
        border: "border-[#ffb000]/40",
        glow: "drop-shadow-[0_0_10px_rgba(255,176,0,0.35)]",
        prompt: "#ffb000",
    },
    mono: {
        id: "mono",
        name: "PURE_MONOLITH",
        bg: "bg-black",
        text: "text-white",
        accent: "text-white",
        accentBg: "bg-white",
        border: "border-white/40",
        glow: "drop-shadow-[0_0_10px_rgba(255,255,255,0.25)]",
        prompt: "#ffffff",
    },
};

const TerminalThemeContext = createContext();

export function TerminalThemeProvider({ children }) {
    const [themeKey, setThemeKey] = useState("pink");

    const setTheme = (key) => {
        const lower = String(key).toLowerCase().trim();
        if (THEMES[lower]) {
            setThemeKey(lower);
            localStorage.setItem("sisyfuz_theme", lower);
            return true;
        }
        return false;
    };

    useEffect(() => {
        const saved = localStorage.getItem("sisyfuz_theme");
        if (saved && THEMES[saved]) {
            setThemeKey(saved);
        }
    }, []);

    const theme = THEMES[themeKey] || THEMES.pink;

    return (
        <TerminalThemeContext.Provider value={{ theme, themeKey, setTheme, availableThemes: Object.keys(THEMES) }}>
            {children}
        </TerminalThemeContext.Provider>
    );
}

export const useTerminalTheme = () => useContext(TerminalThemeContext);
