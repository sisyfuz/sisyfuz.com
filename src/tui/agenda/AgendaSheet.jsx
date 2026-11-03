// src/tui/agenda/AgendaSheet.jsx
import { useEffect, useId, useRef } from "react";
import AgendaGutter from "./AgendaGutter";
import { BTN_PLAIN } from "./ui";

// Full screen on phones. From lg (the desktop layout) it docks over the list
// column, so the month stays in view: a │ column at 86ch and content from 88ch,
// exactly where the list starts. Laid out on the page grid either way. Locks page
// scroll, closes on Escape and returns focus to whatever opened it. Sheets can
// stack (the sticker editor opens over the form); Escape closes only the top one.
const open = [];

export default function AgendaSheet({ title, onClose, wide = false, children }) {
    const titleId = useId();
    const panelRef = useRef(null);

    useEffect(() => {
        const self = {};
        open.push(self);
        const opener = document.activeElement;
        const { overflow } = document.body.style;
        document.body.style.overflow = "hidden";
        panelRef.current?.focus();

        const onKey = (e) => {
            if (e.key === "Escape" && open[open.length - 1] === self) {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            open.splice(open.indexOf(self), 1);
            document.body.style.overflow = overflow;
            try {
                opener?.focus?.();
            } catch {
                // opener is gone
            }
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 bg-[#050505] flex lg:left-[86ch]">
            <div className="hidden lg:flex">
                <AgendaGutter color="#333333" />
            </div>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="flex-1 min-w-0 h-full overflow-y-auto overscroll-contain outline-none px-[2ch] lg:pl-[1ch] lg:pr-[4ch] pt-[1lh] pb-[calc(3lh+env(safe-area-inset-bottom))]"
            >
                <div className={`term-snap ${wide ? "max-w-[72ch]" : "max-w-[64ch]"}`}>
                    <div className="flex items-start justify-between gap-x-[2ch]">
                        <h2 id={titleId} className="font-bold uppercase text-white min-w-0 break-words pt-[1lh]">
                            {title}
                        </h2>
                        <button type="button" onClick={onClose} className={BTN_PLAIN} aria-label="Sluiten">
                            [SLUIT ×]
                        </button>
                    </div>
                    <div aria-hidden="true" className="text-neutral-700 overflow-hidden whitespace-nowrap mb-[1lh]">
                        {"-".repeat(240)}
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}
