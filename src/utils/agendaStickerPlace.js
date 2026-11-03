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
