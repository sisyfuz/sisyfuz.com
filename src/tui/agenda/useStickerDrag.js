// src/tui/agenda/useStickerDrag.js
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { dropTargetAt } from "../../utils/agendaStickerPlace";

// Dragging a sticker anywhere in the agenda: out of the tray, or a stuck one that
// was picked up. Pointer events on the window, so it works with a finger too.
//
// How a drag starts (`start(e, sticker, options)`, from onPointerDown):
// - `now`: right away (a sticker that is already picked up).
// - `hold` ms: after holding still that long (stuck stickers on a touch screen;
//   moving first lets the page scroll as usual).
// - otherwise once the pointer moves up or far enough (the tray: swiping sideways
//   scrolls it), or after a few px with a mouse.
// A press that never became a drag is a tap (`onTap`).
//
// While dragging, nothing in the agenda re-renders: the sticker under the finger
// and the faint copy where it will land are moved by hand, once per frame. The
// page scrolls along near the top of the screen or the bottom bar, and touch
// scrolling is held off. `onDrop(target, sticker, payload)` gets dropTargetAt()'s
// result; `active` is { sticker, payload } during a drag.
const TOUCH_START_PX = 8;
const MOUSE_START_PX = 4;
const EDGE_PX = 64;
const SCROLL_STEP = 10;
const LIT = "#1c1c1c";

export default function useStickerDrag(onDrop) {
    const [active, setActive] = useState(null);
    const press = useRef(null);
    const lit = useRef(null);
    const frame = useRef(0);
    const ghostRef = useRef(null);
    const previewRef = useRef(null);
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
        return g?.offsetWidth ? [g.offsetWidth, g.offsetHeight] : [64, 64];
    };

    // Puts the sticker under the pointer and its preview where it would land.
    const draw = useCallback(() => {
        frame.current = 0;
        const p = press.current;
        if (!p?.dragging) return;
        const [w, h] = size();
        const ghost = ghostRef.current;
        if (ghost) ghost.style.transform = `translate(${p.x - w / 2}px, ${p.y - h / 2}px)`;
        const target = dropTargetAt(p.x, p.y, w, h);
        light(target?.el ?? null);
        const preview = previewRef.current;
        if (preview) {
            if (target?.at) {
                preview.style.transform = `translate(${target.at.left}px, ${target.at.top}px)`;
                preview.style.visibility = "visible";
            } else {
                preview.style.visibility = "hidden";
            }
        }
    }, []);
    const redraw = useCallback(() => {
        if (!frame.current) frame.current = window.requestAnimationFrame(draw);
    }, [draw]);

    const end = useCallback(() => {
        const p = press.current;
        if (p) clearTimeout(p.timer);
        press.current = null;
        window.cancelAnimationFrame(frame.current);
        frame.current = 0;
        light(null);
        setActive(null);
    }, []);

    const begin = useCallback(
        (p) => {
            p.dragging = true;
            clearTimeout(p.timer);
            window.navigator.vibrate?.(8);
            setActive({ sticker: p.sticker, payload: p.payload });
        },
        []
    );

    // The ghost and preview exist once `active` is set: place them before paint.
    useLayoutEffect(() => {
        if (active) draw();
    }, [active, draw]);

    useEffect(() => {
        const move = (e) => {
            const p = press.current;
            if (!p || p.id !== e.pointerId) return;
            p.x = e.clientX;
            p.y = e.clientY;
            if (!p.dragging) {
                const far = Math.hypot(p.x - p.sx, p.y - p.sy);
                if (p.hold) {
                    // Moved before the hold was up: that's a scroll, not a sticker.
                    if (far > TOUCH_START_PX) end();
                    return;
                }
                const mouse = e.pointerType === "mouse";
                const up = p.sy - p.y >= TOUCH_START_PX;
                if (!(mouse ? far >= MOUSE_START_PX : up || far >= TOUCH_START_PX * 3)) return;
                begin(p);
            }
            redraw();
        };
        const up = (e) => {
            const p = press.current;
            if (!p || p.id !== e.pointerId) return;
            const target = p.dragging ? dropTargetAt(e.clientX, e.clientY, ...size()) : null;
            const { dragging, onTap, sticker, payload } = p;
            end();
            if (target) dropRef.current(target, sticker, payload);
            else if (!dragging) onTap?.();
        };
        const cancel = (e) => {
            if (press.current?.id === e.pointerId) end();
        };
        // Pointer events can't stop the page from scrolling under a dragged sticker;
        // a touchmove listener that isn't passive can.
        const holdScroll = (e) => {
            if (press.current?.dragging && e.cancelable) e.preventDefault();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("touchmove", holdScroll, { passive: false });
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("touchmove", holdScroll);
            light(null);
        };
    }, [begin, end, redraw]);

    // Scroll the page while a sticker is held near the top or the bottom bar.
    useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => {
            const p = press.current;
            if (!p) return;
            const bottom = document.querySelector('nav[aria-label="Agenda"]')?.getBoundingClientRect().top ?? window.innerHeight;
            if (p.y < EDGE_PX) window.scrollBy(0, -SCROLL_STEP);
            else if (p.y > bottom - EDGE_PX / 2) window.scrollBy(0, SCROLL_STEP);
            else return;
            redraw();
        }, 16);
        return () => clearInterval(timer);
    }, [active, redraw]);

    const start = useCallback(
        (e, sticker, { now = false, hold = 0, payload = null, onTap = null } = {}) => {
            if (!sticker || (e.pointerType === "mouse" && e.button !== 0)) return;
            const p = { id: e.pointerId, sticker, payload, onTap, hold, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, dragging: false, timer: 0 };
            press.current = p;
            if (now) begin(p);
            else if (hold) p.timer = setTimeout(() => press.current === p && (begin(p), redraw()), hold);
        },
        [begin, redraw]
    );

    return { active, start, ghostRef, previewRef };
}
