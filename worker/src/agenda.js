/**
 * Private shared agenda for two people, stored in D1 (binding: AGENDA_DB).
 *
 * Environment secrets (set via `npx wrangler secret put`):
 *   AGENDA_SESSION_KEY  — random key that signs session tokens (>= 32 chars).
 *                         Every agenda route fails closed (503) without it.
 *   AGENDA_ADMIN_KEY    — random key (>= 32 chars) for the /agenda/admin routes
 *                         (scripts/agenda-admin.mjs). Without it they answer 503.
 *   AGENDA_NAME_<ID>    — display name of a person (e.g. AGENDA_NAME_PARTNER).
 *                         Names live only in secrets so this public repository
 *                         never contains them; they are sent only after a
 *                         login or with a valid setup code.
 *   AGENDA_PASS_<ID>    — optional fixed passphrase for a person, used only
 *                         while that person has no password of their own.
 *
 * Passwords people choose themselves are stored in D1 as salted PBKDF2 hashes
 * only, so nobody (not even whoever runs the worker) can read them. Choosing
 * one needs a one-time setup code from the admin route; "forgot password" is
 * the same route: it wipes the password at once and hands out a new code.
 * Using a code uses it up, so a code someone else already used shows as used.
 *
 * Logging in is a single passphrase field: the passphrase says who you are.
 * Sessions are stateless HMAC-signed tokens. The signing key mixes in the
 * person's password hash (or fixed passphrase), so a new or reset password
 * logs that person out everywhere, and changing AGENDA_SESSION_KEY logs
 * everyone out.
 *
 * Wrong passphrases and wrong setup codes are counted in D1 per client IP
 * (IPv6 per /64) and globally. Too many lock them before anything is checked.
 *
 * Routes (all require `Authorization: Bearer <token>` except login and setup):
 *   POST   /agenda/login                 { passphrase } -> { token, expiresAt, me, people }
 *   POST   /agenda/setup/check           { code } -> { person, name }
 *   POST   /agenda/setup                 { code, passphrase } -> same as login
 *   GET    /agenda/admin/status          admin key -> { people: [{ person, password, codeExpiresAt }] }
 *   POST   /agenda/admin/reset           admin key, { person } -> { person, code, expiresAt }
 *   GET    /agenda/me                    -> { me, people }
 *   GET    /agenda/rev                   -> { rev } (bumped by every change; phones poll this
 *                                         and only reload items when it moved)
 *   GET    /agenda/events?from=&to=      -> { events, rev } overlapping [from, to], plus yearly items
 *   POST   /agenda/events                create -> { event }
 *   PATCH  /agenda/events/:id            update (needs current `version`) -> { event }
 *   DELETE /agenda/events/:id            -> { success }
 *   POST   /agenda/events/:id/response   { response: "akkoord" | "niet" | null } -> { event }
 *   POST   /agenda/import                { events: [...] } -> { added, updated, unchanged }
 *   POST   /agenda/seen                  { ids: [...], level: "seen" | "read" } -> { success }
 *   *      /agenda/stickers, /agenda/placements, /agenda/events/style
 *                                        pixel stickers, logos and colours (see agendaStickers.js)
 *
 * An item is an "afspraak" (appointment), "onbeschikbaar" (busy, with a reason
 * such as school or therapie), "bijzonder" (a special day: verjaardag, jubileum
 * or anders; single day, usually repeating every year with `repeat: "jaarlijks"`)
 * or "periode" (a stretch of whole days such as zomervakantie). Yearly items are
 * returned for every range; the client places them in each year. Imported items carry the calendar file's
 * UID, so importing the same file again updates them instead of adding copies.
 *
 * Per person and item there are three steps: seen (it was on their screen),
 * read (they opened it, hovered on it or pressed and held it) and a response.
 * Reading implies seeing, responding implies both. Whoever creates or changes
 * an item has read it and agrees to it; the other person's steps are reset, so
 * every change has to be seen, read and agreed again.
 */

import { ALLOWED_ORIGINS, clientIp, isKeyRateLimited, isRateLimited, json, secretsMatch, sha256 } from "./http.js";
import { DAY_STICKER_MIGRATION, STICKER_MIGRATION, checkLogo, handleStickers, isStickerPath, parseStyle, toPlacement } from "./agendaStickers.js";

// Ids are fixed and generic; real names come from AGENDA_NAME_<ID> secrets.
export const PEOPLE = [
  { id: "dorus", name: "DORUS", color: "#ff6fae" },
  { id: "partner", name: "PARTNER", color: "#ff9f43" },
];
const PERSON_IDS = PEOPLE.map((p) => p.id);
const FOR_WHO = [...PERSON_IDS, "samen"];
const RESPONSES = ["akkoord", "niet"];

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_SESSION_KEY_LENGTH = 32;
const MIN_ADMIN_KEY_LENGTH = 32;

// Cloudflare Workers allow at most 100k PBKDF2 iterations. The count is stored
// per password, so it can change later without breaking existing ones.
const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 256;
const SETUP_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 32 letters and digits without look-alikes (0/O, 1/I); 20 of them = 100 bits.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 20;

export const LOGIN_GUARD = Object.freeze({
  ipMaxFailures: 5,
  ipWindowMs: 15 * 60 * 1000,
  ipBaseLockMs: 15 * 60 * 1000, // doubles with every lockout in a row
  ipMaxLockMs: 24 * 60 * 60 * 1000,
  lockoutMemoryMs: 24 * 60 * 60 * 1000, // quiet this long and the doubling starts over
  globalMaxFailures: 25,
  globalWindowMs: 60 * 60 * 1000,
  globalLockMs: 60 * 60 * 1000,
});
const DEFAULT_FAIL_DELAY_MS = 600;
const GUARD_CLEANUP_CHANCE = 0.05;
const GUARD_FORGET_MS = 2 * 24 * 60 * 60 * 1000;
// Logged-in use (loading ranges, seen/read, saving) is bursty and both phones may
// share one home IP, so it gets its own, roomier limit per person. Login keeps the
// strict per-IP limit plus the lockout.
const SESSION_RATE_LIMIT = 60;
const SESSION_RATE_WINDOW_MS = 10_000;

const MAX_BODY_BYTES = 16 * 1024;
const MAX_IMPORT_BODY_BYTES = 512 * 1024;
const MAX_IMPORT_EVENTS = 200;
const MAX_REASON = 40;
const MAX_UID = 300;
const KINDS = ["afspraak", "onbeschikbaar", "bijzonder", "periode"];
const SPECIAL_TYPES = ["verjaardag", "jubileum", "anders"];
const SPECIAL_DEFAULT_TITLE = { jubileum: "samen" };
const REPEATS = ["", "jaarlijks"];
const MAX_TITLE = 120;
const MAX_LOCATION = 120;
const MAX_NOTE = 2000;
const MAX_RANGE_DAYS = 400;
const MAX_EVENT_DAYS = 366;
const MAX_SEEN_IDS = 200;
const SEEN_LEVELS = ["seen", "read"];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agenda_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    location TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    for_who TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'afspraak',
    reason TEXT NOT NULL DEFAULT '',
    repeat TEXT NOT NULL DEFAULT '',
    count_years INTEGER NOT NULL DEFAULT 0,
    source_uid TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  // Ranges are found by end_date (views look at today and later, so old items are
  // skipped); yearly items by a small partial index that holds only them.
  `CREATE INDEX IF NOT EXISTS agenda_events_end ON agenda_events (end_date)`,
  `CREATE INDEX IF NOT EXISTS agenda_events_yearly ON agenda_events (id) WHERE repeat = 'jaarlijks'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agenda_events_source_uid ON agenda_events (source_uid)`,
  `CREATE TABLE IF NOT EXISTS agenda_status (
    event_id TEXT NOT NULL,
    person TEXT NOT NULL,
    seen_at TEXT,
    read_at TEXT,
    response TEXT,
    responded_at TEXT,
    PRIMARY KEY (event_id, person)
  )`,
  `CREATE TABLE IF NOT EXISTS agenda_credentials (
    person TEXT PRIMARY KEY,
    hash TEXT,
    salt TEXT,
    iterations INTEGER,
    setup_code_hash TEXT,
    setup_expires INTEGER,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agenda_meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agenda_login_guard (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    lockouts INTEGER NOT NULL DEFAULT 0
  )`,
];

// SCHEMA is how the first version of the database looked. The live database already
// exists, so later changes are one-time migrations; the number of the last one that
// ran is kept in agenda_meta under 'schema'.
const MIGRATIONS = [STICKER_MIGRATION, DAY_STICKER_MIGRATION];

const schemaReady = new WeakSet();

async function migrate(db) {
  const row = await db.prepare("SELECT value FROM agenda_meta WHERE key = 'schema'").first();
  let version = row ? row.value : 1;
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    for (const sql of migration.alter) {
      try {
        await db.prepare(sql).run();
      } catch (err) {
        // Another isolate (or an earlier, interrupted run) added it already.
        if (!/duplicate column/i.test(`${err?.message} ${err?.cause?.message}`)) throw err;
      }
    }
    await db.batch([
      ...migration.create.map((sql) => db.prepare(sql)),
      db
        .prepare("INSERT INTO agenda_meta (key, value) VALUES ('schema', ?1) ON CONFLICT(key) DO UPDATE SET value = MAX(value, ?1)")
        .bind(migration.version),
    ]);
    version = migration.version;
  }
}

async function ensureSchema(db) {
  if (schemaReady.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  await migrate(db);
  schemaReady.add(db);
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" };

function reply(data, status, origin, extraHeaders = {}) {
  return json(data, status, origin, { ...NO_STORE, ...extraHeaders });
}

function isConfigured(env) {
  return Boolean(
    env.AGENDA_DB && typeof env.AGENDA_SESSION_KEY === "string" && env.AGENDA_SESSION_KEY.length >= MIN_SESSION_KEY_LENGTH
  );
}

function displayName(env, id) {
  const name = env[`AGENDA_NAME_${id.toUpperCase()}`];
  return (typeof name === "string" && name.trim() ? name.trim() : PEOPLE.find((p) => p.id === id).name).toUpperCase();
}

function fixedPassphrase(env, id) {
  const value = env[`AGENDA_PASS_${id.toUpperCase()}`];
  return typeof value === "string" && value ? value : null;
}

function publicPeople(env) {
  return PEOPLE.map(({ id, color }) => ({ id, name: displayName(env, id), color }));
}

function otherPerson(person) {
  return PERSON_IDS.find((id) => id !== person);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// -------------------------------------------------------------
// Passwords
// -------------------------------------------------------------

const encode = (text) => new TextEncoder().encode(text);

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadCredential(db, person) {
  return db.prepare("SELECT * FROM agenda_credentials WHERE person = ?").bind(person).first();
}

async function loadCredentials(db) {
  const { results } = await db.prepare("SELECT * FROM agenda_credentials").all();
  return Object.fromEntries(results.map((r) => [r.person, r]));
}

// What a person's sessions are tied to. A stored row wins over a fixed
// passphrase; a row without a hash (reset, waiting for a new password) means
// nobody can log in as that person.
function credentialMaterial(env, person, cred) {
  if (cred) return cred.hash ? `db:${cred.hash}` : null;
  const fixed = fixedPassphrase(env, person);
  return fixed ? `env:${fixed}` : null;
}

async function pbkdf2(passphrase, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(passphrase, salt, PBKDF2_ITERATIONS);
  return { hash: base64url(hash), salt: base64url(salt), iterations: PBKDF2_ITERATIONS };
}

async function passwordMatches(passphrase, cred) {
  if (!cred?.hash || !cred.salt || !cred.iterations) return false;
  const hash = await pbkdf2(passphrase, fromBase64url(cred.salt), cred.iterations);
  return secretsMatch(base64url(hash), cred.hash);
}

/** Which person a passphrase belongs to, or null. Every person is checked. */
async function personForPassphrase(env, db, passphrase) {
  const creds = await loadCredentials(db);
  const matches = await Promise.all(
    PEOPLE.map(async (p) => {
      const cred = creds[p.id];
      if (cred) return passwordMatches(passphrase, cred);
      const fixed = fixedPassphrase(env, p.id);
      return fixed ? secretsMatch(passphrase, fixed) : false;
    })
  );
  const index = matches.indexOf(true);
  return index === -1 ? null : PEOPLE[index].id;
}

function newSetupCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return chars.match(/.{4}/g).join("-");
}

/** Codes are typed by hand: ignore case, spaces and dashes. */
function normalizeCode(code) {
  return typeof code === "string" ? code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

async function codeHash(code) {
  return hex(await sha256(`agenda-setup\u0000${normalizeCode(code)}`));
}

/** The person a still-valid setup code belongs to, or null. */
async function personForCode(db, code, now) {
  if (normalizeCode(code).length !== CODE_LENGTH) return null;
  const row = await db
    .prepare("SELECT person FROM agenda_credentials WHERE setup_code_hash = ? AND setup_expires > ?")
    .bind(await codeHash(code), now)
    .first();
  return row && PERSON_IDS.includes(row.person) ? row.person : null;
}

// -------------------------------------------------------------
// Sessions
// -------------------------------------------------------------

async function signingKey(env, person, material) {
  const keyBytes = await sha256(`${env.AGENDA_SESSION_KEY}\u0000${person}\u0000${material}`);
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueToken(env, person, now = Date.now()) {
  const material = credentialMaterial(env, person, await loadCredential(env.AGENDA_DB, person));
  if (!material) throw new Error(`No credential for ${person}`);
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `v1.${person}.${now}.${expiresAt}`;
  const key = await signingKey(env, person, material);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encode(payload)));
  return { token: `${payload}.${base64url(sig)}`, expiresAt };
}

async function verifyToken(env, token, now = Date.now()) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, person, issued, expires, sig] = parts;
  if (!PERSON_IDS.includes(person)) return null;
  if (!/^\d+$/.test(issued) || !/^\d+$/.test(expires)) return null;
  if (Number(expires) <= now || Number(issued) > now + 60_000) return null;
  let sigBytes;
  try {
    sigBytes = fromBase64url(sig);
  } catch {
    return null;
  }
  const material = credentialMaterial(env, person, await loadCredential(env.AGENDA_DB, person));
  if (!material) return null;
  const key = await signingKey(env, person, material);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, encode(parts.slice(0, 4).join(".")));
  return ok ? person : null;
}

async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(auth);
  return match ? verifyToken(env, match[1]) : null;
}

// Reads at most `maxBytes`, also when there is no (honest) Content-Length.
async function readBody(request, maxBytes = MAX_BODY_BYTES) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) return { error: "Te groot" };
  let text = "";
  try {
    if (request.body) {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          return { error: "Te groot" };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
  } catch {
    return { error: "Ongeldige invoer" };
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Ongeldige invoer" };
    return { body };
  } catch {
    return { error: "Ongeldige invoer" };
  }
}

// IPv6 clients usually control a whole /64, so count it as one client.
function guardKeyForIp(ip) {
  if (!ip.includes(":")) return `ip:${ip}`;
  const [head] = ip.split("::");
  const groups = head.split(":").filter(Boolean).slice(0, 4);
  return `ip6:${groups.join(":")}`;
}

// -------------------------------------------------------------
// Login guard
// -------------------------------------------------------------

// Counts one attempt atomically and returns the row. Every attempt is counted
// before the passphrase is checked, so parallel guesses cannot slip past the
// limit. A window restarts after it runs out or once a lock has expired.
function countAttempt(db, key, now, rule) {
  const restart = `(?2 - window_start > ?3 OR (locked_until > 0 AND ?2 >= locked_until AND window_start <= locked_until))`;
  return db
    .prepare(
      `INSERT INTO agenda_login_guard (key, failures, window_start, locked_until, lockouts) VALUES (?1, 1, ?2, 0, 0)
       ON CONFLICT(key) DO UPDATE SET
         failures = CASE WHEN ${restart} THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN ${restart} THEN ?2 ELSE window_start END,
         lockouts = CASE WHEN ?2 - MAX(locked_until, window_start) > ?4 THEN 0 ELSE lockouts END
       RETURNING failures, locked_until, lockouts`
    )
    .bind(key, now, rule.windowMs, rule.memoryMs);
}

// Locks a key unless it is already locked. Each lock in a row lasts twice as long.
async function lock(db, key, now, rule) {
  const row = await db
    .prepare(
      `UPDATE agenda_login_guard SET
         locked_until = ?2 + MIN(?3 * (1 << MIN(lockouts, 16)), ?4),
         window_start = ?2 + MIN(?3 * (1 << MIN(lockouts, 16)), ?4),
         lockouts = lockouts + 1
       WHERE key = ?1 AND locked_until <= ?2
       RETURNING locked_until`
    )
    .bind(key, now, rule.lockMs, rule.maxLockMs)
    .first();
  if (row) return row.locked_until;
  const current = await db.prepare("SELECT locked_until FROM agenda_login_guard WHERE key = ?").bind(key).first();
  return current ? current.locked_until : now;
}

const IP_RULE = {
  max: LOGIN_GUARD.ipMaxFailures,
  windowMs: LOGIN_GUARD.ipWindowMs,
  lockMs: LOGIN_GUARD.ipBaseLockMs,
  maxLockMs: LOGIN_GUARD.ipMaxLockMs,
  memoryMs: LOGIN_GUARD.lockoutMemoryMs,
};
const GLOBAL_RULE = {
  max: LOGIN_GUARD.globalMaxFailures,
  windowMs: LOGIN_GUARD.globalWindowMs,
  lockMs: LOGIN_GUARD.globalLockMs,
  maxLockMs: LOGIN_GUARD.globalLockMs,
  memoryMs: 0,
};

function lockedResponse(lockedUntil, now, origin) {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
  return reply(
    { error: "Te veel verkeerde pogingen. Probeer het later opnieuw.", retryAfter },
    429,
    origin,
    { "Retry-After": String(retryAfter) }
  );
}

/**
 * Counts a guarded attempt (login or setup code) before anything is checked.
 * @returns {Promise<{ lockedUntil: number } | { ipKey: string, ip: object, global: object }>}
 */
async function beginAttempt(db, request, now) {
  const ipKey = guardKeyForIp(clientIp(request));
  const [ipRes, globalRes] = await db.batch([
    countAttempt(db, ipKey, now, IP_RULE),
    countAttempt(db, "global", now, GLOBAL_RULE),
  ]);
  const ip = ipRes.results[0];
  const global = globalRes.results[0];
  const ipOver = ip.failures > IP_RULE.max || ip.locked_until > now;
  const globalOver = global.failures > GLOBAL_RULE.max || global.locked_until > now;
  if (ipOver || globalOver) {
    const until = await Promise.all([
      ipOver ? lock(db, ipKey, now, IP_RULE) : 0,
      globalOver ? lock(db, "global", now, GLOBAL_RULE) : 0,
    ]);
    return { lockedUntil: Math.max(...until) };
  }
  return { ipKey, ip, global };
}

async function attemptSucceeded(db, attempt) {
  await db.batch([
    db.prepare("DELETE FROM agenda_login_guard WHERE key = ?").bind(attempt.ipKey),
    db.prepare("UPDATE agenda_login_guard SET failures = MAX(failures - 1, 0) WHERE key = 'global'"),
  ]);
}

/** After a wrong attempt: waits a little and locks when a limit is reached. Returns the lock end or 0. */
async function attemptFailed(env, db, attempt, now) {
  const delay = env.AGENDA_FAIL_DELAY_MS !== undefined ? Number(env.AGENDA_FAIL_DELAY_MS) : DEFAULT_FAIL_DELAY_MS;
  if (delay > 0) await sleep(delay);
  // Now and then, forget IPs that have been quiet for two days, so the table stays small.
  if (Math.random() < GUARD_CLEANUP_CHANCE) {
    await db
      .prepare("DELETE FROM agenda_login_guard WHERE key != 'global' AND locked_until < ?1 AND window_start < ?1 - ?2")
      .bind(now, GUARD_FORGET_MS)
      .run();
  }
  const until = await Promise.all([
    attempt.ip.failures >= IP_RULE.max ? lock(db, attempt.ipKey, now, IP_RULE) : 0,
    attempt.global.failures >= GLOBAL_RULE.max ? lock(db, "global", now, GLOBAL_RULE) : 0,
  ]);
  const lockedUntil = Math.max(...until);
  return lockedUntil > now ? lockedUntil : 0;
}

function originAllowed(origin) {
  return Boolean(origin) && ALLOWED_ORIGINS.includes(origin);
}

async function sessionReply(env, person, now, origin) {
  const { token, expiresAt } = await issueToken(env, person, now);
  return reply({ token, expiresAt, me: person, people: publicPeople(env) }, 200, origin);
}

async function login(request, env, origin) {
  if (!originAllowed(origin)) return reply({ error: "Forbidden origin" }, 403, origin);
  if (await isRateLimited(request, env)) {
    return reply({ error: "Rustig aan. Probeer het zo opnieuw." }, 429, origin);
  }

  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  const passphrase = typeof body.passphrase === "string" ? body.passphrase.trim() : "";

  const db = env.AGENDA_DB;
  const now = Date.now();
  const attempt = await beginAttempt(db, request, now);
  if (attempt.lockedUntil) return lockedResponse(attempt.lockedUntil, now, origin);

  const person = passphrase && passphrase.length <= MAX_PASSWORD_LENGTH ? await personForPassphrase(env, db, passphrase) : null;
  if (person) {
    await attemptSucceeded(db, attempt);
    return sessionReply(env, person, now, origin);
  }

  const lockedUntil = await attemptFailed(env, db, attempt, now);
  if (lockedUntil) return lockedResponse(lockedUntil, now, origin);
  return reply({ error: "Verkeerd wachtwoord." }, 401, origin);
}

const BAD_CODE = "Deze code klopt niet, is al gebruikt of is verlopen.";

// Step 1 of choosing a password: is this code valid, and whose is it?
async function setupCheck(request, env, origin) {
  if (!originAllowed(origin)) return reply({ error: "Forbidden origin" }, 403, origin);
  if (await isRateLimited(request, env)) {
    return reply({ error: "Rustig aan. Probeer het zo opnieuw." }, 429, origin);
  }
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);

  const db = env.AGENDA_DB;
  const now = Date.now();
  const attempt = await beginAttempt(db, request, now);
  if (attempt.lockedUntil) return lockedResponse(attempt.lockedUntil, now, origin);

  const person = await personForCode(db, body.code, now);
  if (person) {
    await attemptSucceeded(db, attempt);
    return reply({ person, name: displayName(env, person) }, 200, origin);
  }
  const lockedUntil = await attemptFailed(env, db, attempt, now);
  if (lockedUntil) return lockedResponse(lockedUntil, now, origin);
  return reply({ error: BAD_CODE }, 401, origin);
}

// Step 2: store the chosen password (as a hash), use up the code, log in.
async function setupPassword(request, env, origin) {
  if (!originAllowed(origin)) return reply({ error: "Forbidden origin" }, 403, origin);
  if (await isRateLimited(request, env)) {
    return reply({ error: "Rustig aan. Probeer het zo opnieuw." }, 429, origin);
  }
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  const passphrase = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
  if (passphrase.length < MIN_PASSWORD_LENGTH) {
    return reply({ error: `Kies een wachtwoord van minstens ${MIN_PASSWORD_LENGTH} tekens.` }, 400, origin);
  }
  if (passphrase.length > MAX_PASSWORD_LENGTH) return reply({ error: "Dat wachtwoord is te lang." }, 400, origin);

  const db = env.AGENDA_DB;
  const now = Date.now();
  const attempt = await beginAttempt(db, request, now);
  if (attempt.lockedUntil) return lockedResponse(attempt.lockedUntil, now, origin);

  const person = await personForCode(db, body.code, now);
  if (!person) {
    const lockedUntil = await attemptFailed(env, db, attempt, now);
    if (lockedUntil) return lockedResponse(lockedUntil, now, origin);
    return reply({ error: BAD_CODE }, 401, origin);
  }
  await attemptSucceeded(db, attempt);

  // Two people with one password would make logging in ambiguous.
  const taken = await personForPassphrase(env, db, passphrase);
  if (taken && taken !== person) return reply({ error: "Kies een ander wachtwoord." }, 400, origin);

  const { hash, salt, iterations } = await hashPassword(passphrase);
  const result = await db
    .prepare(
      `UPDATE agenda_credentials SET hash = ?, salt = ?, iterations = ?, setup_code_hash = NULL, setup_expires = NULL, updated_at = ?
       WHERE person = ? AND setup_code_hash = ?`
    )
    .bind(hash, salt, iterations, new Date(now).toISOString(), person, await codeHash(body.code))
    .run();
  // Someone used the same code a moment earlier.
  if (!result.meta || result.meta.changes === 0) return reply({ error: BAD_CODE }, 401, origin);
  return sessionReply(env, person, now, origin);
}

// -------------------------------------------------------------
// Admin (scripts/agenda-admin.mjs)
// -------------------------------------------------------------

async function isAdmin(request, env) {
  const key = env.AGENDA_ADMIN_KEY;
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") || "");
  if (typeof key !== "string" || key.length < MIN_ADMIN_KEY_LENGTH || !match) return false;
  return secretsMatch(match[1], key);
}

async function adminStatus(env, origin) {
  const creds = await loadCredentials(env.AGENDA_DB);
  const now = Date.now();
  const people = PEOPLE.map((p) => {
    const cred = creds[p.id];
    const fixed = Boolean(fixedPassphrase(env, p.id));
    const password = cred ? (cred.hash ? "eigen" : "geen") : fixed ? "vast" : "geen";
    const codeOpen = Boolean(cred?.setup_code_hash && cred.setup_expires > now);
    return { person: p.id, name: displayName(env, p.id), password, codeExpiresAt: codeOpen ? cred.setup_expires : null };
  });
  return reply({ people }, 200, origin);
}

// "Forgot password" and first-time setup: wipes the person's password (which
// also ends their sessions) and returns a new one-time code. Only the code's
// hash is stored; the code itself is shown once, to the caller.
async function adminReset(request, env, origin) {
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  if (!PERSON_IDS.includes(body.person)) return reply({ error: `Kies een van: ${PERSON_IDS.join(", ")}` }, 400, origin);

  const code = newSetupCode();
  const now = Date.now();
  const expiresAt = now + SETUP_CODE_TTL_MS;
  await env.AGENDA_DB.prepare(
    `INSERT INTO agenda_credentials (person, hash, salt, iterations, setup_code_hash, setup_expires, updated_at)
     VALUES (?1, NULL, NULL, NULL, ?2, ?3, ?4)
     ON CONFLICT(person) DO UPDATE SET hash = NULL, salt = NULL, iterations = NULL,
       setup_code_hash = excluded.setup_code_hash, setup_expires = excluded.setup_expires, updated_at = excluded.updated_at`
  )
    .bind(body.person, await codeHash(code), expiresAt, new Date(now).toISOString())
    .run();
  return reply({ person: body.person, name: displayName(env, body.person), code, expiresAt }, 200, origin);
}

async function handleAdmin(request, env, origin, path) {
  if (typeof env.AGENDA_ADMIN_KEY !== "string" || env.AGENDA_ADMIN_KEY.length < MIN_ADMIN_KEY_LENGTH) {
    console.error("Agenda admin rejected: AGENDA_ADMIN_KEY is not configured");
    return reply({ error: "Service unavailable" }, 503, origin);
  }
  if (await isRateLimited(request, env)) return reply({ error: "Too many requests" }, 429, origin);
  if (!(await isAdmin(request, env))) return reply({ error: "Unauthorized" }, 401, origin);
  if (path === "/agenda/admin/status") {
    return request.method === "GET" ? adminStatus(env, origin) : methodNotAllowed(origin, "GET");
  }
  if (path === "/agenda/admin/reset") {
    return request.method === "POST" ? adminReset(request, env, origin) : methodNotAllowed(origin, "POST");
  }
  return reply({ error: "Not found" }, 404, origin);
}

// -------------------------------------------------------------
// Validation
// -------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(value) {
  const m = typeof value === "string" ? DATE_RE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// Strips control characters (keeps newlines in notes) and trims.
function cleanText(value, max, { multiline = false } = {}) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const stripped = multiline ? value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "") : value.replace(/[\u0000-\u001F\u007F]/g, "");
  const text = stripped.trim();
  return text.length > max ? null : text;
}

export function validateEvent(input) {
  const kind = input.kind === undefined ? "afspraak" : input.kind;
  if (!KINDS.includes(kind)) return { error: "Onbekend soort item." };
  const special = kind === "bijzonder";
  const period = kind === "periode";

  const reason = cleanText(input.reason, MAX_REASON);
  if (reason === null) return { error: "Reden is te lang (max. 40 tekens)." };
  if (kind === "onbeschikbaar" && !reason) return { error: "Geef een reden, bijvoorbeeld school." };
  if (special && !SPECIAL_TYPES.includes(reason)) return { error: "Kies wat voor dag het is." };

  const rawTitle = cleanText(input.title, MAX_TITLE);
  if (rawTitle === null) return { error: "Titel is te lang (max. 120 tekens)." };
  const title = rawTitle || (kind === "onbeschikbaar" ? reason : special ? SPECIAL_DEFAULT_TITLE[reason] ?? "" : "");
  if (!title) {
    if (special && reason === "verjaardag") return { error: "Van wie is de verjaardag?" };
    if (period) return { error: "Geef de periode een naam, bijvoorbeeld zomervakantie." };
    return { error: "Geef het een titel (max. 120 tekens)." };
  }
  const location = cleanText(input.location, MAX_LOCATION);
  if (location === null) return { error: "Plek is te lang (max. 120 tekens)." };
  const note = cleanText(input.note, MAX_NOTE, { multiline: true });
  if (note === null) return { error: "Notitie is te lang (max. 2000 tekens)." };

  if (!isValidDate(input.startDate)) return { error: "Ongeldige datum." };
  // A special day is one whole day; a period and a special day have no times.
  const rawEnd = input.endDate === undefined || input.endDate === null || input.endDate === "" ? input.startDate : input.endDate;
  const endDate = special ? input.startDate : rawEnd;
  if (!isValidDate(endDate)) return { error: "Ongeldige einddatum." };
  const span = daysBetween(input.startDate, endDate);
  if (span < 0) return { error: "Einddatum ligt voor de begindatum." };
  if (span > MAX_EVENT_DAYS) return { error: "Een item kan maximaal een jaar duren." };

  const allDay = input.allDay === true || special || period;
  let startTime = null;
  let endTime = null;
  if (!allDay) {
    if (!TIME_RE.test(input.startTime || "")) return { error: "Ongeldige begintijd." };
    startTime = input.startTime;
    if (input.endTime !== undefined && input.endTime !== null && input.endTime !== "") {
      if (!TIME_RE.test(input.endTime)) return { error: "Ongeldige eindtijd." };
      endTime = input.endTime;
      if (span === 0 && endTime < startTime) return { error: "Eindtijd ligt voor de begintijd." };
    }
  }

  if (!FOR_WHO.includes(input.forWho)) return { error: "Kies voor wie het is." };

  let repeat = "";
  if (special) {
    repeat = input.repeat === undefined ? "jaarlijks" : input.repeat;
    if (!REPEATS.includes(repeat)) return { error: "Ongeldige herhaling." };
  }

  return {
    value: {
      kind,
      reason: kind === "onbeschikbaar" || special ? reason : "",
      title,
      location,
      note,
      startDate: input.startDate,
      endDate,
      startTime,
      endTime,
      forWho: input.forWho,
      repeat,
      countYears: special && input.countYears !== false ? 1 : 0,
    },
  };
}

// -------------------------------------------------------------
// Events
// -------------------------------------------------------------

function toEvent(row, statusRows, placementRows = []) {
  const status = {};
  for (const id of PERSON_IDS) status[id] = { seenAt: null, readAt: null, response: null, respondedAt: null };
  for (const s of statusRows) {
    if (s.event_id !== row.id || !status[s.person]) continue;
    status[s.person] = { seenAt: s.seen_at, readAt: s.read_at, response: s.response, respondedAt: s.responded_at };
  }
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    allDay: row.start_time === null,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    note: row.note,
    forWho: row.for_who,
    kind: row.kind,
    reason: row.reason,
    repeat: row.repeat,
    countYears: row.count_years === 1,
    imported: row.source_uid !== null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    version: row.version,
    status,
    color: row.color,
    logoId: row.logo_id,
    logoSize: row.logo_id === null ? "" : row.logo_size,
    placements: placementRows.filter((p) => p.event_id === row.id).map(toPlacement),
  };
}

/** The given items, in the order asked; ids that do not exist are left out. */
async function loadEvents(db, ids) {
  const marks = ids.map(() => "?").join(",");
  const [eventRes, statusRes, placementRes] = await db.batch([
    db.prepare(`SELECT * FROM agenda_events WHERE id IN (${marks})`).bind(...ids),
    db.prepare(`SELECT * FROM agenda_status WHERE event_id IN (${marks})`).bind(...ids),
    db.prepare(`SELECT * FROM agenda_placements WHERE event_id IN (${marks}) ORDER BY created_at, rowid`).bind(...ids),
  ]);
  const byId = new Map(eventRes.results.map((row) => [row.id, row]));
  return ids.filter((id) => byId.has(id)).map((id) => toEvent(byId.get(id), statusRes.results, placementRes.results));
}

async function loadEvent(db, id) {
  return (await loadEvents(db, [id]))[0] ?? null;
}

// Every change bumps one counter, so phones can ask "anything new?" for the
// price of one row instead of reloading every item each minute.
function bumpRev(db) {
  return db.prepare("INSERT INTO agenda_meta (key, value) VALUES ('rev', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1");
}

async function readRev(db) {
  const row = await db.prepare("SELECT value FROM agenda_meta WHERE key = 'rev'").first();
  return row ? row.value : 0;
}

// The person who made the change agrees to it; the other has to look again.
function statusAfterChange(db, id, person, now) {
  return [
    db
      .prepare(
        `INSERT INTO agenda_status (event_id, person, seen_at, read_at, response, responded_at) VALUES (?1, ?2, ?3, ?3, 'akkoord', ?3)
         ON CONFLICT(event_id, person) DO UPDATE SET seen_at = excluded.seen_at, read_at = excluded.read_at,
           response = 'akkoord', responded_at = excluded.responded_at`
      )
      .bind(id, person, now),
    db
      .prepare(
        `INSERT INTO agenda_status (event_id, person, seen_at, read_at, response, responded_at) VALUES (?, ?, NULL, NULL, NULL, NULL)
         ON CONFLICT(event_id, person) DO UPDATE SET seen_at = NULL, read_at = NULL, response = NULL, responded_at = NULL`
      )
      .bind(id, otherPerson(person)),
  ];
}

async function listEvents(url, env, origin) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isValidDate(from) || !isValidDate(to)) return reply({ error: "Ongeldige periode." }, 400, origin);
  const span = daysBetween(from, to);
  if (span < 0 || span > MAX_RANGE_DAYS) return reply({ error: "Ongeldige periode." }, 400, origin);

  // Two index-friendly halves (by end_date, by repeat) instead of one OR that
  // would read every row ever stored.
  const db = env.AGENDA_DB;
  const inRange = "SELECT id FROM agenda_events WHERE end_date >= ?1 AND start_date <= ?2 UNION SELECT id FROM agenda_events WHERE repeat = 'jaarlijks'";
  const [eventsRes, statusRes, placementRes, revRes] = await db.batch([
    db
      .prepare(`SELECT * FROM agenda_events WHERE id IN (${inRange}) ORDER BY start_date, start_time, created_at`)
      .bind(from, to),
    db.prepare(`SELECT * FROM agenda_status WHERE event_id IN (${inRange})`).bind(from, to),
    db.prepare(`SELECT * FROM agenda_placements WHERE event_id IN (${inRange}) ORDER BY created_at, rowid`).bind(from, to),
    db.prepare("SELECT value FROM agenda_meta WHERE key = 'rev'"),
  ]);
  const events = eventsRes.results.map((row) => toEvent(row, statusRes.results, placementRes.results));
  return reply({ events, rev: revRes.results[0]?.value ?? 0 }, 200, origin);
}

async function createEvent(request, env, origin, person) {
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  const checked = validateEvent(body);
  if (checked.error) return reply({ error: checked.error }, 400, origin);
  const e = checked.value;
  // Colour and logo can be chosen right away; later they change only through /agenda/events/style.
  const styled = parseStyle(body);
  if (styled.error) return reply({ error: styled.error }, 400, origin);
  const style = styled.value;

  const db = env.AGENDA_DB;
  const logoError = await checkLogo(db, style.logoId);
  if (logoError) return reply({ error: logoError }, 400, origin);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO agenda_events (id, title, start_date, end_date, start_time, end_time, location, note, for_who,
           kind, reason, repeat, count_years, color, logo_id, logo_size, created_by, created_at, updated_by, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .bind(id, e.title, e.startDate, e.endDate, e.startTime, e.endTime, e.location, e.note, e.forWho, e.kind, e.reason, e.repeat, e.countYears, style.color, style.logoId, style.logoSize, person, now, person, now),
    ...statusAfterChange(db, id, person, now),
    bumpRev(db),
  ]);
  return reply({ event: await loadEvent(db, id) }, 201, origin);
}

async function updateEvent(request, env, origin, person, id) {
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  if (!Number.isInteger(body.version)) return reply({ error: "Versie ontbreekt." }, 400, origin);
  const checked = validateEvent(body);
  if (checked.error) return reply({ error: checked.error }, 400, origin);
  const e = checked.value;

  const db = env.AGENDA_DB;
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE agenda_events SET title = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, location = ?,
         note = ?, for_who = ?, kind = ?, reason = ?, repeat = ?, count_years = ?, updated_by = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ?`
    )
    .bind(e.title, e.startDate, e.endDate, e.startTime, e.endTime, e.location, e.note, e.forWho, e.kind, e.reason, e.repeat, e.countYears, person, now, id, body.version)
    .run();

  if (!result.meta || result.meta.changes === 0) {
    const current = await loadEvent(db, id);
    if (!current) return reply({ error: "Dit item bestaat niet meer." }, 404, origin);
    return reply({ error: "Dit item is net door iemand anders aangepast.", event: current }, 409, origin);
  }
  await db.batch([...statusAfterChange(db, id, person, now), bumpRev(db)]);
  return reply({ event: await loadEvent(db, id) }, 200, origin);
}

async function deleteEvent(env, origin, id) {
  const db = env.AGENDA_DB;
  const [result] = await db.batch([
    db.prepare("DELETE FROM agenda_events WHERE id = ?").bind(id),
    db.prepare("DELETE FROM agenda_status WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM agenda_placements WHERE event_id = ?").bind(id),
    bumpRev(db),
  ]);
  if (!result.meta || result.meta.changes === 0) return reply({ error: "Dit item bestaat niet meer." }, 404, origin);
  return reply({ success: true }, 200, origin);
}

// Imports a batch from a calendar file. Each item needs the file's UID: a new
// UID adds an item, a known one updates it only if something changed.
async function importEvents(request, env, origin, person) {
  const { body, error } = await readBody(request, MAX_IMPORT_BODY_BYTES);
  if (error) return reply({ error }, 400, origin);
  const list = Array.isArray(body.events) ? body.events : null;
  if (!list || list.length === 0 || list.length > MAX_IMPORT_EVENTS) {
    return reply({ error: `Stuur 1 tot ${MAX_IMPORT_EVENTS} items per keer.` }, 400, origin);
  }

  const items = [];
  for (const [i, input] of list.entries()) {
    if (!input || typeof input !== "object") return reply({ error: `Item ${i + 1}: ongeldige invoer.` }, 400, origin);
    const uid = typeof input.uid === "string" ? input.uid.trim() : "";
    if (!uid || uid.length > MAX_UID) return reply({ error: `Item ${i + 1}: UID ontbreekt.` }, 400, origin);
    const checked = validateEvent(input);
    if (checked.error) return reply({ error: `Item ${i + 1}: ${checked.error}` }, 400, origin);
    items.push({ ...checked.value, uid: `ics:${uid}` });
  }

  const db = env.AGENDA_DB;
  const now = new Date().toISOString();
  const fields = ["title", "start_date", "end_date", "start_time", "end_time", "location", "note", "for_who", "kind", "reason", "repeat", "count_years"];
  const changed = fields.map((f) => `agenda_events.${f} IS NOT excluded.${f}`).join(" OR ");
  const results = await db.batch(
    items.map((e) =>
      db
        .prepare(
          `INSERT INTO agenda_events (id, title, start_date, end_date, start_time, end_time, location, note, for_who,
             kind, reason, repeat, count_years, source_uid, created_by, created_at, updated_by, updated_at, version)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?15, ?16, 1)
           ON CONFLICT(source_uid) DO UPDATE SET
             ${fields.map((f) => `${f} = excluded.${f}`).join(", ")},
             updated_by = excluded.updated_by, updated_at = excluded.updated_at, version = agenda_events.version + 1
           WHERE ${changed}
           RETURNING id, version`
        )
        .bind(crypto.randomUUID(), e.title, e.startDate, e.endDate, e.startTime, e.endTime, e.location, e.note, e.forWho, e.kind, e.reason, e.repeat, e.countYears, e.uid, person, now)
    )
  );

  const touched = results.map((r) => r.results[0]).filter(Boolean);
  const added = touched.filter((r) => r.version === 1).length;
  if (touched.length) await db.batch([...touched.flatMap((r) => statusAfterChange(db, r.id, person, now)), bumpRev(db)]);
  return reply({ added, updated: touched.length - added, unchanged: items.length - touched.length }, 200, origin);
}

async function respond(request, env, origin, person, id) {
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  const response = body.response === null ? null : body.response;
  if (response !== null && !RESPONSES.includes(response)) return reply({ error: "Ongeldig antwoord." }, 400, origin);

  const db = env.AGENDA_DB;
  const now = new Date().toISOString();
  const [result] = await db.batch([
    db
      .prepare(
        `INSERT INTO agenda_status (event_id, person, seen_at, read_at, response, responded_at)
         SELECT id, ?1, ?2, ?2, ?3, ?4 FROM agenda_events WHERE id = ?5
         ON CONFLICT(event_id, person) DO UPDATE SET seen_at = COALESCE(agenda_status.seen_at, excluded.seen_at),
           read_at = COALESCE(agenda_status.read_at, excluded.read_at),
           response = excluded.response, responded_at = excluded.responded_at`
      )
      .bind(person, now, response, response === null ? null : now, id),
    bumpRev(db),
  ]);
  if (!result.meta || result.meta.changes === 0) return reply({ error: "Dit item bestaat niet meer." }, 404, origin);
  return reply({ event: await loadEvent(db, id) }, 200, origin);
}

async function markSeen(request, env, origin, person) {
  const { body, error } = await readBody(request);
  if (error) return reply({ error }, 400, origin);
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id) => typeof id === "string" && id.length <= 64))] : [];
  if (ids.length === 0 || ids.length > MAX_SEEN_IDS) return reply({ error: "Ongeldige invoer" }, 400, origin);
  const level = body.level === undefined ? "seen" : body.level;
  if (!SEEN_LEVELS.includes(level)) return reply({ error: "Ongeldige invoer" }, 400, origin);

  const db = env.AGENDA_DB;
  const now = new Date().toISOString();
  const readAt = level === "read" ? now : null;
  await db.batch([
    ...ids.map((id) =>
      db
        .prepare(
          `INSERT INTO agenda_status (event_id, person, seen_at, read_at)
           SELECT id, ?1, ?2, ?3 FROM agenda_events WHERE id = ?4
           ON CONFLICT(event_id, person) DO UPDATE SET seen_at = COALESCE(agenda_status.seen_at, excluded.seen_at),
             read_at = COALESCE(agenda_status.read_at, excluded.read_at)`
        )
        .bind(person, now, readAt, id)
    ),
    bumpRev(db),
  ]);
  return reply({ success: true, seenAt: now, readAt }, 200, origin);
}

// -------------------------------------------------------------
// Router
// -------------------------------------------------------------

const EVENT_PATH = /^\/agenda\/events\/([0-9a-f-]{36})(\/response)?$/;

function methodNotAllowed(origin, allow) {
  return reply({ error: "Method not allowed" }, 405, origin, { Allow: `${allow}, OPTIONS` });
}

// What agendaStickers.js needs from this file.
const STICKER_TOOLS = { reply, readBody, bumpRev, readRev, loadEvents, cleanText, methodNotAllowed };

/** Handles /agenda and /agenda/*. */
export async function handleAgenda(request, env, origin, url) {
  if (!isConfigured(env)) {
    console.error("Agenda rejected: AGENDA_DB or AGENDA_SESSION_KEY is not configured");
    return reply({ error: "Service unavailable" }, 503, origin);
  }
  await ensureSchema(env.AGENDA_DB);

  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/agenda/login") {
    return method === "POST" ? login(request, env, origin) : methodNotAllowed(origin, "POST");
  }
  if (path === "/agenda/setup/check") {
    return method === "POST" ? setupCheck(request, env, origin) : methodNotAllowed(origin, "POST");
  }
  if (path === "/agenda/setup") {
    return method === "POST" ? setupPassword(request, env, origin) : methodNotAllowed(origin, "POST");
  }
  if (path.startsWith("/agenda/admin/")) return handleAdmin(request, env, origin, path);

  const person = await authenticate(request, env);
  if (!person) return reply({ error: "Niet ingelogd." }, 401, origin);
  if (isKeyRateLimited(`agenda:${person}`, SESSION_RATE_LIMIT, SESSION_RATE_WINDOW_MS)) {
    return reply({ error: "Rustig aan. Probeer het zo opnieuw." }, 429, origin);
  }

  if (path === "/agenda/rev") {
    return method === "GET" ? reply({ rev: await readRev(env.AGENDA_DB) }, 200, origin) : methodNotAllowed(origin, "GET");
  }
  if (path === "/agenda/me") {
    return method === "GET" ? reply({ me: person, people: publicPeople(env) }, 200, origin) : methodNotAllowed(origin, "GET");
  }
  if (path === "/agenda/events") {
    if (method === "GET") return listEvents(url, env, origin);
    if (method === "POST") return createEvent(request, env, origin, person);
    return methodNotAllowed(origin, "GET, POST");
  }
  if (path === "/agenda/import") {
    return method === "POST" ? importEvents(request, env, origin, person) : methodNotAllowed(origin, "POST");
  }
  if (path === "/agenda/seen") {
    return method === "POST" ? markSeen(request, env, origin, person) : methodNotAllowed(origin, "POST");
  }

  if (isStickerPath(path)) return handleStickers(request, env, origin, url, person, path, STICKER_TOOLS);

  const match = EVENT_PATH.exec(path);
  if (match) {
    const [, id, isResponse] = match;
    if (isResponse) return method === "POST" ? respond(request, env, origin, person, id) : methodNotAllowed(origin, "POST");
    if (method === "PATCH") return updateEvent(request, env, origin, person, id);
    if (method === "DELETE") return deleteEvent(env, origin, id);
    return methodNotAllowed(origin, "PATCH, DELETE");
  }

  return reply({ error: "Not found" }, 404, origin);
}
