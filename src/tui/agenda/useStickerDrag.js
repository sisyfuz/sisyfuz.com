// src/tui/agenda/useStickerDrag.js
import { useCallback, useEffect, useRef, useState } from "react";
import { dropTargetAt } from "../../utils/agendaStickerPlace";

// Dragging a sticker anywhere in the agenda: out of the tray, or a day sticker
// that was picked up with three taps. Pointer events on the window, so it works
// with a finger too. A drag from the tray starts once the finger moves up or far
// enough (swiping sideways scrolls the tray); a picked-up sticker moves at once.
// Near the top of the screen or the bottom bar the page scrolls along. The thing
// under the pointer lights up. `onDrop(target, sticker, payload)` gets what
// dropTargetAt() found.
const DRAG_START_PX = 8;
const EDGE_PX = 64;
const SCROLL_STEP = 10;
const LIT = "#1c1c1c";

export default function useStickerDrag(onDrop) {
    const [drag, setDrag] = useState(null);
    const press = useRef(null);
    const lit = useRef(null);
    const ghostRef = useRef(null);
    const dropRef = useRef(onDrop);

    useEffect(() => {
        dropRef.current = onDrop;
    }, [onDrop]);

    const light = (el) => {
        if (lit.current === el) return;
        if (lit.current) lit.current.style.backgroundColor = "";
        if (el) el.style.backgroundColor = LIT;
        lit.current = el;
    };
    const size = () => {
        const g = ghostRef.current;
        return g ? [g.offsetWidth, g.offsetHeight] : [64, 64];
    };

    const stop = useCallback(() => {
        press.current = null;
        light(null);
        setDrag(null);
    }, []);

    useEffect(() => {
        const move = (e) => {
            const p = press.current;
            if (!p || p.id !== e.pointerId) return;
            p.x = e.clientX;
            p.y = e.clientY;
            if (!p.dragging) {
                if (p.sy - p.y < DRAG_START_PX && Math.hypot(p.x - p.sx, p.y - p.sy) < DRAG_START_PX * 3) return;
                p.dragging = true;
            }
            e.preventDefault();
            setDrag({ sticker: p.sticker, x: p.x, y: p.y });
            light(dropTargetAt(p.x, p.y, ...size())?.el ?? null);
        };
        const up = (e) => {
            const p = press.current;
            if (!p || p.id !== e.pointerId) return;
            const target = p.dragging ? dropTargetAt(e.clientX, e.clientY, ...size()) : null;
            stop();
            if (target) dropRef.current(target, p.sticker, p.payload);
            else if (!p.dragging) p.onTap?.();
        };
        const cancel = (e) => {
            if (press.current?.id === e.pointerId) stop();
        };
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            light(null);
        };
    }, [stop]);

    // Scroll the page while a sticker is held near the top or the bottom bar.
    useEffect(() => {
        if (!drag) return undefined;
        const timer = setInterval(() => {
            const p = press.current;
            if (!p) return;
            const bottom = document.querySelector('nav[aria-label="Agenda"]')?.getBoundingClientRect().top ?? window.innerHeight;
            if (p.y < EDGE_PX) window.scrollBy(0, -SCROLL_STEP);
            else if (p.y > bottom - EDGE_PX / 2) window.scrollBy(0, SCROLL_STEP);
            light(dropTargetAt(p.x, p.y, ...size())?.el ?? null);
        }, 16);
        return () => clearInterval(timer);
    }, [drag]);

    /** Call from onPointerDown. `now` starts moving right away; `onTap` runs when it wasn't a drag. */
    const start = useCallback((e, sticker, { now = false, payload = null, onTap = null } = {}) => {
        press.current = { id: e.pointerId, sticker, payload, onTap, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, dragging: now };
        if (now) setDrag({ sticker, x: e.clientX, y: e.clientY });
    }, []);

    return { drag, start, ghostRef };
}
