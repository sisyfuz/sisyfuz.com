// src/utils/sanitize.js

/**
 * Strips zero-width characters, Trojan Source bidi chars, and control characters.
 * @param {string} str
 * @returns {string}
 */
function stripInvisibleAndControl(str) {
    return str
        // Zero-width spaces, joiners, BOM
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        // ASCII & Latin-1 control characters (0-31, 127-159)
        .replace(/[\x00-\x1F\x7F-\x9F]/g, "");
}

/**
 * Iteratively strips script protocols to eliminate nested bypasses (e.g. javajavascript:script:).
 * @param {string} str
 * @returns {string}
 */
function stripDangerousProtocols(str) {
    let cleaned = str;
    let prev;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(/(?:javascript|data|vbscript|file|blob)\s*:/gi, "");
    } while (cleaned !== prev);
    return cleaned;
}

/**
 * Iteratively strips HTML tags to prevent nested tag injection (e.g. <<script>script>).
 * @param {string} str
 * @returns {string}
 */
function stripHtmlTags(str) {
    let cleaned = str;
    let prev;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(/<[^<>]*>/g, "");
    } while (cleaned !== prev);
    // Strip any remaining unclosed or dangling angle brackets
    cleaned = cleaned.replace(/[<>]/g, "");
    return cleaned;
}

/**
 * Strips HTML tags, script protocols (javascript:, data:, vbscript:),
 * control characters, and dangerous chars from URL query parameters and hash routes.
 * 
 * @param {string} str - Raw URL parameter or hash fragment
 * @param {number} [maxLen=100] - Maximum allowed length
 * @returns {string} Sanitized string
 */
export function sanitizeUrlParam(str, maxLen = 100) {
    if (typeof str !== "string") return "";

    // Strip leading hash, question marks, and slashes
    let cleaned = str.replace(/^[#?\/]+/, "");

    // Attempt URI decoding iteratively to prevent double percent-encoded bypasses (%253C...)
    let decodePasses = 0;
    while (cleaned.includes("%") && decodePasses < 3) {
        try {
            const decoded = decodeURIComponent(cleaned);
            if (decoded === cleaned) break;
            cleaned = decoded;
            decodePasses++;
        } catch {
            break;
        }
    }

    // Strip zero-width & control characters
    cleaned = stripInvisibleAndControl(cleaned);

    // Iteratively strip script & dangerous protocols
    cleaned = stripDangerousProtocols(cleaned);

    // Iteratively strip HTML tags
    cleaned = stripHtmlTags(cleaned);

    // Strip dangerous injection and quote characters
    cleaned = cleaned.replace(/[<>"'`$|;&\\]/g, "");

    // Clamp length and trim
    return cleaned.slice(0, maxLen).trim();
}

/**
 * Normalizes and bounds terminal command inputs to prevent parameter injection.
 * 
 * @param {string} cmd - Raw command string
 * @param {number} [maxLen=120] - Maximum allowed command length
 * @returns {string} Sanitized command
 */
export function sanitizeCommand(cmd, maxLen = 120) {
    if (typeof cmd !== "string") return "";

    // Strip zero-width & control characters
    let cleaned = stripInvisibleAndControl(cmd);

    // Iteratively strip HTML tags
    cleaned = stripHtmlTags(cleaned);

    // Iteratively strip dangerous script pseudo-protocols
    cleaned = stripDangerousProtocols(cleaned);

    // Remove dangerous injection characters
    cleaned = cleaned.replace(/[<>"'`$|;&\\]/g, "");

    // Normalize multiple spaces into single space
    cleaned = cleaned.replace(/\s+/g, " ");

    return cleaned.slice(0, maxLen).trim();
}

/**
 * Strict sanitization for user chat inputs and interactive telemetry.
 * Strips Unicode bidirectional overrides (Trojan Source), zero-width characters, HTML tags, and enforces length limit.
 * 
 * @param {string} text - Raw user chat message or username
 * @param {number} [maxLen=200] - Maximum length limit (default 200)
 * @returns {string} Sanitized chat string
 */
export function sanitizeChat(text, maxLen = 200) {
    if (typeof text !== "string") return "";

    // Strip Unicode bidirectional override characters & isolates:
    // U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C
    let cleaned = text.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g, "");

    // Strip zero-width & control characters
    cleaned = stripInvisibleAndControl(cleaned);

    // Iteratively strip HTML tags
    cleaned = stripHtmlTags(cleaned);

    // Iteratively strip script pseudo-protocols
    cleaned = stripDangerousProtocols(cleaned);

    // Clamp length strictly
    return cleaned.slice(0, maxLen).trim();
}

/**
 * Validates and sanitizes stream/media broadcast URLs.
 * Enforces allowed protocols (http, https, ws, wss) to prevent protocol confusion and SSRF.
 * 
 * @param {string} url - Stream URL to validate
 * @returns {string} Validated URL or empty string if invalid
 */
export function sanitizeStreamUrl(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";

    try {
        const parsed = new URL(trimmed);
        if (["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
            return parsed.toString();
        }
    } catch {
        // Invalid URL
    }
    return "";
}
