// src/tui/agenda/AgendaSheet.jsx
import { useEffect, useId, useRef } from "react";
import { ASCII_DIVIDER } from "../../utils/ascii";
import { BTN_PLAIN } from "./ui";

// Full-screen panel on phones, a centered box from md up. Locks page scroll,
// closes on Escape and returns focus to whatever opened it.
export default function AgendaSheet({ title, onClose, children }) {
    const titleId = useId();
    const panelRef = useRef(null);

    useEffect(() => {
        const opener = document.activeElement;
        const { overflow } = document.body.style;
        document.body.style.overflow = "hidden";
        panelRef.current?.focus();

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = overflow;
            try {
                opener?.focus?.();
            } catch {
                // opener is gone
            }
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex md:items-center md:justify-center animate-fadeIn">
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="w-full h-full md:h-auto md:max-h-[90dvh] md:max-w-[64ch] bg-[#050505] md:border md:border-[#333] overflow-y-auto overscroll-contain outline-none px-[2ch] pt-[1lh] pb-[calc(3lh+env(safe-area-inset-bottom))]"
            >
                <div className="flex items-center justify-between gap-x-[2ch]">
                    <h2 id={titleId} className="font-bold uppercase text-white min-w-0 break-words">
                        {title}
                    </h2>
                    <button type="button" onClick={onClose} className={BTN_PLAIN} aria-label="Sluiten">
                        [SLUIT ×]
                    </button>
                </div>
                <div aria-hidden="true" className="text-neutral-700 overflow-hidden whitespace-nowrap mb-[1lh]">
                    {ASCII_DIVIDER}
                </div>
                {children}
            </div>
        </div>
    );
}
