/**
 * Cloudflare Worker: sisyfuz-counter
 *
 * Proxies press-counter increments and live-stream state to Sanity
 * so the write token stays server-side. Deploy with `npx wrangler deploy`.
 *
 * Environment secrets (set via `npx wrangler secret put`):
 *   SANITY_WRITE_TOKEN — your Sanity Editor-level API token
 */

const SANITY_PROJECT_ID = "gt7prmxg";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2026-04-17";
const COUNTER_ID = "site-button-counter";
const LIVE_ID = "site-live-stream";

const ALLOWED_ORIGINS = [
  "https://sisyfuz.com",
  "http://localhost:5173",    // local dev
  "http://localhost:4173",    // vite preview
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const ipRateLimits = new Map();

function checkRateLimit(ip, limit = 15, windowMs = 10000) {
  const now = Date.now();
  const timestamps = (ipRateLimits.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    return false;
  }
  timestamps.push(now);
  ipRateLimits.set(ip, timestamps);
  if (ipRateLimits.size > 2000) {
    for (const [k, v] of ipRateLimits.entries()) {
      if (v.every((t) => now - t >= windowMs)) ipRateLimits.delete(k);
    }
  }
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const sanityMutateUrl = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/mutate/${SANITY_DATASET}`;
    const sanityQueryUrl = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}`;

    // -------------------------------------------------------------
    // ROUTE: /live - Manage global live stream broadcast URL & active state
    // -------------------------------------------------------------
    if (url.pathname === "/live") {
      if (request.method === "GET") {
        const queryRes = await fetch(`${sanityQueryUrl}?query=*[_id=="${LIVE_ID}"][0]`);
        const queryData = await queryRes.json();
        return new Response(JSON.stringify(queryData.result || { url: "", active: false }), {
          status: 200,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        });
      }

      if (request.method === "POST") {
        // Authenticate Broadcast Secret if set in worker environment
        const secret = env.BROADCAST_SECRET;
        if (secret) {
          const authHeader = request.headers.get("X-Broadcast-Secret") || request.headers.get("Authorization");
          if (authHeader !== secret && authHeader !== `Bearer ${secret}`) {
            return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing broadcast secret" }), {
              status: 401,
              headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
            });
          }
        }

        let body = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }

        // Validate stream URL pattern to prevent arbitrary redirects
        if (body.url !== undefined && body.url !== "") {
          if (typeof body.url !== "string" || !body.url.startsWith("https://") || body.url.length > 250) {
            return new Response(JSON.stringify({ error: "Invalid stream URL: Must be a valid secure HTTPS URL" }), {
              status: 400,
              headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
            });
          }
        }

        const mutateRes = await fetch(sanityMutateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.SANITY_WRITE_TOKEN}`,
          },
          body: JSON.stringify({
            mutations: [
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
            ],
          }),
        });

        if (!mutateRes.ok) {
          const errText = await mutateRes.text();
          return new Response(JSON.stringify({ error: "Failed to update live stream", details: errText }), {
            status: 500,
            headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true, url: body.url, active: body.active }), {
          status: 200,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        });
      }
    }

    // -------------------------------------------------------------
    // ROUTE: Default - Button Counter Increment
    // -------------------------------------------------------------
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Verify Origin (block third-party spam bots)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // IP Rate Limiting (max 15 clicks per 10s window per IP)
    const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "anon";
    if (!checkRateLimit(clientIp, 15, 10000)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
        status: 429,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // First, ensure the document exists
    const createRes = await fetch(sanityMutateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.SANITY_WRITE_TOKEN}`,
      },
      body: JSON.stringify({
        mutations: [
          {
            createIfNotExists: {
              _id: COUNTER_ID,
              _type: "buttonCounter",
              count: 0,
            },
          },
        ],
      }),
    });

    if (!createRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to ensure counter exists" }), {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Increment the counter
    const patchRes = await fetch(sanityMutateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.SANITY_WRITE_TOKEN}`,
      },
      body: JSON.stringify({
        mutations: [
          {
            patch: {
              id: COUNTER_ID,
              inc: { count: 1 },
            },
          },
        ],
      }),
    });

    if (!patchRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to increment" }), {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // The response contains the transaction, get the updated count by querying
    const queryUrl = `${sanityQueryUrl}?query=*[_id=="${COUNTER_ID}"][0].count`;
    const queryRes = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${env.SANITY_WRITE_TOKEN}` },
    });
    const queryData = await queryRes.json();

    return new Response(JSON.stringify({ count: queryData.result ?? 0 }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
