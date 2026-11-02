// src/utils/agendaStatus.js
// Seen / read / agreed state of an agenda item from one person's point of view.
// Seen: it was on their screen. Read: they opened it, hovered on it or pressed
// and held it. Whoever made the last change agrees to it; the other person has
// to see, read and answer it.

/**
 * @param {{ updatedBy: string, status: Record<string, { seenAt: string|null, readAt: string|null, response: string|null }> }} event
 * @param {string} me
 * @param {string[]} personIds
 * @returns {{
 *   byMe: boolean,        // I made the last change, so I wait for the other
 *   waitingOn: string,    // the person whose answer counts
 *   seen: boolean,        // waitingOn has seen the current version
 *   read: boolean,        // waitingOn has opened, hovered on or held it
 *   response: "akkoord"|"niet"|null,
 *   needsMyAnswer: boolean,
 * }}
 */
export function itemState(event, me, personIds) {
    const byMe = event.updatedBy === me;
    const waitingOn = byMe ? personIds.find((id) => id !== me) ?? me : me;
    const s = event.status?.[waitingOn] ?? {};
    const response = s.response === "akkoord" || s.response === "niet" ? s.response : null;
    return {
        byMe,
        waitingOn,
        seen: Boolean(s.seenAt || s.readAt) || response !== null,
        read: Boolean(s.readAt) || response !== null,
        response,
        // Only appointments are a question; busy time, special days and periods are information.
        needsMyAnswer: !byMe && response === null && (!event.kind || event.kind === "afspraak"),
    };
}

/** Glyph for a state: ✓ agreed, ✗ not agreed, ◉ read, ◐ seen, ○ not seen yet. */
export function stateGlyph(state) {
    if (state.response === "akkoord") return "✓";
    if (state.response === "niet") return "✗";
    if (state.read) return "◉";
    return state.seen ? "◐" : "○";
}

/**
 * Short Dutch status line.
 * @param {ReturnType<typeof itemState>} state
 * @param {(id: string) => string} nameOf
 */
export function stateLabel(state, nameOf) {
    if (state.byMe) {
        const other = nameOf(state.waitingOn);
        if (state.response === "akkoord") return `${other} IS AKKOORD`;
        if (state.response === "niet") return `${other} IS NIET AKKOORD`;
        if (state.read) return `${other} HEEFT HET GELEZEN`;
        return state.seen ? `${other} HEEFT HET GEZIEN` : `${other} HEEFT HET NOG NIET GEZIEN`;
    }
    if (state.response === "akkoord") return "JIJ BENT AKKOORD";
    if (state.response === "niet") return "JIJ BENT NIET AKKOORD";
    return "WACHT OP JOUW ANTWOORD";
}

/** Tailwind text color class for a state. */
export function stateTone(state) {
    if (state.response === "akkoord") return "text-[#00ff66]";
    if (state.response === "niet") return "text-[#ff4d4d]";
    if (state.needsMyAnswer) return "text-[#f7e463]";
    if (state.read) return "text-neutral-200";
    return "text-neutral-400";
}
