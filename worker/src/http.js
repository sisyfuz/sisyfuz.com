/**
 * Shared HTTP helpers for the sisyfuz-counter worker: CORS, JSON responses,
 * rate limiting and constant-time secret comparison.
 */

export const ALLOWED_ORIGINS = [
  "https://sisyfuz.com",
  "http://localhost:5173", // local dev
  "http://localhost:4173", // vite preview
];

const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 10_000;

export function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function json(data, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", ...extraHeaders },
  });
}

export class UpstreamError extends Error {}

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

/**
 * Best-effort per-isolate limit for an arbitrary key (e.g. a logged-in person).
 * @returns {boolean} true when the key is over the limit
 */
export function isKeyRateLimited(key, limit, windowMs) {
  return !checkMemoryRateLimit(key, limit, windowMs);
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export async function isRateLimited(request, env) {
  const key = clientIp(request);
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

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// Constant-time comparison: both inputs are hashed to fixed-length digests,
// so neither the length nor the content of the secret leaks through timing.
export async function secretsMatch(provided, expected) {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
