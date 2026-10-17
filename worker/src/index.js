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
        let body = {};
        try {
          body = await request.json();
        } catch {
          body = {};
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
