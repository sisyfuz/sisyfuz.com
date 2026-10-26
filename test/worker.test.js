// test/worker.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";

const BASE = "https://sisyfuz-counter.sisyfuz.workers.dev";
const GOOD_ORIGIN = "https://sisyfuz.com";
const SECRET = "test-broadcast-secret";
const TOKEN = "test-sanity-token";

let ipCounter = 0;
const uniqueIp = () => `203.0.113.${++ipCounter}`;

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let calls;
let errorLogs;
let nextResponse;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function counterResult(count) {
  return {
    transactionId: "tx1",
    results: [
      { id: "site-button-counter", operation: "none", document: { _id: "site-button-counter", count: count - 1 } },
      { id: "site-button-counter", operation: "update", document: { _id: "site-button-counter", count } },
    ],
  };
}

beforeEach(() => {
  calls = [];
  errorLogs = [];
  nextResponse = () => jsonResponse({ transactionId: "tx1", results: [] });
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return nextResponse(url, init);
  };
  console.error = (...args) => errorLogs.push(args.map(String).join(" "));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

function req(path, { method = "GET", headers = {}, body, ip = uniqueIp() } = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { "CF-Connecting-IP": ip, ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const env = (extra = {}) => ({ SANITY_WRITE_TOKEN: TOKEN, BROADCAST_SECRET: SECRET, ...extra });

describe("Worker: sisyfuz-counter", () => {
  test("OPTIONS preflight returns 204 with CORS headers for allowed origin", async () => {
    const res = await worker.fetch(req("/", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } }), env());
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
    assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
    assert.equal(calls.length, 0);
  });

  test("OPTIONS preflight from unknown origin does not echo it", async () => {
    const res = await worker.fetch(req("/", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env());
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
  });

  describe("GET /live", () => {
    test("returns the live document from Sanity", async () => {
      nextResponse = () => jsonResponse({ result: { url: "https://stream.example/live.m3u8", active: true, updatedAt: "x" } });
      const res = await worker.fetch(req("/live", { headers: { Origin: GOOD_ORIGIN } }), env());
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
      assert.deepEqual(await res.json(), { url: "https://stream.example/live.m3u8", active: true, updatedAt: "x" });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/data\/query\/production\?query=/);
      assert.ok(decodeURIComponent(calls[0].url).includes('*[_id=="site-live-stream"][0]'));
    });

    test("returns default shape when no document exists", async () => {
      nextResponse = () => jsonResponse({ result: null });
      const res = await worker.fetch(req("/live"), env());
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { url: "", active: false });
    });
  });

  describe("POST /live", () => {
    const body = { url: "https://stream.example/live.m3u8", active: true };

    test("rejected (fail closed) when BROADCAST_SECRET is not configured", async () => {
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { "X-Broadcast-Secret": "anything" }, body }),
        env({ BROADCAST_SECRET: undefined })
      );
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "Service unavailable" });
      assert.equal(calls.length, 0);
    });

    test("rejected with 401 when the secret is missing", async () => {
      const res = await worker.fetch(req("/live", { method: "POST", body }), env());
      assert.equal(res.status, 401);
      assert.equal(calls.length, 0);
    });

    test("rejected with 401 for a wrong secret", async () => {
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { "X-Broadcast-Secret": "wrong" }, body }),
        env()
      );
      assert.equal(res.status, 401);
      assert.equal(calls.length, 0);
    });

    test("rejected with 401 for a wrong Bearer token", async () => {
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { Authorization: `Bearer ${SECRET}x` }, body }),
        env()
      );
      assert.equal(res.status, 401);
      assert.equal(calls.length, 0);
    });

    for (const [label, headers] of [
      ["X-Broadcast-Secret header", { "X-Broadcast-Secret": SECRET }],
      ["Authorization: Bearer header", { Authorization: `Bearer ${SECRET}` }],
    ]) {
      test(`accepted with correct secret via ${label}`, async () => {
        const res = await worker.fetch(req("/live", { method: "POST", headers, body }), env());
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { success: true, url: body.url, active: true });
        assert.equal(calls.length, 1);
        const call = calls[0];
        assert.match(call.url, /^https:\/\/gt7prmxg\.api\.sanity\.io\/v2026-04-17\/data\/mutate\/production/);
        assert.equal(call.init.method, "POST");
        assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
        const [create, patch] = call.body.mutations;
        assert.equal(create.createIfNotExists._id, "site-live-stream");
        assert.equal(patch.patch.id, "site-live-stream");
        assert.equal(patch.patch.set.url, body.url);
        assert.equal(patch.patch.set.active, true);
      });
    }

    for (const badUrl of ["http://stream.example/live.m3u8", "javascript:alert(1)", "https://", 42, `https://a.example/${"x".repeat(300)}`]) {
      test(`invalid stream URL ${JSON.stringify(badUrl).slice(0, 40)} → 400`, async () => {
        const res = await worker.fetch(
          req("/live", { method: "POST", headers: { "X-Broadcast-Secret": SECRET }, body: { url: badUrl, active: true } }),
          env()
        );
        assert.equal(res.status, 400);
        assert.equal(calls.length, 0);
      });
    }

    test("empty url (going offline) is accepted", async () => {
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { "X-Broadcast-Secret": SECRET }, body: { url: "", active: false } }),
        env()
      );
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
    });

    test("invalid JSON body → 400", async () => {
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { "X-Broadcast-Secret": SECRET }, body: "{not json" }),
        env()
      );
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0);
    });
  });

  describe("POST / (counter)", () => {
    test("allowed origin → one Sanity transaction and returns the new count", async () => {
      nextResponse = () => jsonResponse(counterResult(42));
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN } }), env());
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
      assert.deepEqual(await res.json(), { count: 42 });
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.match(call.url, /\/data\/mutate\/production\?returnDocuments=true$/);
      assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
      assert.deepEqual(call.body.mutations, [
        { createIfNotExists: { _id: "site-button-counter", _type: "buttonCounter", count: 0 } },
        { patch: { id: "site-button-counter", inc: { count: 1 } } },
      ]);
    });

    test("missing Origin → 403", async () => {
      const res = await worker.fetch(req("/", { method: "POST" }), env());
      assert.equal(res.status, 403);
      assert.equal(calls.length, 0);
    });

    test("foreign Origin → 403", async () => {
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: "https://evil.example" } }), env());
      assert.equal(res.status, 403);
      assert.equal(calls.length, 0);
    });

    test("GET / → 405", async () => {
      const res = await worker.fetch(req("/", { headers: { Origin: GOOD_ORIGIN } }), env());
      assert.equal(res.status, 405);
    });
  });

  describe("rate limiting", () => {
    test("uses the RATE_LIMITER binding keyed by CF-Connecting-IP", async () => {
      const keys = [];
      const RATE_LIMITER = {
        async limit({ key }) {
          keys.push(key);
          return { success: false };
        },
      };
      const res = await worker.fetch(
        req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN }, ip: "198.51.100.7" }),
        env({ RATE_LIMITER })
      );
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
      assert.deepEqual(keys, ["198.51.100.7"]);
      assert.equal(calls.length, 0);
    });

    test("binding allowing the request lets it through", async () => {
      nextResponse = () => jsonResponse(counterResult(7));
      const RATE_LIMITER = { limit: async () => ({ success: true }) };
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN } }), env({ RATE_LIMITER }));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { count: 7 });
    });

    test("falls back to the in-memory limiter without a binding (16th request → 429)", async () => {
      nextResponse = () => jsonResponse(counterResult(1));
      const ip = "198.51.100.99";
      for (let i = 0; i < 15; i++) {
        const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN }, ip }), env());
        assert.equal(res.status, 200, `request ${i + 1} should pass`);
      }
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN }, ip }), env());
      assert.equal(res.status, 429);
      assert.equal(calls.length, 15);
    });

    test("POST /live is rate limited too", async () => {
      const RATE_LIMITER = { limit: async () => ({ success: false }) };
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { "X-Broadcast-Secret": SECRET }, body: { active: false } }),
        env({ RATE_LIMITER })
      );
      assert.equal(res.status, 429);
      assert.equal(calls.length, 0);
    });
  });

  describe("upstream failures", () => {
    const leak = "SECRET-UPSTREAM-DETAIL token=abc123";

    test("Sanity error on counter → 502 with CORS, no details leaked", async () => {
      nextResponse = () => new Response(leak, { status: 500 });
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN } }), env());
      assert.equal(res.status, 502);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
      const text = await res.text();
      assert.ok(!text.includes(leak));
      assert.deepEqual(JSON.parse(text), { error: "Upstream service error" });
      assert.ok(errorLogs.some((l) => l.includes(leak)), "upstream body should be logged server-side");
    });

    test("Sanity error on POST /live → 502, no details leaked", async () => {
      nextResponse = () => new Response(leak, { status: 403 });
      const res = await worker.fetch(
        req("/live", { method: "POST", headers: { "X-Broadcast-Secret": SECRET, Origin: GOOD_ORIGIN }, body: { active: true } }),
        env()
      );
      assert.equal(res.status, 502);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
      const text = await res.text();
      assert.ok(!text.includes(leak));
      assert.ok(!text.includes("details"));
    });

    test("network failure on GET /live → 502 with CORS", async () => {
      nextResponse = () => {
        throw new TypeError("fetch failed");
      };
      const res = await worker.fetch(req("/live", { headers: { Origin: "http://localhost:4173" } }), env());
      assert.equal(res.status, 502);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:4173");
      assert.equal(res.headers.get("Content-Type"), "application/json");
    });

    test("bad JSON from Sanity → 502", async () => {
      nextResponse = () => new Response("<html>not json</html>", { status: 200 });
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN } }), env());
      assert.equal(res.status, 502);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), GOOD_ORIGIN);
    });

    test("counter response without document → 502", async () => {
      nextResponse = () => jsonResponse({ transactionId: "tx1", results: [] });
      const res = await worker.fetch(req("/", { method: "POST", headers: { Origin: GOOD_ORIGIN } }), env());
      assert.equal(res.status, 502);
    });
  });
});
