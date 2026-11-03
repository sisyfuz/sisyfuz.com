// src/utils/agendaStickerPlace.js
// Where a sticker lands while you stick it on a card (see AgendaStickers.jsx).

// The worker accepts rows 0..20 from the top of the card.
export const MAX_ROWS = 20;

/**
 * Where a sticker goes when the finger or mouse is at (clientX, clientY) on `card`:
 * centred under the pointer, kept inside the card's width and on its rows.
 * `stickerWidth` is the sticker's width in px when it isn't drawn on the card yet.
 */
export function positionAt(card, clientX, clientY, stickerWidth) {
    const rect = card.getBoundingClientRect();
    const style = window.getComputedStyle(card);
    const lh = Number.parseFloat(style.lineHeight) || 16;
    const ghost = card.querySelector("[data-sticker-ghost]");
    const width = stickerWidth || ghost?.offsetWidth || lh * 4;
    const room = Math.max(1, rect.width - width);
    const x = Math.min(1, Math.max(0, (clientX - rect.left - width / 2) / room));
    const rows = Math.max(1, Math.round(rect.height / lh));
    const y = Math.min(Math.min(MAX_ROWS, rows - 1), Math.max(0, Math.round((clientY - rect.top) / lh - 2)));
    return { x: Math.round(x * 1000) / 1000, y };
}

// Day stickers: whole columns and rows from the day's top-left corner (the worker
// keeps them within these bounds).
const DAY_DX = [-12, 80];
const DAY_DY = [-8, 40];
const clamp = (n, [min, max]) => Math.min(max, Math.max(min, n));

/**
 * What a sticker of `width` x `height` px dropped at (clientX, clientY) lands on:
 * an item card ({ kind: "item", eventId, spot }), a day in the month or the list
 * ({ kind: "day", view, day, dx, dy }), or null. Cards win over the day they are on.
 */
export function dropTargetAt(clientX, clientY, width, height) {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
        const card = el.closest?.("[data-item-id]");
        if (card) return { kind: "item", eventId: card.dataset.itemId, el: card, spot: positionAt(card, clientX, clientY, width) };
        const day = el.closest?.("[data-sticker-day]");
        if (day) {
            const r = day.getBoundingClientRect();
            const ch = width / 9;
            const lh = height / 4;
            return {
                kind: "day",
                view: day.dataset.stickerView,
                day: day.dataset.stickerDay,
                el: day,
                dx: clamp(Math.round((clientX - r.left - width / 2) / ch), DAY_DX),
                dy: clamp(Math.round((clientY - r.top - height / 2) / lh), DAY_DY),
            };
        }
    }
    return null;
}
