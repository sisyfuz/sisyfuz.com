// test/routing.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, sectionPath, workPath } from "../src/utils/routing.js";

const view = (section, slug = null, redirect = null) => ({ section, slug, redirect });

describe("parseRoute", () => {
    test("root and /home resolve to home", () => {
        assert.deepEqual(parseRoute("/"), view("home"));
        assert.deepEqual(parseRoute(""), view("home"));
        assert.deepEqual(parseRoute("/home"), view("home"));
        assert.deepEqual(parseRoute("/home/"), view("home"));
    });

    test("top-level sections, with or without trailing slash", () => {
        for (const section of ["work", "archive", "about", "contact", "press", "live"]) {
            assert.deepEqual(parseRoute(`/${section}`), view(section), section);
            assert.deepEqual(parseRoute(`/${section}/`), view(section), `${section}/`);
        }
    });

    test("section names are case-insensitive", () => {
        assert.deepEqual(parseRoute("/WORK"), view("work"));
        assert.deepEqual(parseRoute("/About/"), view("about"));
    });

    test("privacy and the legal alias", () => {
        assert.deepEqual(parseRoute("/privacy"), view("privacy"));
        assert.deepEqual(parseRoute("/privacy/"), view("privacy"));
        assert.deepEqual(parseRoute("/legal"), view("privacy"));
        assert.deepEqual(parseRoute("/legal/"), view("privacy"));
    });

    test("project detail at /work/<slug>, trailing slash tolerant", () => {
        assert.deepEqual(parseRoute("/work/my-slug"), view("work", "my-slug"));
        assert.deepEqual(parseRoute("/work/my-slug/"), view("work", "my-slug"));
        assert.deepEqual(parseRoute("/Work/My-Slug"), view("work", "My-Slug"), "slug case is preserved");
    });

    test("percent-encoded slugs are decoded", () => {
        assert.deepEqual(parseRoute("/work/caf%C3%A9"), view("work", "café"));
    });

    test("slugs are sanitized", () => {
        assert.deepEqual(parseRoute("/work/%3Cscript%3Ealert(1)%3C%2Fscript%3E"), view("work", "alert(1)"));
        assert.deepEqual(parseRoute("/work/javascript:alert(1)"), view("work", "alert(1)"));
    });

    test("slugs that sanitize to nothing redirect to the list", () => {
        assert.deepEqual(parseRoute("/work/%3Cimg%20src%3Dx%3E"), view("work", null, "/work"));
        assert.deepEqual(parseRoute("/work/a%2Fb"), view("work", null, "/work"));
        assert.deepEqual(parseRoute("/work/main-content"), view("work", null, "/work"));
    });

    test("legacy /work#slug redirects to /work/slug", () => {
        assert.deepEqual(parseRoute("/work", "#my-slug"), view("work", "my-slug", "/work/my-slug"));
        assert.deepEqual(parseRoute("/work/", "#my-slug"), view("work", "my-slug", "/work/my-slug"));
    });

    test("in-page anchors on /work are not treated as slugs", () => {
        assert.deepEqual(parseRoute("/work", "#main-content"), view("work"));
        assert.deepEqual(parseRoute("/work", "#terminal-main-content"), view("work"));
        assert.deepEqual(parseRoute("/work", "#"), view("work"));
    });

    test("hash on a detail URL or other section is ignored", () => {
        assert.deepEqual(parseRoute("/work/my-slug", "#other"), view("work", "my-slug"));
        assert.deepEqual(parseRoute("/about", "#my-slug"), view("about"));
    });

    test("unknown paths fall back to home", () => {
        assert.deepEqual(parseRoute("/nope"), view("home"));
        assert.deepEqual(parseRoute("/about/extra"), view("home"));
        assert.deepEqual(parseRoute("/work/a/b"), view("home"));
        assert.deepEqual(parseRoute("/legal/extra"), view("home"));
        assert.deepEqual(parseRoute(undefined), view("home"));
    });
});

describe("path builders", () => {
    test("sectionPath", () => {
        assert.equal(sectionPath("home"), "/");
        assert.equal(sectionPath("work"), "/work");
        assert.equal(sectionPath("privacy"), "/privacy");
    });

    test("workPath encodes the slug and round-trips through parseRoute", () => {
        assert.equal(workPath("my-slug"), "/work/my-slug");
        assert.equal(workPath("a b"), "/work/a%20b");
        assert.equal(parseRoute(workPath("café")).slug, "café");
    });
});
