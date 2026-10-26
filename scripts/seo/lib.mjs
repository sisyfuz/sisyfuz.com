// scripts/seo/lib.mjs
// Pure helpers for the post-build SEO step (per-route HTML, meta tags).
// No dependencies: runs on plain Node 20+.

export const SITE_URL = "https://sisyfuz.com";
export const SITE_NAME = "sisyfuz";

export const SANITY_QUERY_URL = "https://gt7prmxg.apicdn.sanity.io/v2026-04-17/data/query/production";
export const PROJECTS_QUERY =
    `*[_type == "project" && category == "work" && defined(slug.current)]{ "slug": slug.current, title, year, shortDesc, "image": mainImage.asset->url }`;

export const SEO_START = "<!-- seo:start -->";
export const SEO_END = "<!-- seo:end -->";

// Copy taken verbatim from the site (SharpDisplay / TuiAbout / TuiContact / TuiPrivacy).
const STATEMENT =
    "Dorus Kleijne maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.";
const TAGLINE = "Sci-fi als taal. Queer als basishouding.";

// Canonical form: every page is a folder with index.html, so GitHub Pages serves
// it at "/<route>/" (and 301-redirects "/<route>" there). All canonical URLs and
// any future sitemap entries therefore use the trailing-slash form.
export const ROUTES = [
    { path: "/", title: "sisyfuz — Dorus Kleijne", description: STATEMENT },
    { path: "/work/", title: "Work — sisyfuz", description: `Werk van Dorus Kleijne (sisyfuz). ${TAGLINE}` },
    { path: "/archive/", title: "Archive — sisyfuz", description: "Archief van alle projecten van Dorus Kleijne (sisyfuz)." },
    { path: "/about/", title: "About — sisyfuz", description: `${STATEMENT} ${TAGLINE}` },
    { path: "/contact/", title: "Contact — sisyfuz", description: "Voor vragen, samenwerkingen, residenties of dramaturgie: info@sisyfuz.com." },
    { path: "/press/", title: "Press — sisyfuz", description: "\"Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos.\" Pogingenteller: registreer een poging." },
    { path: "/live/", title: "Live — sisyfuz", description: "Interactieve livestream en live chat van sisyfuz." },
    { path: "/privacy/", title: "Privacy & Colofon — sisyfuz", description: "Privacyverklaring & colofon van sisyfuz.com. Géén trackers, géén cookies van derden: alleen het minimum aan technische data." },
    // Alias of /privacy: served as its own folder so the deep link works, but canonical points to /privacy/.
    { path: "/legal/", title: "Privacy & Colofon — sisyfuz", description: "Privacyverklaring & colofon van sisyfuz.com. Géén trackers, géén cookies van derden: alleen het minimum aan technische data.", canonical: "/privacy/", sitemap: false },
];

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Collapse whitespace and cut to `max` chars on a word boundary. */
export function cleanText(value, max = 300) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

export function absoluteUrl(path) {
    return `${SITE_URL}${path}`;
}

/**
 * Only accept simple URL-safe slugs so a CMS value can never escape dist/work/
 * or produce odd URLs. Returns null for anything else.
 */
export function sanitizeSlug(slug) {
    if (typeof slug !== "string") return null;
    const s = slug.trim();
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(s) ? s : null;
}

/** 1200x630 crop of a Sanity CDN image for social cards; null for anything else. */
export function ogImageUrl(url) {
    if (typeof url !== "string" || !url.startsWith("https://cdn.sanity.io/")) return null;
    return `${url}${url.includes("?") ? "&" : "?"}w=1200&h=630&fit=crop&auto=format`;
}

export function projectToPage(project) {
    const slug = sanitizeSlug(project?.slug);
    if (!slug) return null;
    const title = cleanText(project.title, 120) || slug;
    const year = project.year ? cleanText(project.year, 20) : "";
    const description = cleanText(project.shortDesc) ||
        `${title}${year ? ` (${year})` : ""} — werk van Dorus Kleijne (sisyfuz).`;
    const image = ogImageUrl(project.image);
    return {
        path: `/work/${slug}/`,
        title: `${title} — ${SITE_NAME}`,
        description,
        type: "article",
        ...(image ? { image, imageWidth: 1200, imageHeight: 630, imageAlt: title } : {}),
    };
}

/** Map raw Sanity results to pages, dropping invalid and duplicate slugs. */
export function projectsToPages(projects, warn = () => {}) {
    const seen = new Set();
    const pages = [];
    for (const project of Array.isArray(projects) ? projects : []) {
        const page = projectToPage(project);
        if (!page) {
            warn(`skipping project with unusable slug: ${JSON.stringify(project?.slug)}`);
            continue;
        }
        if (seen.has(page.path)) continue;
        seen.add(page.path);
        pages.push(page);
    }
    return pages;
}

/** The SEO <head> block (title, description, canonical, Open Graph, Twitter). */
export function buildHeadTags(page) {
    const url = absoluteUrl(page.canonical ?? page.path);
    const title = escapeHtml(page.title);
    const description = escapeHtml(cleanText(page.description));
    const lines = [
        `<title>${title}</title>`,
        `<meta name="description" content="${description}" />`,
        `<link rel="canonical" href="${escapeHtml(url)}" />`,
        `<meta property="og:type" content="${escapeHtml(page.type ?? "website")}" />`,
        `<meta property="og:site_name" content="${SITE_NAME}" />`,
        `<meta property="og:locale" content="nl_NL" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="${escapeHtml(url)}" />`,
    ];
    if (page.image) {
        lines.push(`<meta property="og:image" content="${escapeHtml(page.image)}" />`);
        if (page.imageWidth) lines.push(`<meta property="og:image:width" content="${page.imageWidth}" />`);
        if (page.imageHeight) lines.push(`<meta property="og:image:height" content="${page.imageHeight}" />`);
        if (page.imageAlt) lines.push(`<meta property="og:image:alt" content="${escapeHtml(page.imageAlt)}" />`);
    }
    lines.push(
        `<meta name="twitter:card" content="${page.image ? "summary_large_image" : "summary"}" />`,
        `<meta name="twitter:title" content="${title}" />`,
        `<meta name="twitter:description" content="${description}" />`,
    );
    if (page.image) lines.push(`<meta name="twitter:image" content="${escapeHtml(page.image)}" />`);
    return lines;
}

/** Replace the marked SEO block in an HTML document with tags for `page`. */
export function injectHead(html, page) {
    const start = html.indexOf(SEO_START);
    const end = html.indexOf(SEO_END);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`SEO markers ${SEO_START} … ${SEO_END} not found in HTML template`);
    }
    const lineStart = html.lastIndexOf("\n", start) + 1;
    const indent = html.slice(lineStart, start).match(/^[ \t]*/)[0];
    const block = [SEO_START, ...buildHeadTags(page), SEO_END].join(`\n${indent}`);
    return html.slice(0, start) + block + html.slice(end + SEO_END.length);
}

/** dist-relative output file for a route path, e.g. "/work/x/" -> "work/x/index.html". */
export function outputFileFor(path) {
    const rel = path.replace(/^\/+|\/+$/g, "");
    return rel ? `${rel}/index.html` : "index.html";
}

/**
 * Fetch work projects from Sanity. Never throws: on any failure it warns and
 * returns [] so the build still succeeds with the static routes.
 */
export async function fetchProjects({ fetchImpl = globalThis.fetch, timeoutMs = 15000, warn = () => {} } = {}) {
    try {
        const res = await fetchImpl(`${SANITY_QUERY_URL}?query=${encodeURIComponent(PROJECTS_QUERY)}`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json?.result)) throw new Error("unexpected response shape");
        return json.result;
    } catch (err) {
        warn(`could not fetch projects from Sanity (${err?.message ?? err}); generating static routes only`);
        return [];
    }
}
