// src/tui/agenda/AgendaStickerTray.jsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { positionAt } from "../../utils/agendaStickerPlace";
import StickerImage from "./StickerImage";
import { BTN_PLAIN, BTN_PRIMARY } from "./ui";

// The sticker tray in the bottom bar: drag a sticker out of it and drop it on any
// appointment. Pointer events instead of HTML drag and drop, so it works with a
// finger too. Swiping sideways scrolls the tray; a drag starts once the finger
// moves up or far enough. Near the top or bottom of the screen the page scrolls.
const DRAG_START_PX = 8;
const EDGE_PX = 64;
const SCROLL_STEP = 10;

function cardAt(x, y) {
    return document.elementFromPoint(x, y)?.closest("[data-item-id]") ?? null;
}

export default function AgendaStickerTray({ stickers, busy, onDrop, onDraw, onImport, onClose }) {
    const [drag, setDrag] = useState(null);
    const [hint, setHint] = useState("");
    const press = useRef(null);
    const target = useRef(null);
    const ghostRef = useRef(null);
    const trayRef = useRef(null);

    const mark = (card) => {
        if (target.current === card) return;
        if (target.current) target.current.style.backgroundColor = "";
        if (card) card.style.backgroundColor = "#1c1c1c";
        target.current = card;
    };

    // Scroll the page while a dragged sticker is held near the top or the tray.
    useEffect(() => {
        if (!drag) return undefined;
        const timer = setInterval(() => {
            const p = press.current;
            if (!p) return;
            const trayTop = trayRef.current?.getBoundingClientRect().top ?? window.innerHeight;
            if (p.y < EDGE_PX) window.scrollBy(0, -SCROLL_STEP);
            else if (p.y > trayTop - EDGE_PX / 2) window.scrollBy(0, SCROLL_STEP);
            mark(cardAt(p.x, p.y));
        }, 16);
        return () => clearInterval(timer);
    }, [drag]);

    useEffect(() => () => mark(null), []);

    const down = (e, sticker) => {
        if (busy) return;
        press.current = { id: e.pointerId, sticker, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, dragging: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const move = (e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (!p.dragging) {
            const dy = p.sy - p.y;
            if (dy < DRAG_START_PX && Math.hypot(p.x - p.sx, p.y - p.sy) < DRAG_START_PX * 3) return;
            p.dragging = true;
            setHint("");
        }
        setDrag({ sticker: p.sticker, x: p.x, y: p.y });
        mark(cardAt(p.x, p.y));
    };

    const up = (e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        press.current = null;
        const card = p.dragging ? cardAt(e.clientX, e.clientY) : null;
        const width = ghostRef.current?.offsetWidth;
        mark(null);
        setDrag(null);
        if (!p.dragging) setHint("SLEEP HEM NAAR EEN AFSPRAAK");
        else if (card) onDrop(card.dataset.itemId, p.sticker, positionAt(card, e.clientX, e.clientY, width));
    };

    const cancel = () => {
        press.current = null;
        mark(null);
        setDrag(null);
    };

    return (
        <div ref={trayRef} className="w-full min-w-0 px-[1ch]">
            <div className="flex items-center gap-x-[1ch]">
                <span className="text-neutral-400 uppercase min-w-0 truncate">{hint || "SLEEP EEN STICKER OP EEN AFSPRAAK"}</span>
                <button type="button" onClick={onClose} className={`${BTN_PRIMARY} ml-auto -mr-[1ch]`}>
                    [KLAAR]
                </button>
            </div>
            {stickers.length ? (
                <div className="flex gap-x-[1ch] overflow-x-auto no-scrollbar h-[5lh]">
                    {stickers.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            aria-label={`Sticker ${s.name || ""}`.trim()}
                            onPointerDown={(e) => down(e, s)}
                            onPointerMove={move}
                            onPointerUp={up}
                            onPointerCancel={cancel}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`shrink-0 cursor-grab select-none touch-pan-x ${drag?.sticker.id === s.id ? "opacity-30" : ""}`}
                            style={{ WebkitTouchCallout: "none" }}
                        >
                            <StickerImage sticker={s} />
                        </button>
                    ))}
                </div>
            ) : (
                <div className="flex gap-x-[1ch] -ml-[1ch] h-[5lh]">
                    <button type="button" onClick={onDraw} className={BTN_PLAIN}>
                        [✎ TEKENEN]
                    </button>
                    <button type="button" onClick={onImport} className={BTN_PLAIN}>
                        [+ IMPORTEREN]
                    </button>
                </div>
            )}
            {/* In <body>, not in the bar: the bar's backdrop blur makes `fixed` count
                from the bar instead of the screen, which put it far below the pointer. */}
            {drag &&
                createPortal(
                    <span
                        ref={ghostRef}
                        aria-hidden="true"
                        className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2"
                        style={{ left: drag.x, top: drag.y }}
                    >
                        <StickerImage sticker={drag.sticker} />
                    </span>,
                    document.body
                )}
        </div>
    );
}
