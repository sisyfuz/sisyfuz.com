// test/seo.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    ROUTES,
    SEO_START,
    SEO_END,
    escapeHtml,
    cleanText,
    sanitizeSlug,
    ogImageUrl,
    projectToPage,
    projectsToPages,
    buildHeadTags,
    injectHead,
    outputFileFor,
    fetchProjects,
} from "../scripts/seo/lib.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = `<!doctype html>\n<html lang="nl">\n  <head>\n    <meta charset="UTF-8" />\n    ${SEO_START}\n    <title>old</title>\n    ${SEO_END}\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`;

describe("SEO helpers", () => {
    test("escapeHtml escapes markup and quotes", () => {
        assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
        assert.equal(escapeHtml(null), "");
    });

    test("cleanText collapses whitespace and truncates on a word boundary", () => {
        assert.equal(cleanText("  a \n  b  "), "a b");
        const out = cleanText("woord ".repeat(100), 50);
        assert.ok(out.length <= 50);
        assert.ok(out.endsWith("…"));
        assert.ok(!out.includes("  "));
    });

    test("sanitizeSlug accepts simple slugs and rejects traversal / odd input", () => {
        assert.equal(sanitizeSlug("we-are-a-peoples-company"), "we-are-a-peoples-company");
        assert.equal(sanitizeSlug(" Mixed_Case-1 "), "Mixed_Case-1");
        for (const bad of ["../etc", "a/b", "", "-lead", "a.b", "a b", "%2e%2e", null, 42, "x".repeat(201)]) {
            assert.equal(sanitizeSlug(bad), null, `should reject ${JSON.stringify(bad)}`);
        }
    });

    test("ogImageUrl appends a 1200x630 crop for Sanity CDN images only", () => {
        assert.equal(
            ogImageUrl("https://cdn.sanity.io/images/p/d/abc-10x10.png"),
            "https://cdn.sanity.io/images/p/d/abc-10x10.png?w=1200&h=630&fit=crop&auto=format"
        );
        assert.equal(
            ogImageUrl("https://cdn.sanity.io/images/p/d/abc.png?dl=1"),
            "https://cdn.sanity.io/images/p/d/abc.png?dl=1&w=1200&h=630&fit=crop&auto=format"
        );
        assert.equal(ogImageUrl(null), null);
        assert.equal(ogImageUrl("https://evil.example/x.png"), null);
        assert.equal(ogImageUrl("javascript:alert(1)"), null);
    });

    test("projectToPage builds /work/<slug>/ pages with fallbacks", () => {
        const withImage = projectToPage({ slug: "p1", title: "Project", year: "2026", shortDesc: "Kort.", image: "https://cdn.sanity.io/images/a.png" });
        assert.equal(withImage.path, "/work/p1/");
        assert.equal(withImage.title, "Project — sisyfuz");
        assert.equal(withImage.description, "Kort.");
        assert.equal(withImage.type, "article");
        assert.match(withImage.image, /\?w=1200&h=630&fit=crop&auto=format$/);

        const bare = projectToPage({ slug: "p2", title: "Ander", year: "2025", shortDesc: null, image: null });
        assert.equal(bare.description, "Ander (2025) — werk van Dorus Kleijne (sisyfuz).");
        assert.equal(bare.image, undefined);

        assert.equal(projectToPage({ slug: "../x", title: "t" }), null);
    });

    test("projectsToPages drops invalid and duplicate slugs and tolerates bad input", () => {
        const warnings = [];
        const pages = projectsToPages(
            [{ slug: "a", title: "A" }, { slug: "a", title: "A again" }, { slug: "b/c", title: "B" }],
            (m) => warnings.push(m)
        );
        assert.deepEqual(pages.map((p) => p.path), ["/work/a/"]);
        assert.equal(warnings.length, 1);
        assert.deepEqual(projectsToPages(null), []);
    });

    test("buildHeadTags emits title, description, canonical, OG and Twitter tags", () => {
        const html = buildHeadTags({ path: "/work/", title: "Work — sisyfuz", description: "Beschrijving \"met\" <tags>" }).join("\n");
        assert.match(html, /<title>Work — sisyfuz<\/title>/);
        assert.match(html, /<meta name="description" content="Beschrijving &quot;met&quot; &lt;tags&gt;" \/>/);
        assert.match(html, /<link rel="canonical" href="https:\/\/sisyfuz\.com\/work\/" \/>/);
        assert.match(html, /<meta property="og:url" content="https:\/\/sisyfuz\.com\/work\/" \/>/);
        assert.match(html, /<meta property="og:type" content="website" \/>/);
        assert.match(html, /<meta property="og:locale" content="nl_NL" \/>/);
        assert.match(html, /<meta name="twitter:card" content="summary" \/>/);
        assert.doesNotMatch(html, /og:image/);
    });

    test("buildHeadTags uses large card and og:image when an image is present", () => {
        const page = projectToPage({ slug: "p", title: "P", image: "https://cdn.sanity.io/images/a.png" });
        const html = buildHeadTags(page).join("\n");
        assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.sanity\.io\/images\/a\.png\?w=1200&amp;h=630&amp;fit=crop&amp;auto=format" \/>/);
        assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
        assert.match(html, /<meta name="twitter:image" /);
        assert.match(html, /og:image:width" content="1200"/);
    });

    test("canonical override is respected (legal -> privacy)", () => {
        const legal = ROUTES.find((r) => r.path === "/legal/");
        const html = buildHeadTags(legal).join("\n");
        assert.match(html, /rel="canonical" href="https:\/\/sisyfuz\.com\/privacy\/"/);
    });

    test("injectHead replaces only the marked block and keeps the rest of the document", () => {
        const out = injectHead(TEMPLATE, { path: "/about/", title: "About — sisyfuz", description: "d" });
        assert.ok(!out.includes("<title>old</title>"));
        assert.equal((out.match(/<title>/g) || []).length, 1);
        assert.ok(out.includes("<title>About — sisyfuz</title>"));
        assert.ok(out.includes(SEO_START) && out.includes(SEO_END), "markers are kept so the step is idempotent");
        assert.ok(out.startsWith(`<!doctype html>\n<html lang="nl">\n  <head>\n    <meta charset="UTF-8" />\n    ${SEO_START}\n    <title>`));
        assert.ok(out.endsWith(`${SEO_END}\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`));
        // Idempotent
        assert.equal(injectHead(out, { path: "/about/", title: "About — sisyfuz", description: "d" }), out);
    });

    test("injectHead throws when markers are missing", () => {
        assert.throws(() => injectHead("<html><head><title>x</title></head></html>", ROUTES[0]), /markers/);
    });

    test("outputFileFor maps route paths to dist-relative index.html files", () => {
        assert.equal(outputFileFor("/"), "index.html");
        assert.equal(outputFileFor("/work/"), "work/index.html");
        assert.equal(outputFileFor("/work/slug/"), "work/slug/index.html");
    });

    test("all routes use the canonical leading+trailing slash form and unique paths", () => {
        const paths = ROUTES.map((r) => r.path);
        assert.equal(new Set(paths).size, paths.length);
        for (const p of paths) assert.match(p, /^\/([a-z]+\/)?$/);
        for (const r of ["/", "/work/", "/archive/", "/about/", "/contact/", "/press/", "/live/", "/privacy/", "/legal/"]) {
            assert.ok(paths.includes(r), `missing route ${r}`);
        }
        for (const r of ROUTES) {
            assert.ok(r.title && r.description, `route ${r.path} needs title and description`);
        }
    });

    test("fetchProjects returns results, and [] with a warning on failure", async () => {
        const ok = async () => ({ ok: true, json: async () => ({ result: [{ slug: "a" }] }) });
        assert.deepEqual(await fetchProjects({ fetchImpl: ok }), [{ slug: "a" }]);

        for (const bad of [
            async () => { throw new Error("offline"); },
            async () => ({ ok: false, status: 503, json: async () => ({}) }),
            async () => ({ ok: true, json: async () => ({ nope: 1 }) }),
        ]) {
            const warnings = [];
            assert.deepEqual(await fetchProjects({ fetchImpl: bad, warn: (m) => warnings.push(m) }), []);
            assert.equal(warnings.length, 1);
        }
    });

    test("index.html keeps the SEO markers the prerender step relies on", () => {
        const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
        assert.ok(html.includes(SEO_START) && html.includes(SEO_END));
        assert.equal((html.match(/<title>/g) || []).length, 1);
    });
});
