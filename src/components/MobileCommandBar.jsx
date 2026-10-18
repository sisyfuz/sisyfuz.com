// src/components/MobileCommandBar.jsx
import { useA11y } from "../context/A11yContext";

const MOBILE_NAV_ITEMS = [
    { key: "work", label: "WORK" },
    { key: "archive", label: "ARCHIVE" },
    { key: "live", label: "LIVE" },
    { key: "about", label: "ABOUT" },
    { key: "contact", label: "CONTACT" },
];

export default function MobileCommandBar({ activeSection, onNavigate, isSearchFocused = false }) {
    const { toggleA11yToolbar, isA11yToolbarOpen } = useA11y();

    return (
        <nav
            role="navigation"
            aria-label="Mobile Command Dock"
            className={`md:hidden fixed bottom-0 left-0 right-0 z-40 bg-black/95 border-t border-neutral-800 px-2 py-1 flex items-center justify-between select-none shadow-2xl backdrop-blur-md transition-all duration-200 ${
                isSearchFocused ? "opacity-0 translate-y-full pointer-events-none" : "opacity-100 translate-y-0 pointer-events-auto"
            }`}
            style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
        >
            <div className="flex items-center justify-between w-full gap-1 overflow-x-auto no-scrollbar">
                {MOBILE_NAV_ITEMS.map((item) => {
                    const isActive = activeSection === item.key;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => onNavigate(item.key)}
                            aria-label={`Navigate to ${item.label} section`}
                            aria-current={isActive ? "page" : undefined}
                            className={`min-h-[44px] min-w-[44px] px-2 py-1 font-mono text-[11px] uppercase tracking-wider flex items-center justify-center cursor-pointer transition-colors shrink-0 ${
                                isActive
                                    ? "bg-pink-500 text-black font-bold"
                                    : "text-neutral-400 hover:text-white hover:bg-neutral-900"
                            }`}
                        >
                            <span>
                                [{item.label}{isActive ? " ●" : ""}]
                            </span>
                        </button>
                    );
                })}

                {/* A11Y Setting Button */}
                <button
                    type="button"
                    onClick={toggleA11yToolbar}
                    aria-label="Toggle Accessibility & Performance Settings"
                    aria-expanded={isA11yToolbarOpen}
                    className={`min-h-[44px] min-w-[44px] px-2 py-1 font-mono text-[11px] uppercase tracking-wider flex items-center justify-center cursor-pointer transition-colors shrink-0 ${
                        isA11yToolbarOpen
                            ? "bg-[#ff0080] text-black font-bold"
                            : "text-[#ff0080] border border-[#ff0080]/40 hover:bg-[#ff0080] hover:text-black"
                    }`}
                >
                    <span>[A11Y]</span>
                </button>
            </div>
        </nav>
    );
}
