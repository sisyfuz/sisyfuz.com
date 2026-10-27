// src/components/MobileCommandBar.jsx
import { Link } from "react-router-dom";
import { useA11y } from "../context/A11yContext";
import { ASCII_DIVIDER } from "../utils/ascii";

const MOBILE_NAV_ITEMS = [
    { key: "work", label: "WORK" },
    { key: "archive", label: "ARCHIVE" },
    { key: "live", label: "LIVE" },
    { key: "about", label: "ABOUT" },
    { key: "contact", label: "CONTACT" },
];

// `onLinkClick` runs on every nav link click (before the router navigates) so the
// parent can reset search state; navigation itself is done by the <Link>.
export default function MobileCommandBar({ activeSection, onLinkClick, isSearchFocused = false }) {
    const { toggleA11yToolbar, isA11yToolbarOpen } = useA11y();

    return (
        <nav
            role="navigation"
            aria-label="Mobile Command Dock"
            className={`md:hidden term-dock left-0 right-0 z-40 bg-[#050505]/95 px-[2ch] flex flex-col select-none backdrop-blur-md transition-all duration-200 ${
                isSearchFocused ? "opacity-0 translate-y-full pointer-events-none" : "opacity-100 translate-y-0 pointer-events-auto"
            }`}
        >
            <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap">
                {ASCII_DIVIDER}
            </div>
            <div className="term-snap flex items-center overflow-x-auto no-scrollbar">
                {MOBILE_NAV_ITEMS.map((item) => {
                    const isActive = activeSection === item.key;
                    return (
                        <Link
                            key={item.key}
                            to={`/${item.key}`}
                            onClick={onLinkClick}
                            aria-label={`Navigate to ${item.label} section`}
                            aria-current={isActive ? "page" : undefined}
                            className={`h-[3lh] min-w-[44px] px-[1ch] font-mono uppercase flex items-center justify-center cursor-pointer transition-none shrink-0 ${
                                isActive
                                    ? "bg-pink-500 text-black font-bold"
                                    : "text-neutral-400 hover:bg-white hover:text-black"
                            }`}
                        >
                            <span>
                                [{item.label}{isActive && <> <span className="cell">●</span></>}]
                            </span>
                        </Link>
                    );
                })}

                {/* A11Y Setting Button */}
                <button
                    type="button"
                    onClick={toggleA11yToolbar}
                    aria-label="Toggle Accessibility & Performance Settings"
                    aria-expanded={isA11yToolbarOpen}
                    className={`ml-auto h-[3lh] min-w-[44px] px-[1ch] font-mono uppercase flex items-center justify-center cursor-pointer transition-none shrink-0 ${
                        isA11yToolbarOpen
                            ? "bg-[#ff0080] text-black font-bold"
                            : "text-[#ff0080] hover:bg-[#ff0080] hover:text-black"
                    }`}
                >
                    <span>[A11Y]</span>
                </button>
            </div>
        </nav>
    );
}
