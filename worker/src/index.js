/**
 * Cloudflare Worker: sisyfuz-counter
 *
 * Proxies press-counter increments and live-stream state to Sanity
 * so the write token stays server-side. Deploy with `npx wrangler deploy`.
 *
 * Environment secrets (set via `npx wrangler secret put`):
 *   SANITY_WRITE_TOKEN — Sanity Editor-level API token
 *   BROADCAST_SECRET   — shared secret for POST /live. REQUIRED: if it is
 *                        unset, POST /live is rejected (fail closed).
 *
 * Bindings (wrangler.toml):
 *   RATE_LIMITER — Workers Rate Limiting binding. When absent (local tests),
 *                  a best-effort per-isolate in-memory limiter is used.
 *
 * Routes:
 *   OPTIONS *      CORS preflight
 *   POST    /      increment the press-button counter (Origin must be allowed)
 *   GET     /live  public live-stream state ({ url, active, ... })
 *   POST    /live  update live-stream state (X-Broadcast-Secret or Bearer auth)
 */

const SANITY_PROJECT_ID = "gt7prmxg";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2026-04-17";
const SANITY_BASE = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data`;
const SANITY_MUTATE_URL = `${SANITY_BASE}/mutate/${SANITY_DATASET}`;
const SANITY_QUERY_URL = `${SANITY_BASE}/query/${SANITY_DATASET}`;

const COUNTER_ID = "site-button-counter";
const LIVE_ID = "site-live-stream";

const ALLOWED_ORIGINS = [
  "https://sisyfuz.com",
  "http://localhost:5173", // local dev
  "http://localhost:4173", // vite preview
];

const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 10_000;
const MAX_STREAM_URL_LENGTH = 250;

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", ...extraHeaders },
  });
}

class UpstreamError extends Error {}

// Best-effort fallback limiter. It is per-isolate, so it only applies when the
// RATE_LIMITER binding is missing (e.g. local tests or a misconfigured deploy).
const ipRateLimits = new Map();

function checkMemoryRateLimit(key, limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  const timestamps = (ipRateLimits.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    ipRateLimits.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  ipRateLimits.set(key, timestamps);
  if (ipRateLimits.size > 2000) {
    for (const [k, v] of ipRateLimits.entries()) {
      if (v.every((t) => now - t >= windowMs)) ipRateLimits.delete(k);
    }
  }
  return true;
}

async function isRateLimited(request, env) {
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  const binding = env && env.RATE_LIMITER;
  if (binding && typeof binding.limit === "function") {
    try {
      const { success } = await binding.limit({ key });
      return !success;
    } catch (err) {
      console.error("Rate limiter binding failed, using in-memory fallback:", err);
    }
  }
  return !checkMemoryRateLimit(key);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// Constant-time comparison: both inputs are hashed to fixed-length digests,
// so neither the length nor the content of the secret leaks through timing.
async function secretsMatch(provided, expected) {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function providedBroadcastSecret(request) {
  const header = request.headers.get("X-Broadcast-Secret");
  if (header) return header;
  const auth = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1] : "";
}

function isValidStreamUrl(value) {
  if (typeof value !== "string" || value.length > MAX_STREAM_URL_LENGTH) return false;
  if (!value.startsWith("https://")) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

async function sanityMutate(env, mutations, query = "") {
  const res = await fetch(`${SANITY_MUTATE_URL}${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SANITY_WRITE_TOKEN}`,
    },
    body: JSON.stringify({ mutations }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`Sanity mutate failed (${res.status}):`, errText);
    throw new UpstreamError("Sanity mutate failed");
  }
  return res.json();
}

// -------------------------------------------------------------
// Route handlers
// -------------------------------------------------------------

async function getLive(origin) {
  const query = encodeURIComponent(`*[_id=="${LIVE_ID}"][0]`);
  const res = await fetch(`${SANITY_QUERY_URL}?query=${query}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`Sanity query failed (${res.status}):`, errText);
    throw new UpstreamError("Sanity query failed");
  }
  const data = await res.json();
  return json(data.result || { url: "", active: false }, 200, origin);
}

async function postLive(request, env, origin) {
  const secret = env.BROADCAST_SECRET;
  if (!secret || !env.SANITY_WRITE_TOKEN) {
    console.error("POST /live rejected: BROADCAST_SECRET or SANITY_WRITE_TOKEN is not configured");
    return json({ error: "Service unavailable" }, 503, origin);
  }

  if (await isRateLimited(request, env)) {
    return json({ error: "Too many requests. Please slow down." }, 429, origin);
  }

  const provided = providedBroadcastSecret(request);
  if (!provided || !(await secretsMatch(provided, secret))) {
    return json({ error: "Unauthorized" }, 401, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  // Validate stream URL to prevent arbitrary redirects / script URLs
  if (body.url !== undefined && body.url !== "" && !isValidStreamUrl(body.url)) {
    return json({ error: "Invalid stream URL: Must be a valid secure HTTPS URL" }, 400, origin);
  }

  await sanityMutate(env, [
    {
      createIfNotExists: {
        _id: LIVE_ID,
        _type: "liveStream",
        url: "",
        active: false,
      },
    },
    {
      patch: {
        id: LIVE_ID,
        set: {
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
          updatedAt: new Date().toISOString(),
        },
      },
    },
  ]);

  return json({ success: true, url: body.url, active: body.active }, 200, origin);
}

async function incrementCounter(request, env, origin) {
  // Verify Origin (block third-party spam bots and non-browser clients)
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: "Forbidden origin" }, 403, origin);
  }

  if (await isRateLimited(request, env)) {
    return json({ error: "Too many requests. Please slow down." }, 429, origin);
  }

  if (!env.SANITY_WRITE_TOKEN) {
    console.error("Counter rejected: SANITY_WRITE_TOKEN is not configured");
    return json({ error: "Service unavailable" }, 503, origin);
  }

  // Single transaction: ensure the document exists, then increment it.
  const data = await sanityMutate(
    env,
    [
      { createIfNotExists: { _id: COUNTER_ID, _type: "buttonCounter", count: 0 } },
      { patch: { id: COUNTER_ID, inc: { count: 1 } } },
    ],
    "?returnDocuments=true"
  );

  const results = Array.isArray(data && data.results) ? data.results : [];
  let count;
  for (let i = results.length - 1; i >= 0; i--) {
    const doc = results[i] && results[i].document;
    if (doc && doc._id === COUNTER_ID && typeof doc.count === "number") {
      count = doc.count;
      break;
    }
  }
  if (count === undefined) {
    console.error("Sanity mutate response did not include the counter document");
    throw new UpstreamError("Missing counter in Sanity response");
  }

  return json({ count }, 200, origin);
}

async function handle(request, env, origin) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (url.pathname === "/live") {
    if (request.method === "GET") return getLive(origin);
    if (request.method === "POST") return postLive(request, env, origin);
    return json({ error: "Method not allowed" }, 405, origin, { Allow: "GET, POST, OPTIONS" });
  }

  if (url.pathname === "/") {
    if (request.method === "POST") return incrementCounter(request, env, origin);
    return json({ error: "Method not allowed" }, 405, origin, { Allow: "POST, OPTIONS" });
  }

  return json({ error: "Not found" }, 404, origin);
}

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get("Origin") || "";
    try {
      return await handle(request, env, origin);
    } catch (err) {
      if (!(err instanceof UpstreamError)) console.error("Unhandled worker error:", err);
      return json({ error: "Upstream service error" }, 502, origin);
    }
  },
};
