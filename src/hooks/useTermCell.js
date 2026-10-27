// src/hooks/useTermCell.js
import { useEffect, useState } from "react";

const FALLBACK = { w: 7.32, h: 16, font: "12px monospace", ascent: 9, descent: 3 };

// Measure one terminal cell (1ch x 1lh) and the font it is drawn with, using a probe
// that inherits the page typography so canvases can draw on the exact same grid.
function measureCell() {
    if (typeof document === "undefined" || !document.body) return FALLBACK;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:1ch;height:1lh;left:-9999px;top:0;";
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    const cs = window.getComputedStyle(probe);
    probe.remove();

    // Older engines without the lh unit report 0 height; fall back to the computed line height
    const h = rect.height || Number.parseFloat(cs.lineHeight) || FALLBACK.h;
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

    const ctx = document.createElement("canvas").getContext("2d");
    let ascent = Number.parseFloat(cs.fontSize) * 0.8;
    let descent = Number.parseFloat(cs.fontSize) * 0.2;
    if (ctx) {
        ctx.font = font;
        const m = ctx.measureText("M");
        if (m.fontBoundingBoxAscent) {
            ascent = m.fontBoundingBoxAscent;
            descent = m.fontBoundingBoxDescent;
        }
    }
    return { w: rect.width || FALLBACK.w, h, font, ascent, descent };
}

function sameCell(a, b) {
    return a.w === b.w && a.h === b.h && a.font === b.font;
}

/**
 * The page's terminal cell in CSS px: { w, h, font, ascent, descent }.
 * Re-measures on resize (breakpoints change the cell) and when web fonts finish loading.
 */
export function useTermCell() {
    const [cell, setCell] = useState(measureCell);

    useEffect(() => {
        const update = () => {
            const next = measureCell();
            setCell((prev) => (sameCell(prev, next) ? prev : next));
        };
        update();
        window.addEventListener("resize", update);
        const fonts = document.fonts;
        fonts?.addEventListener?.("loadingdone", update);
        fonts?.ready?.then(update);
        // High-legibility mode swaps the font via a class on <html>
        const mo = new window.MutationObserver(update);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        return () => {
            window.removeEventListener("resize", update);
            fonts?.removeEventListener?.("loadingdone", update);
            mo.disconnect();
        };
    }, []);

    return cell;
}

/** Baseline y for text drawn in a canvas row so glyphs sit where DOM text would. */
export function rowBaseline(cell, rowTop) {
    return rowTop + (cell.h - (cell.ascent + cell.descent)) / 2 + cell.ascent;
}
