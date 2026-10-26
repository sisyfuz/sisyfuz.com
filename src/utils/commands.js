// src/utils/commands.js
// Pure parsing for the floating SEARCH box. While typing, the buffer is always
// a search filter; a command only runs on Enter when the whole trimmed buffer
// exactly equals one of the names below.

const NAVIGATION_COMMANDS = {
    work: "/work",
    archive: "/archive",
    about: "/about",
    contact: "/contact",
    press: "/press",
    live: "/live",
    home: "/",
    privacy: "/privacy",
    legal: "/privacy",
};

const ACTION_COMMANDS = {
    a11y: { type: "toggleA11y" },
    disco: { type: "toggleDisco" },
    ascii: { type: "ascii", to: "/live" },
};

export const COMMAND_NAMES = Object.freeze([
    ...Object.keys(NAVIGATION_COMMANDS),
    ...Object.keys(ACTION_COMMANDS),
]);

/**
 * Normalizes a raw buffer for comparison: lowercase, collapsed whitespace, trimmed.
 * @param {unknown} buffer
 * @returns {string}
 */
function normalize(buffer) {
    if (typeof buffer !== "string") return "";
    return buffer.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Parses the search buffer on Enter.
 * Returns null when the buffer is not exactly a command (it stays a search filter).
 *
 * @param {string} buffer
 * @returns {null | { type: "navigate", to: string } | { type: "toggleA11y" } | { type: "toggleDisco" } | { type: "ascii", to: string }}
 */
export function parseCommand(buffer) {
    const clean = normalize(buffer);
    if (!clean) return null;
    if (Object.prototype.hasOwnProperty.call(NAVIGATION_COMMANDS, clean)) {
        return { type: "navigate", to: NAVIGATION_COMMANDS[clean] };
    }
    if (Object.prototype.hasOwnProperty.call(ACTION_COMMANDS, clean)) {
        return { ...ACTION_COMMANDS[clean] };
    }
    return null;
}

/**
 * True when the buffer could still become a command if the user keeps typing
 * (e.g. "a", "arch", "disc"). Used to avoid jumping to /work for a search
 * filter while the user is mid-way through typing a command name.
 *
 * @param {string} buffer
 * @returns {boolean}
 */
export function isCommandPrefix(buffer) {
    const clean = normalize(buffer);
    if (!clean) return false;
    return COMMAND_NAMES.some((name) => name.startsWith(clean));
}

/**
 * Normalizes raw text typed into the search input: lowercase, only [a-z0-9 ],
 * no leading whitespace, single spaces, at most `maxLen` chars (keeps the tail).
 * Trailing spaces are kept so multi-word queries can be typed.
 *
 * @param {string} raw
 * @param {number} [maxLen=25]
 * @returns {string}
 */
export function normalizeSearchInput(raw, maxLen = 25) {
    if (typeof raw !== "string") return "";
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/ {2,}/g, " ")
        .slice(-maxLen)
        .replace(/^ +/, "");
}
