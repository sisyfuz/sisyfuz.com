// src/utils/agendaStyle.js
// Colour and logo per item. Both are cosmetic: the worker stores them apart from
// the item's content, so changing them never asks for akkoord again.

// Colours that read well as text on the agenda's black, and as a dark tint behind it.
export const ITEM_COLORS = [
    "#ff4d4d",
    "#ff9f43",
    "#f7e463",
    "#b8f35a",
    "#00ff66",
    "#3ee6d0",
    "#4dc3ff",
    "#7a8cff",
    "#b580ff",
    "#ff6fae",
    "#ffffff",
    "#a3a3a3",
];

export const LOGO_SIZES = [
    { id: "", label: "GEEN" },
    { id: "klein", label: "KLEIN" },
    { id: "groot", label: "GROOT" },
];

// Relative luminance (WCAG); text below this is too dark to read on black.
const MIN_LUMINANCE = 0.12;

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A colour from the picker, lightened until it can be read on black. */
export function readableColor(hex) {
    let value = String(hex || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) return "";
    for (let i = 0; i < 20 && luminance(value) < MIN_LUMINANCE; i++) {
        value = `#${[1, 3, 5]
            .map((j) => Math.min(255, Math.round(Number.parseInt(value.slice(j, j + 2), 16) * 0.85 + 255 * 0.15)).toString(16).padStart(2, "0"))
            .join("")}`;
    }
    return value;
}

/** The logo to draw for an item, or null. */
export function logoOf(event, stickersById, size) {
    if (!event.logoId || event.logoSize !== size) return null;
    return stickersById[event.logoId] ?? null;
}

/** Only the style fields that differ from the item, for POST /agenda/events/style. */
export function styleChanges(event, style) {
    const changes = {};
    if ((event.color || "") !== (style.color || "")) changes.color = style.color || "";
    if ((event.logoId || null) !== (style.logoId || null)) changes.logoId = style.logoId || null;
    if (style.logoId && (event.logoSize || "") !== (style.logoSize || "")) changes.logoSize = style.logoSize;
    return changes;
}
