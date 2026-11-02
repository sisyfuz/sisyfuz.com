// src/utils/agendaSpecial.js
// Special days (verjaardag, jubileum, anders) and periods (zomervakantie...).
// Special days are single days that usually come back every year; the worker
// returns yearly ones for every range and they are placed in each year here.

export const SPECIAL_TYPES = {
    verjaardag: { glyph: "★", label: "VERJAARDAG", color: "#f7e463" },
    jubileum: { glyph: "♥", label: "JUBILEUM", color: "#ff5c5c" },
    anders: { glyph: "✦", label: "BIJZONDER", color: "#8fd3ff" },
};

export const isSpecial = (e) => e?.kind === "bijzonder";
export const isPeriod = (e) => e?.kind === "periode";
/** Plain appointments: the only items that are seen, read and answered. */
export const isAppointment = (e) => !e?.kind || e.kind === "afspraak";

export function specialType(e) {
    return SPECIAL_TYPES[e.reason] ?? SPECIAL_TYPES.anders;
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Replaces each yearly special day by one occurrence per year in
 * [fromYear, toYear] (from its first year on). Occurrences keep the item's
 * fields, get `id` "<id>@<year>", `baseId` (the stored item) and `years`
 * (years since the first one). 29 February falls on the 28th in other years.
 */
export function expandYearly(events, fromYear, toYear) {
    const out = [];
    for (const e of events) {
        if (!isSpecial(e) || e.repeat !== "jaarlijks") {
            out.push(isSpecial(e) ? { ...e, baseId: e.id, years: null } : e);
            continue;
        }
        const [y0, m, d] = e.startDate.split("-").map(Number);
        for (let y = Math.max(y0, fromYear); y <= toYear; y++) {
            const day = m === 2 && d === 29 && !isLeap(y) ? 28 : d;
            const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            out.push({ ...e, id: `${e.id}@${y}`, baseId: e.id, startDate: date, endDate: date, years: y - y0 });
        }
    }
    return out;
}

/** "SAM WORDT 21", "3 JAAR SAMEN", "KONINGSDAG"... */
export function specialLabel(occ) {
    const title = occ.title.toUpperCase();
    const years = occ.countYears && occ.years > 0 ? occ.years : null;
    if (occ.reason === "verjaardag") return years ? `${title} WORDT ${years}` : `${title} IS JARIG`;
    if (occ.reason === "jubileum") return years ? `${years} JAAR ${title}` : title;
    return years ? `${title} · ${years} JAAR` : title;
}

/** Periods covering a day, longest first so the outer zone comes first. */
export function periodsOn(periods, day) {
    return periods
        .filter((p) => p.startDate <= day && p.endDate >= day)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate));
}

/** Hex color with an alpha suffix for tinted zone backgrounds. */
export function tint(hex, alpha = 0.16) {
    return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}
