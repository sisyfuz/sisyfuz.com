// src/utils/routing.js
// Pure URL -> view parsing for SharpDisplay. Trailing slashes are ignored so
// statically generated GitHub Pages paths (/work/, /work/<slug>/) resolve the
// same as their client-side counterparts.
import { sanitizeUrlParam } from "./sanitize.js";

export const SECTION_KEYS = Object.freeze(["work", "archive", "about", "contact", "press", "live"]);

const SECTION_ALIASES = { privacy: "privacy", legal: "privacy" };

// In-page anchors that are never project slugs.
const RESERVED_HASHES = new Set(["main-content", "terminal-main-content"]);

/**
 * Canonical path for a section key.
 * @param {string} section
 * @returns {string}
 */
export function sectionPath(section) {
    return section === "home" ? "/" : `/${section}`;
}

/**
 * Canonical path for a project detail view.
 * @param {string} slug
 * @returns {string}
 */
export function workPath(slug) {
    return `/work/${encodeURIComponent(slug)}`;
}

/**
 * Sanitizes a slug taken from a URL path segment or hash.
 * @param {string} raw
 * @returns {string|null}
 */
function cleanSlug(raw) {
    const clean = sanitizeUrlParam(raw);
    if (!clean || clean.includes("/") || RESERVED_HASHES.has(clean)) return null;
    return clean;
}

/**
 * Parses a location into the view to render.
 *
 * @param {string} pathname
 * @param {string} [hash]
 * @returns {{ section: string, slug: string|null, redirect: string|null }}
 *   `redirect` is set when the URL is a legacy form that should be replaced
 *   (e.g. `/work#slug` -> `/work/slug`).
 */
export function parseRoute(pathname, hash = "") {
    const segments = String(pathname ?? "")
        .split("/")
        .filter(Boolean);
    const head = (segments[0] ?? "").toLowerCase();

    if (segments.length === 0 || (head === "home" && segments.length === 1)) {
        return { section: "home", slug: null, redirect: null };
    }

    if (SECTION_ALIASES[head] && segments.length === 1) {
        return { section: SECTION_ALIASES[head], slug: null, redirect: null };
    }

    if (head === "work") {
        if (segments.length === 1) {
            const legacySlug = hash ? cleanSlug(hash) : null;
            if (legacySlug) {
                return { section: "work", slug: legacySlug, redirect: workPath(legacySlug) };
            }
            return { section: "work", slug: null, redirect: null };
        }
        if (segments.length === 2) {
            const slug = cleanSlug(segments[1]);
            return { section: "work", slug, redirect: slug ? null : "/work" };
        }
    }

    if (SECTION_KEYS.includes(head) && segments.length === 1) {
        return { section: head, slug: null, redirect: null };
    }

    return { section: "home", slug: null, redirect: null };
}

/**
 * True for an unmodified primary-button click, i.e. one a router <Link>
 * handles in-page (as opposed to open-in-new-tab / new-window / download).
 * @param {{ button?: number, metaKey?: boolean, altKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean, defaultPrevented?: boolean }} event
 * @returns {boolean}
 */
export function isPlainLeftClick(event) {
    if (!event || event.defaultPrevented) return false;
    return (event.button ?? 0) === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}
