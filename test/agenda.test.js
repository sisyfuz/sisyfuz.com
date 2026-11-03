// test/agenda.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { LOGIN_GUARD, issueToken } from "../worker/src/agenda.js";
import { createFakeD1 } from "./helpers/fakeD1.js";

const BASE = "https://sisyfuz-counter.sisyfuz.workers.dev";
const ORIGIN = "https://sisyfuz.com";
const PASS_DORUS = "test-pass-dorus";
const PASS_PARTNER = "test-pass-partner";
const SESSION_KEY = "test-session-key-that-is-long-enough-1234";
const ADMIN_KEY = "test-admin-key-that-is-long-enough-123456";

let ipCounter = 0;
const uniqueIp = () => `198.51.100.${++ipCounter % 250}`;

const realNow = Date.now;
const originalConsoleError = console.error;
let db;
let clock;

// Each test starts 20 s after the previous one, so in-memory rate-limit windows
// from earlier tests have passed.
let testOffset = 0;

beforeEach(() => {
    db = createFakeD1();
    testOffset += 20_000;
    clock = realNow() + testOffset;
    Date.now = () => clock;
    console.error = () => {};
});

afterEach(() => {
    Date.now = realNow;
    console.error = originalConsoleError;
});

const env = (extra = {}) => ({
    AGENDA_DB: db,
    AGENDA_PASS_DORUS: PASS_DORUS,
    AGENDA_PASS_PARTNER: PASS_PARTNER,
    AGENDA_SESSION_KEY: SESSION_KEY,
    AGENDA_ADMIN_KEY: ADMIN_KEY,
    AGENDA_NAME_PARTNER: "Alex",
    AGENDA_FAIL_DELAY_MS: "0",
    ...extra,
});

function req(path, { method = "GET", body, token, ip = uniqueIp(), origin = ORIGIN } = {}) {
    const headers = { "CF-Connecting-IP": ip };
    if (origin) headers.Origin = origin;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return new Request(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
}

async function call(path, opts = {}, e = env()) {
    const res = await worker.fetch(req(path, opts), e);
    return { res, data: await res.json() };
}

async function login(passphrase, opts = {}) {
    return call("/agenda/login", { method: "POST", body: { passphrase }, ip: uniqueIp(), ...opts });
}

async function tokens() {
    const dorus = (await login(PASS_DORUS)).data.token;
    const partner = (await login(PASS_PARTNER)).data.token;
    return { dorus, partner };
}

const sample = (extra = {}) => ({
    title: "Etentje",
    startDate: "2026-11-07",
    allDay: false,
    startTime: "18:00",
    endTime: "21:00",
    location: "Utrecht",
    note: "Neem wijn mee",
    forWho: "samen",
    ...extra,
});

describe("Agenda: configuration", () => {
    test("fails closed when the session key or the database is missing", async () => {
        for (const missing of ["AGENDA_DB", "AGENDA_SESSION_KEY"]) {
            const { res } = await call("/agenda/login", { method: "POST", body: { passphrase: PASS_DORUS } }, env({ [missing]: undefined }));
            assert.equal(res.status, 503, missing);
        }
    });

    test("a fixed passphrase is optional: without one that person just cannot log in yet", async () => {
        const e = env({ AGENDA_PASS_PARTNER: undefined });
        assert.equal((await call("/agenda/login", { method: "POST", body: { passphrase: PASS_PARTNER }, ip: uniqueIp() }, e)).res.status, 401);
        assert.equal((await call("/agenda/login", { method: "POST", body: { passphrase: PASS_DORUS }, ip: uniqueIp() }, e)).res.status, 200);
    });

    test("fails closed when the session key is too short", async () => {
        const { res } = await call("/agenda/me", {}, env({ AGENDA_SESSION_KEY: "short" }));
        assert.equal(res.status, 503);
    });

    test("responses are never cached", async () => {
        const { res } = await call("/agenda/me");
        assert.equal(res.headers.get("Cache-Control"), "no-store");
    });

    test("CORS preflight allows the methods and Authorization header the agenda needs", async () => {
        const res = await worker.fetch(req("/agenda/events", { method: "OPTIONS" }), env());
        assert.equal(res.status, 204);
        assert.match(res.headers.get("Access-Control-Allow-Methods"), /PATCH/);
        assert.match(res.headers.get("Access-Control-Allow-Methods"), /DELETE/);
        assert.match(res.headers.get("Access-Control-Allow-Headers"), /Authorization/);
    });
});

describe("Agenda: login", () => {
    test("each passphrase logs in its own person", async () => {
        const d = await login(PASS_DORUS);
        assert.equal(d.res.status, 200);
        assert.equal(d.data.me, "dorus");
        assert.ok(d.data.token);
        assert.deepEqual(d.data.people.map((p) => p.id), ["dorus", "partner"]);
        assert.ok(!JSON.stringify(d.data.people).includes("AGENDA_PASS"), "secret names stay server-side");

        const l = await login(PASS_PARTNER);
        assert.equal(l.data.me, "partner");
    });

    test("surrounding whitespace from phone keyboards is ignored, case is not", async () => {
        assert.equal((await login(`  ${PASS_DORUS} `)).res.status, 200);
        assert.equal((await login(PASS_DORUS.toUpperCase())).res.status, 401);
    });

    test("wrong passphrase is 401 and says nothing else", async () => {
        const first = await login("nope", { ip: uniqueIp() });
        assert.equal(first.res.status, 401);
        assert.deepEqual(first.data, { error: "Verkeerd wachtwoord." }, "no attempts left, no names, no hints");
    });

    test("empty or missing passphrase is a failed attempt", async () => {
        const { res } = await call("/agenda/login", { method: "POST", body: {}, ip: uniqueIp() });
        assert.equal(res.status, 401);
    });

    test("invalid JSON is 400", async () => {
        const { res } = await call("/agenda/login", { method: "POST", body: "{nope", ip: uniqueIp() });
        assert.equal(res.status, 400);
    });

    test("requires an allowed Origin", async () => {
        const evil = await login(PASS_DORUS, { origin: "https://evil.example" });
        assert.equal(evil.res.status, 403);
        const none = await login(PASS_DORUS, { origin: null });
        assert.equal(none.res.status, 403);
    });

    test("locks an IP after too many wrong attempts, even for the right passphrase", async () => {
        const ip = uniqueIp();
        for (let i = 0; i < LOGIN_GUARD.ipMaxFailures - 1; i++) {
            assert.equal((await login("nope", { ip })).res.status, 401);
        }
        const last = await login("nope", { ip });
        assert.equal(last.res.status, 429);
        assert.ok(last.data.retryAfter > 0);
        assert.equal(last.res.headers.get("Retry-After"), String(last.data.retryAfter));

        const right = await login(PASS_DORUS, { ip });
        assert.equal(right.res.status, 429, "locked means the passphrase is not even checked");
        assert.equal(right.data.token, undefined);

        // Another IP is unaffected.
        assert.equal((await login(PASS_DORUS)).res.status, 200);
    });

    test("the lock expires, and the next lock lasts twice as long", async () => {
        const ip = uniqueIp();
        const fail = async (n) => {
            let last;
            for (let i = 0; i < n; i++) last = await login("nope", { ip });
            return last;
        };
        const first = await fail(LOGIN_GUARD.ipMaxFailures);
        assert.equal(first.res.status, 429);
        assert.equal(first.data.retryAfter, LOGIN_GUARD.ipBaseLockMs / 1000);

        clock += LOGIN_GUARD.ipBaseLockMs + 1000;
        assert.equal((await login("nope", { ip })).res.status, 401, "unlocked after the lock ran out");

        const second = await fail(LOGIN_GUARD.ipMaxFailures - 1);
        assert.equal(second.res.status, 429);
        assert.equal(second.data.retryAfter, (LOGIN_GUARD.ipBaseLockMs * 2) / 1000);
    });

    test("a correct login clears that IP's failures", async () => {
        const ip = uniqueIp();
        for (let i = 0; i < LOGIN_GUARD.ipMaxFailures - 1; i++) await login("nope", { ip });
        assert.equal((await login(PASS_PARTNER, { ip })).res.status, 200);
        for (let i = 0; i < LOGIN_GUARD.ipMaxFailures - 1; i++) {
            assert.equal((await login("nope", { ip })).res.status, 401, "the count started over");
        }
    });

    test("parallel guesses cannot get past the limit", async () => {
        const ip = uniqueIp();
        const results = await Promise.all(
            Array.from({ length: 12 }, () => worker.fetch(req("/agenda/login", { method: "POST", body: { passphrase: "nope" }, ip }), env()))
        );
        const unlocked = results.filter((r) => r.status === 401).length;
        assert.ok(unlocked <= LOGIN_GUARD.ipMaxFailures - 1, `${unlocked} guesses were checked`);
        assert.equal((await login(PASS_DORUS, { ip })).res.status, 429);
    });

    test("IPv6 clients are counted per /64", async () => {
        for (let i = 0; i < LOGIN_GUARD.ipMaxFailures; i++) {
            await login("nope", { ip: `2001:db8:1:2::${i + 1}` });
        }
        assert.equal((await login(PASS_DORUS, { ip: "2001:db8:1:2::ff" })).res.status, 429);
    });

    test("too many wrong attempts from everywhere lock all logins", async () => {
        for (let i = 0; i < LOGIN_GUARD.globalMaxFailures; i++) {
            await login("nope", { ip: `203.0.113.${i + 1}` });
        }
        const right = await login(PASS_DORUS, { ip: "203.0.113.200" });
        assert.equal(right.res.status, 429);
    });
});

describe("Agenda: sessions", () => {
    test("requests without a token are 401", async () => {
        assert.equal((await call("/agenda/me")).res.status, 401);
        assert.equal((await call("/agenda/events?from=2026-11-01&to=2026-11-30")).res.status, 401);
        assert.equal((await call("/agenda/events", { method: "POST", body: sample() })).res.status, 401);
    });

    test("a valid token says who you are", async () => {
        const { dorus } = await tokens();
        const { res, data } = await call("/agenda/me", { token: dorus });
        assert.equal(res.status, 200);
        assert.equal(data.me, "dorus");
    });

    test("tampered tokens are rejected", async () => {
        const { dorus } = await tokens();
        const parts = dorus.split(".");
        const asAlex = ["v1", "partner", ...parts.slice(2)].join(".");
        assert.equal((await call("/agenda/me", { token: asAlex })).res.status, 401);
        const longer = [...parts.slice(0, 3), String(Number(parts[3]) + 1e9), parts[4]].join(".");
        assert.equal((await call("/agenda/me", { token: longer })).res.status, 401);
        assert.equal((await call("/agenda/me", { token: "garbage" })).res.status, 401);
    });

    test("tokens expire", async () => {
        const { dorus } = await tokens();
        clock += 91 * 24 * 60 * 60 * 1000;
        assert.equal((await call("/agenda/me", { token: dorus })).res.status, 401);
    });

    test("changing a passphrase logs that person out, not the other", async () => {
        const { dorus, partner } = await tokens();
        const changed = env({ AGENDA_PASS_DORUS: "a-new-passphrase" });
        assert.equal((await call("/agenda/me", { token: dorus }, changed)).res.status, 401);
        assert.equal((await call("/agenda/me", { token: partner }, changed)).res.status, 200);
    });

    test("changing the session key logs everyone out", async () => {
        await call("/agenda/me");
        const { token } = await issueToken(env(), "partner");
        const rotated = env({ AGENDA_SESSION_KEY: "another-session-key-that-is-long-enough" });
        assert.equal((await call("/agenda/me", { token }, rotated)).res.status, 401);
    });
});

describe("Agenda: events", () => {
    test("create records who added it; the maker agrees, the other has not seen it", async () => {
        const { dorus } = await tokens();
        const { res, data } = await call("/agenda/events", { method: "POST", body: sample(), token: dorus });
        assert.equal(res.status, 201);
        const e = data.event;
        assert.equal(e.title, "Etentje");
        assert.equal(e.createdBy, "dorus");
        assert.equal(e.updatedBy, "dorus");
        assert.equal(e.endDate, "2026-11-07", "end date defaults to the start date");
        assert.equal(e.version, 1);
        assert.equal(e.status.dorus.response, "akkoord");
        assert.ok(e.status.dorus.seenAt);
        assert.deepEqual(e.status.partner, { seenAt: null, readAt: null, response: null, respondedAt: null });
    });

    test("list returns events overlapping the range, for both people", async () => {
        const { dorus, partner } = await tokens();
        await call("/agenda/events", { method: "POST", body: sample({ title: "In", startDate: "2026-11-10" }), token: dorus });
        await call("/agenda/events", {
            method: "POST",
            body: sample({ title: "Overlapt", startDate: "2026-10-30", endDate: "2026-11-02", allDay: true }),
            token: partner,
        });
        await call("/agenda/events", { method: "POST", body: sample({ title: "Buiten", startDate: "2026-12-10" }), token: dorus });

        const { res, data } = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: partner });
        assert.equal(res.status, 200);
        assert.deepEqual(data.events.map((e) => e.title), ["Overlapt", "In"]);
        assert.equal(data.events[0].allDay, true);
        assert.equal(data.events[0].startTime, null);
    });

    test("list rejects bad or huge ranges", async () => {
        const { dorus } = await tokens();
        for (const q of ["from=2026-11-01", "from=x&to=y", "from=2026-11-30&to=2026-11-01", "from=2026-01-01&to=2028-01-01"]) {
            assert.equal((await call(`/agenda/events?${q}`, { token: dorus })).res.status, 400, q);
        }
    });

    test("validation", async () => {
        const { dorus } = await tokens();
        const bad = [
            { title: "" },
            { title: "x".repeat(121) },
            { startDate: "2026-02-30" },
            { startDate: "07-11-2026" },
            { endDate: "2026-11-01" },
            { startTime: "25:00" },
            { startTime: "" },
            { endTime: "17:00" },
            { forWho: "iemand" },
            { note: "x".repeat(2001) },
            { title: 42 },
        ];
        for (const extra of bad) {
            const { res } = await call("/agenda/events", { method: "POST", body: sample(extra), token: dorus });
            assert.equal(res.status, 400, JSON.stringify(extra));
        }
        const allDay = await call("/agenda/events", { method: "POST", body: sample({ allDay: true, startTime: "nope" }), token: dorus });
        assert.equal(allDay.res.status, 201, "times are ignored for all-day items");
    });

    test("control characters are stripped, note newlines kept", async () => {
        const { dorus } = await tokens();
        const { data } = await call("/agenda/events", {
            method: "POST",
            body: sample({ title: "Eten\u0000\u0007 ", note: "regel 1\nregel 2\u0000" }),
            token: dorus,
        });
        assert.equal(data.event.title, "Eten");
        assert.equal(data.event.note, "regel 1\nregel 2");
    });

    test("oversized bodies are refused", async () => {
        const { dorus } = await tokens();
        const { res } = await call("/agenda/events", { method: "POST", body: sample({ note: "x".repeat(20000) }), token: dorus });
        assert.equal(res.status, 400);
    });

    test("the other person can mark it seen, then agree", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;

        const seen = await call("/agenda/seen", { method: "POST", body: { ids: [event.id, "not-an-id"] }, token: partner });
        assert.equal(seen.res.status, 200);
        let list = (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events;
        assert.ok(list[0].status.partner.seenAt);
        assert.equal(list[0].status.partner.response, null);

        const agreed = await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });
        assert.equal(agreed.res.status, 200);
        assert.equal(agreed.data.event.status.partner.response, "akkoord");
        assert.equal(agreed.data.event.status.partner.seenAt, list[0].status.partner.seenAt, "first seen time is kept");

        const no = await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "niet" }, token: partner });
        assert.equal(no.data.event.status.partner.response, "niet");

        const cleared = await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: null }, token: partner });
        assert.equal(cleared.data.event.status.partner.response, null);

        const invalid = await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "ja" }, token: partner });
        assert.equal(invalid.res.status, 400);
    });

    test("read is a step past seen: opened, hovered or held", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        const list = async () => (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events[0];

        await call("/agenda/seen", { method: "POST", body: { ids: [event.id] }, token: partner });
        const seen = (await list()).status.partner;
        assert.ok(seen.seenAt);
        assert.equal(seen.readAt, null, "seen is not read");

        clock += 5000;
        const read = await call("/agenda/seen", { method: "POST", body: { ids: [event.id], level: "read" }, token: partner });
        assert.equal(read.res.status, 200);
        const after = (await list()).status.partner;
        assert.ok(after.readAt);
        assert.equal(after.seenAt, seen.seenAt, "first seen time is kept");

        await call("/agenda/seen", { method: "POST", body: { ids: [event.id], level: "read" }, token: partner });
        assert.equal((await list()).status.partner.readAt, after.readAt, "first read time is kept");

        const bad = await call("/agenda/seen", { method: "POST", body: { ids: [event.id], level: "skimmed" }, token: partner });
        assert.equal(bad.res.status, 400);
    });

    test("reading without having seen it also marks it seen", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        await call("/agenda/seen", { method: "POST", body: { ids: [event.id], level: "read" }, token: partner });
        const e = (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events[0];
        assert.ok(e.status.partner.seenAt);
        assert.ok(e.status.partner.readAt);
    });

    test("the maker has read their own item; a change resets the other's read", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        assert.ok(event.status.dorus.readAt);
        await call("/agenda/seen", { method: "POST", body: { ids: [event.id], level: "read" }, token: partner });
        const edited = await call(`/agenda/events/${event.id}`, { method: "PATCH", body: sample({ title: "Nieuw", version: 1 }), token: dorus });
        assert.equal(edited.data.event.status.partner.readAt, null);
        assert.equal(edited.data.event.status.partner.seenAt, null);
    });

    test("responding without having seen it also marks it seen", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        const { data } = await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });
        assert.ok(data.event.status.partner.seenAt);
        assert.ok(data.event.status.partner.readAt, "answering means you read it");
    });

    test("either person can edit; a change resets the other's seen and agreement", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });

        const edited = await call(`/agenda/events/${event.id}`, {
            method: "PATCH",
            body: sample({ startTime: "19:00", version: 1 }),
            token: partner,
        });
        assert.equal(edited.res.status, 200);
        const e = edited.data.event;
        assert.equal(e.startTime, "19:00");
        assert.equal(e.createdBy, "dorus");
        assert.equal(e.updatedBy, "partner");
        assert.equal(e.version, 2);
        assert.equal(e.status.partner.response, "akkoord");
        assert.deepEqual(e.status.dorus, { seenAt: null, readAt: null, response: null, respondedAt: null });
    });

    test("editing a stale version is a 409 with the current item", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        await call(`/agenda/events/${event.id}`, { method: "PATCH", body: sample({ title: "A", version: 1 }), token: partner });
        const stale = await call(`/agenda/events/${event.id}`, { method: "PATCH", body: sample({ title: "B", version: 1 }), token: dorus });
        assert.equal(stale.res.status, 409);
        assert.equal(stale.data.event.title, "A");
        const missingVersion = await call(`/agenda/events/${event.id}`, { method: "PATCH", body: sample(), token: dorus });
        assert.equal(missingVersion.res.status, 400);
    });

    test("either person can delete", async () => {
        const { dorus, partner } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        const del = await call(`/agenda/events/${event.id}`, { method: "DELETE", token: partner });
        assert.equal(del.res.status, 200);
        assert.equal((await call(`/agenda/events/${event.id}`, { method: "DELETE", token: partner })).res.status, 404);
        const list = (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events;
        assert.equal(list.length, 0);
        assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM agenda_status").get().n, 0);
    });

    test("unknown items are 404", async () => {
        const { dorus } = await tokens();
        const id = "00000000-0000-4000-8000-000000000000";
        assert.equal((await call(`/agenda/events/${id}`, { method: "PATCH", body: sample({ version: 1 }), token: dorus })).res.status, 404);
        assert.equal((await call(`/agenda/events/${id}/response`, { method: "POST", body: { response: "akkoord" }, token: dorus })).res.status, 404);
    });

    test("wrong methods and paths", async () => {
        const { dorus } = await tokens();
        assert.equal((await call("/agenda/login", { method: "GET" })).res.status, 405);
        assert.equal((await call("/agenda/me", { method: "POST", body: {}, token: dorus })).res.status, 405);
        assert.equal((await call("/agenda/nope", { token: dorus })).res.status, 404);
    });
});

describe("Agenda: onbeschikbaar", () => {
    const busy = (extra = {}) => sample({ kind: "onbeschikbaar", reason: "school", title: "", forWho: "dorus", startTime: "13:30", endTime: "18:10", ...extra });

    test("a busy item needs a reason; the reason becomes the title when there is none", async () => {
        const { dorus } = await tokens();
        const ok = await call("/agenda/events", { method: "POST", body: busy(), token: dorus });
        assert.equal(ok.res.status, 201);
        assert.equal(ok.data.event.kind, "onbeschikbaar");
        assert.equal(ok.data.event.reason, "school");
        assert.equal(ok.data.event.title, "school");
        assert.equal(ok.data.event.imported, false);

        const noReason = await call("/agenda/events", { method: "POST", body: busy({ reason: "" }), token: dorus });
        assert.equal(noReason.res.status, 400);
        const longReason = await call("/agenda/events", { method: "POST", body: busy({ reason: "x".repeat(41) }), token: dorus });
        assert.equal(longReason.res.status, 400);
        const badKind = await call("/agenda/events", { method: "POST", body: busy({ kind: "vakantie" }), token: dorus });
        assert.equal(badKind.res.status, 400);
    });

    test("appointments default to kind afspraak and drop any reason", async () => {
        const { dorus } = await tokens();
        const { data } = await call("/agenda/events", { method: "POST", body: sample({ reason: "school" }), token: dorus });
        assert.equal(data.event.kind, "afspraak");
        assert.equal(data.event.reason, "");
    });

    test("an item can be switched between kinds", async () => {
        const { dorus } = await tokens();
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        const { data } = await call(`/agenda/events/${event.id}`, { method: "PATCH", body: busy({ title: "Les", version: 1 }), token: dorus });
        assert.equal(data.event.kind, "onbeschikbaar");
        assert.equal(data.event.title, "Les");
    });
});

describe("Agenda: import", () => {
    const lesson = (uid, extra = {}) => ({
        uid,
        kind: "onbeschikbaar",
        reason: "school",
        title: "Wiskunde",
        startDate: "2026-11-04",
        allDay: false,
        startTime: "13:30",
        endTime: "14:20",
        forWho: "dorus",
        ...extra,
    });
    const list = async (token) => (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token })).data.events;

    test("adds new items, then updates only what changed", async () => {
        const { dorus, partner } = await tokens();
        const first = await call("/agenda/import", { method: "POST", body: { events: [lesson("a"), lesson("b", { startTime: "14:20", endTime: "15:10" })] }, token: dorus });
        assert.equal(first.res.status, 200);
        assert.deepEqual(first.data, { added: 2, updated: 0, unchanged: 0 });

        let events = await list(partner);
        assert.equal(events.length, 2);
        assert.ok(events.every((e) => e.imported && e.createdBy === "dorus" && e.kind === "onbeschikbaar"));

        const again = await call("/agenda/import", {
            method: "POST",
            body: { events: [lesson("a"), lesson("b", { startTime: "14:30", endTime: "15:10" }), lesson("c", { startDate: "2026-11-05" })] },
            token: dorus,
        });
        assert.deepEqual(again.data, { added: 1, updated: 1, unchanged: 1 });

        events = await list(dorus);
        assert.equal(events.length, 3);
        const b = events.find((e) => e.startTime === "14:30");
        assert.equal(b.version, 2);
        assert.equal(events.find((e) => e.startTime === "13:30").version, 1, "unchanged items keep their version");
    });

    test("the same UID from the other person updates the shared item", async () => {
        const { dorus, partner } = await tokens();
        await call("/agenda/import", { method: "POST", body: { events: [lesson("x")] }, token: dorus });
        const r = await call("/agenda/import", { method: "POST", body: { events: [lesson("x", { forWho: "samen" })] }, token: partner });
        assert.deepEqual(r.data, { added: 0, updated: 1, unchanged: 0 });
        const [e] = await list(dorus);
        assert.equal(e.forWho, "samen");
        assert.equal(e.updatedBy, "partner");
    });

    test("rejects bad batches without importing anything", async () => {
        const { dorus } = await tokens();
        const missingUid = await call("/agenda/import", { method: "POST", body: { events: [lesson("ok"), lesson("")] }, token: dorus });
        assert.equal(missingUid.res.status, 400);
        assert.match(missingUid.data.error, /Item 2/);
        const invalid = await call("/agenda/import", { method: "POST", body: { events: [lesson("ok", { startDate: "nope" })] }, token: dorus });
        assert.equal(invalid.res.status, 400);
        const empty = await call("/agenda/import", { method: "POST", body: { events: [] }, token: dorus });
        assert.equal(empty.res.status, 400);
        const tooMany = await call("/agenda/import", {
            method: "POST",
            body: { events: Array.from({ length: 201 }, (_, i) => lesson(`u${i}`)) },
            token: dorus,
        });
        assert.equal(tooMany.res.status, 400);
        assert.equal((await list(dorus)).length, 0);
    });

    test("allows a bigger body than single items, within limits", async () => {
        const { dorus } = await tokens();
        const events = Array.from({ length: 150 }, (_, i) => lesson(`big${i}`, { note: "x".repeat(1500) }));
        const r = await call("/agenda/import", { method: "POST", body: { events }, token: dorus });
        assert.equal(r.res.status, 200);
        assert.equal(r.data.added, 150);
    });

    test("requires a session", async () => {
        const r = await call("/agenda/import", { method: "POST", body: { events: [lesson("a")] } });
        assert.equal(r.res.status, 401);
    });
});

describe("Agenda: bijzondere dagen en periodes", () => {
    const special = (extra = {}) => ({
        kind: "bijzonder",
        reason: "verjaardag",
        title: "Alex",
        startDate: "2005-03-14",
        forWho: "partner",
        repeat: "jaarlijks",
        countYears: true,
        ...extra,
    });
    const range = async (token, from, to) => (await call(`/agenda/events?from=${from}&to=${to}`, { token })).data.events;

    test("a birthday is one whole day, repeats yearly and may lie before 2000", async () => {
        const { dorus } = await tokens();
        const r = await call("/agenda/events", {
            method: "POST",
            body: special({ startDate: "1962-07-01", endDate: "1962-07-09", allDay: false, startTime: "10:00", title: "Oma", forWho: "samen" }),
            token: dorus,
        });
        assert.equal(r.res.status, 201);
        const e = r.data.event;
        assert.deepEqual([e.kind, e.reason, e.repeat, e.countYears], ["bijzonder", "verjaardag", "jaarlijks", true]);
        assert.deepEqual([e.startDate, e.endDate, e.allDay, e.startTime], ["1962-07-01", "1962-07-01", true, null]);
    });

    test("yearly items come back for every range, one-off ones only in theirs", async () => {
        const { dorus } = await tokens();
        await call("/agenda/events", { method: "POST", body: special(), token: dorus });
        await call("/agenda/events", { method: "POST", body: special({ reason: "anders", title: "Diploma", startDate: "2027-06-30", repeat: "" }), token: dorus });
        const nov = await range(dorus, "2026-11-01", "2026-11-30");
        assert.deepEqual(nov.map((e) => e.title), ["Alex"]);
        const june = await range(dorus, "2027-06-01", "2027-06-30");
        assert.deepEqual(june.map((e) => e.title).sort(), ["Alex", "Diploma"]);
    });

    test("an anniversary gets a default title; types are checked", async () => {
        const { dorus } = await tokens();
        const a = await call("/agenda/events", { method: "POST", body: special({ reason: "jubileum", title: "", forWho: "samen" }), token: dorus });
        assert.equal(a.data.event.title, "samen");
        const noName = await call("/agenda/events", { method: "POST", body: special({ title: "" }), token: dorus });
        assert.equal(noName.res.status, 400);
        assert.match(noName.data.error, /verjaardag/);
        const badType = await call("/agenda/events", { method: "POST", body: special({ reason: "feest" }), token: dorus });
        assert.equal(badType.res.status, 400);
        const badRepeat = await call("/agenda/events", { method: "POST", body: special({ repeat: "wekelijks" }), token: dorus });
        assert.equal(badRepeat.res.status, 400);
    });

    test("repeat and year counting default on for special days and stay off for others", async () => {
        const { dorus } = await tokens();
        const s = await call("/agenda/events", { method: "POST", body: special({ repeat: undefined, countYears: undefined }), token: dorus });
        assert.deepEqual([s.data.event.repeat, s.data.event.countYears], ["jaarlijks", true]);
        const a = await call("/agenda/events", { method: "POST", body: sample({ repeat: "jaarlijks", countYears: true }), token: dorus });
        assert.deepEqual([a.data.event.repeat, a.data.event.countYears], ["", false]);
    });

    test("a period is a stretch of whole days with a name", async () => {
        const { dorus } = await tokens();
        const p = await call("/agenda/events", {
            method: "POST",
            body: sample({ kind: "periode", title: "Zomervakantie", startDate: "2027-07-17", endDate: "2027-08-29", allDay: false, startTime: "09:00" }),
            token: dorus,
        });
        assert.equal(p.res.status, 201);
        assert.deepEqual([p.data.event.kind, p.data.event.allDay, p.data.event.startTime, p.data.event.endDate], ["periode", true, null, "2027-08-29"]);
        const noName = await call("/agenda/events", { method: "POST", body: sample({ kind: "periode", title: "" }), token: dorus });
        assert.equal(noName.res.status, 400);
        assert.match(noName.data.error, /periode/);
    });

    test("special days and periods can be imported", async () => {
        const { dorus } = await tokens();
        const r = await call("/agenda/import", {
            method: "POST",
            body: {
                events: [
                    { uid: "vak", kind: "periode", title: "Voorjaarsvakantie", startDate: "2027-02-13", endDate: "2027-02-21", allDay: true, forWho: "samen" },
                    { uid: "kd", kind: "bijzonder", reason: "anders", title: "Koningsdag", startDate: "2027-04-27", allDay: true, forWho: "samen", repeat: "" },
                ],
            },
            token: dorus,
        });
        assert.deepEqual(r.data, { added: 2, updated: 0, unchanged: 0 });
        const again = await call("/agenda/import", {
            method: "POST",
            body: { events: [{ uid: "kd", kind: "bijzonder", reason: "anders", title: "Koningsdag", startDate: "2027-04-27", allDay: true, forWho: "samen", repeat: "" }] },
            token: dorus,
        });
        assert.deepEqual(again.data, { added: 0, updated: 0, unchanged: 1 });
    });
});

describe("Agenda: rate limits", () => {
    test("logged-in use from one IP is not held to the strict login limit", async () => {
        const { dorus } = await tokens();
        const ip = "192.0.2.77";
        const results = [];
        for (let i = 0; i < 30; i++) results.push((await call("/agenda/me", { token: dorus, ip })).res.status);
        assert.ok(results.every((s) => s === 200), results.join(","));
    });

    test("a person who floods the API is slowed down", async () => {
        const { partner } = await tokens();
        let limited = false;
        for (let i = 0; i < 80 && !limited; i++) limited = (await call("/agenda/me", { token: partner })).res.status === 429;
        assert.ok(limited);
        clock += 11_000;
        assert.equal((await call("/agenda/me", { token: partner })).res.status, 200, "the window passes");
    });
});

describe("Agenda: own passwords, setup codes and reset", () => {
    // Alex has no fixed passphrase here: they choose their own with a code.
    const lenv = (extra = {}) => env({ AGENDA_PASS_PARTNER: undefined, ...extra });
    const admin = (path, { method = "GET", body, key = ADMIN_KEY, e = lenv() } = {}) =>
        call(path, { method, body, origin: null, ip: uniqueIp(), token: key }, e);
    const reset = async (person = "partner", e) => (await admin("/agenda/admin/reset", { method: "POST", body: { person }, e })).data;
    const setup = (code, passphrase, e = lenv()) => call("/agenda/setup", { method: "POST", body: { code, passphrase }, ip: uniqueIp() }, e);
    const loginAs = (passphrase, e = lenv()) => call("/agenda/login", { method: "POST", body: { passphrase }, ip: uniqueIp() }, e);
    const PARTNER_OWN = "partner kiest dit zelf 42";

    test("the admin routes need the admin key and fail closed without one", async () => {
        assert.equal((await admin("/agenda/admin/status", { key: "wrong-key-that-is-long-enough-1234567890" })).res.status, 401);
        assert.equal((await admin("/agenda/admin/status", { key: null })).res.status, 401);
        assert.equal((await admin("/agenda/admin/status", { e: lenv({ AGENDA_ADMIN_KEY: undefined }) })).res.status, 503);
        assert.equal((await admin("/agenda/admin/status", { e: lenv({ AGENDA_ADMIN_KEY: "short" }) })).res.status, 503);
        assert.equal((await admin("/agenda/admin/reset", { method: "POST", body: { person: "iemand" } })).res.status, 400);
    });

    test("a code lets Alex choose a password; only a hash is stored", async () => {
        const { code, expiresAt, name } = await reset();
        assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
        assert.equal(name, "ALEX");
        assert.ok(expiresAt > clock);

        const check = await call("/agenda/setup/check", { method: "POST", body: { code: code.toLowerCase().replace(/-/g, " ") }, ip: uniqueIp() }, lenv());
        assert.equal(check.res.status, 200, "codes ignore case, spaces and dashes");
        assert.deepEqual(check.data, { person: "partner", name: "ALEX" });

        const done = await setup(code, PARTNER_OWN);
        assert.equal(done.res.status, 200);
        assert.equal(done.data.me, "partner");
        assert.equal((await call("/agenda/me", { token: done.data.token }, lenv())).data.me, "partner");

        const row = db.sqlite.prepare("SELECT * FROM agenda_credentials WHERE person = 'partner'").get();
        assert.ok(row.hash && row.salt && row.iterations >= 100000);
        assert.equal(row.setup_code_hash, null, "the code is used up");
        assert.ok(!JSON.stringify(row).includes(PARTNER_OWN), "the password itself is not stored");
        assert.ok(!JSON.stringify(row).includes(normalize(code)), "nor the code");

        assert.equal((await loginAs(PARTNER_OWN)).data.me, "partner");
        assert.equal((await loginAs(PASS_DORUS)).data.me, "dorus", "Dorus is unaffected");
    });

    test("a code works once and only for a while", async () => {
        const { code } = await reset();
        assert.equal((await setup(code, PARTNER_OWN)).res.status, 200);
        const again = await setup(code, "nog een ander wachtwoord");
        assert.equal(again.res.status, 401);
        assert.equal((await loginAs(PARTNER_OWN)).res.status, 200, "the first password still stands");

        const { code: late } = await reset();
        clock += 8 * 24 * 60 * 60 * 1000;
        assert.equal((await setup(late, PARTNER_OWN)).res.status, 401, "expired after 7 days");
    });

    test("too short passwords and someone else's password are refused, without using the code", async () => {
        const { code } = await reset();
        const short = await setup(code, "kort");
        assert.equal(short.res.status, 400);
        assert.match(short.data.error, /10 tekens/);
        const e = lenv({ AGENDA_PASS_DORUS: "dorus heeft een lang wachtwoord" });
        const clash = await setup(code, "dorus heeft een lang wachtwoord", e);
        assert.equal(clash.res.status, 400);
        assert.match(clash.data.error, /ander wachtwoord/);
        assert.equal((await setup(code, PARTNER_OWN, e)).res.status, 200, "the code still works");
    });

    test("forgot password: a reset wipes the password and ends every session at once", async () => {
        const { code } = await reset();
        const { token } = (await setup(code, PARTNER_OWN)).data;
        const { data: dorusSession } = await loginAs(PASS_DORUS);

        const { code: fresh } = await reset();
        assert.equal((await call("/agenda/me", { token }, lenv())).res.status, 401, "old session ends");
        assert.equal((await loginAs(PARTNER_OWN)).res.status, 401, "old password no longer works");
        assert.equal((await call("/agenda/me", { token: dorusSession.token }, lenv())).res.status, 200, "Dorus stays logged in");

        const done = await setup(fresh, "een gloednieuw wachtwoord");
        assert.equal(done.res.status, 200);
        assert.equal((await loginAs("een gloednieuw wachtwoord")).data.me, "partner");
    });

    test("a reset also overrides a fixed passphrase", async () => {
        const e = env();
        assert.equal((await loginAs(PASS_PARTNER, e)).res.status, 200);
        await reset("partner", e);
        assert.equal((await loginAs(PASS_PARTNER, e)).res.status, 401);
    });

    test("status shows who has a password, never the password", async () => {
        let { data } = await admin("/agenda/admin/status", { e: env() });
        assert.deepEqual(data.people.map((p) => [p.person, p.password, p.codeExpiresAt]), [
            ["dorus", "vast", null],
            ["partner", "vast", null],
        ]);
        await reset("partner", env());
        ({ data } = await admin("/agenda/admin/status", { e: env() }));
        assert.equal(data.people[1].password, "geen");
        assert.ok(data.people[1].codeExpiresAt > clock);
    });

    test("wrong codes count towards the lockout", async () => {
        const ip = uniqueIp();
        const wrong = () => call("/agenda/setup/check", { method: "POST", body: { code: "AAAA-AAAA-AAAA-AAAA-AAAA" }, ip }, lenv());
        for (let i = 0; i < LOGIN_GUARD.ipMaxFailures - 1; i++) assert.equal((await wrong()).res.status, 401);
        assert.equal((await wrong()).res.status, 429);
        const { code } = await reset();
        const blocked = await call("/agenda/setup", { method: "POST", body: { code, passphrase: PARTNER_OWN }, ip }, lenv());
        assert.equal(blocked.res.status, 429, "a locked IP cannot use a valid code either");
    });

    test("setup needs an allowed origin", async () => {
        const { code } = await reset();
        const r = await call("/agenda/setup", { method: "POST", body: { code, passphrase: PARTNER_OWN }, origin: "https://evil.example", ip: uniqueIp() }, lenv());
        assert.equal(r.res.status, 403);
    });
});

function normalize(code) {
    return code.replace(/-/g, "");
}

describe("Agenda: revision counter and request limits", () => {
    test("every change bumps the revision; reading does not", async () => {
        const { dorus, partner } = await tokens();
        const rev = async () => (await call("/agenda/rev", { token: dorus })).data.rev;
        assert.equal(await rev(), 0);
        const { event } = (await call("/agenda/events", { method: "POST", body: sample(), token: dorus })).data;
        const afterCreate = await rev();
        assert.ok(afterCreate > 0);
        await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: partner });
        assert.equal(await rev(), afterCreate, "listing is free");

        const steps = [
            () => call("/agenda/seen", { method: "POST", body: { ids: [event.id] }, token: partner }),
            () => call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner }),
            () => call(`/agenda/events/${event.id}`, { method: "PATCH", body: sample({ title: "B", version: 1 }), token: partner }),
            () => call("/agenda/import", { method: "POST", body: { events: [{ ...sample(), uid: "r1" }] }, token: dorus }),
            () => call(`/agenda/events/${event.id}`, { method: "DELETE", token: dorus }),
        ];
        let last = afterCreate;
        for (const step of steps) {
            await step();
            const now = await rev();
            assert.ok(now > last, String(step));
            last = now;
        }
        const list = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.equal(list.data.rev, last, "the list carries the revision it belongs to");
    });

    test("bodies without a Content-Length are cut off at the limit too", async () => {
        const { dorus } = await tokens();
        const big = JSON.stringify(sample({ note: "x".repeat(40_000) }));
        const stream = new ReadableStream({
            start(controller) {
                const bytes = new TextEncoder().encode(big);
                for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096));
                controller.close();
            },
        });
        const res = await worker.fetch(
            new Request(`${BASE}/agenda/events`, {
                method: "POST",
                headers: { Origin: ORIGIN, Authorization: `Bearer ${dorus}`, "CF-Connecting-IP": uniqueIp(), "Content-Type": "application/json" },
                body: stream,
                duplex: "half",
            }),
            env()
        );
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: "Te groot" });
    });
});

describe("Agenda: herhalen", () => {
    // Every Monday from 2 November 2026, 19:00-20:00.
    const weekly = (extra = {}) => sample({ title: "Zwemmen", startDate: "2026-11-02", startTime: "19:00", endTime: "20:00", rule: { freq: "week", days: [0] }, ...extra });
    const rows = (sql, ...params) => db.sqlite.prepare(sql).all(...params);
    const list = async (token, from, to) => (await call(`/agenda/events?from=${from}&to=${to}`, { token })).data.events;
    const create = async (token, body) => {
        const { res, data } = await call("/agenda/events", { method: "POST", body, token });
        assert.equal(res.status, 201, JSON.stringify(data));
        return data.event;
    };
    const patch = (token, event, body) => call(`/agenda/events/${event.id}`, { method: "PATCH", body: { ...body, version: event.version }, token });

    test("a series is stored once with its rule and its last day", async () => {
        const { dorus } = await tokens();
        const event = await create(dorus, weekly({ rule: { freq: "week", days: [2, 0], count: 3 } }));
        assert.deepEqual(event.rule, { freq: "week", interval: 1, days: [0, 2], count: 3 });
        assert.deepEqual(event.exceptions, []);
        // Mon 2, Wed 4, Mon 9 November.
        assert.equal(rows("SELECT rule_end FROM agenda_events")[0].rule_end, "2026-11-09");
        const endless = await create(dorus, weekly());
        assert.equal(rows("SELECT rule_end FROM agenda_events WHERE id = ?", endless.id)[0].rule_end, null);
    });

    test("rules are checked, and only appointments and busy blocks repeat", async () => {
        const { dorus } = await tokens();
        for (const rule of [{ freq: "uur" }, { freq: "week", days: [] }, { freq: "dag", until: "2026-10-01" }, { freq: "dag", count: 0 }, { freq: "dag", count: 2, until: "2026-12-01" }]) {
            const { res } = await call("/agenda/events", { method: "POST", body: weekly({ rule }), token: dorus });
            assert.equal(res.status, 400, JSON.stringify(rule));
        }
        const tooLong = await call("/agenda/events", { method: "POST", body: weekly({ rule: { freq: "dag" }, endDate: "2026-11-03" }), token: dorus });
        assert.equal(tooLong.res.status, 400);
        const busy = await create(dorus, weekly({ kind: "onbeschikbaar", reason: "school", forWho: "dorus", rule: { freq: "dag" } }));
        assert.deepEqual(busy.rule, { freq: "dag", interval: 1 });
        const period = await create(dorus, { kind: "periode", title: "Vakantie", startDate: "2026-11-02", endDate: "2026-11-06", forWho: "samen", rule: { freq: "jaar" } });
        assert.equal(period.rule, null);
    });

    test("a series comes back for every range until it ends", async () => {
        const { dorus } = await tokens();
        const endless = await create(dorus, weekly());
        const ended = await create(dorus, weekly({ title: "Cursus", rule: { freq: "week", days: [0], until: "2026-11-30" } }));
        const later = await create(dorus, weekly({ title: "Later", startDate: "2027-03-01" }));
        const ids = async (from, to) => (await list(dorus, from, to)).map((e) => e.id).sort();
        assert.deepEqual(await ids("2027-01-01", "2027-01-31"), [endless.id].sort());
        assert.deepEqual(await ids("2026-11-20", "2026-12-10"), [endless.id, ended.id].sort());
        assert.deepEqual(await ids("2027-03-01", "2027-03-31"), [endless.id, later.id].sort());
        assert.deepEqual(await ids("2026-10-01", "2026-10-31"), []);
    });

    test("only this one: the date becomes its own item and the series skips it", async () => {
        const { dorus, partner } = await tokens();
        const series = await create(dorus, weekly());
        await call(`/agenda/events/${series.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });
        const { res, data } = await patch(partner, series, { ...weekly({ startTime: "20:00", endTime: "21:00", startDate: "2026-11-16" }), scope: "deze", occurrenceDate: "2026-11-16" });
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.event.rule, null);
        assert.equal(data.event.startDate, "2026-11-16");
        assert.equal(data.event.startTime, "20:00");
        assert.deepEqual(data.series.exceptions, [{ date: "2026-11-16", kind: "moved", movedToId: data.event.id }]);
        // The series keeps its akkoord and version; the new item needs akkoord from the other person.
        assert.equal(data.series.version, series.version);
        assert.equal(data.series.status.partner.response, "akkoord");
        assert.equal(data.event.status.partner.response, "akkoord");
        assert.equal(data.event.status.dorus.response, null);
        // A stale version is refused.
        assert.equal((await patch(dorus, { ...series, version: 99 }, { ...weekly(), scope: "deze", occurrenceDate: "2026-11-23" })).res.status, 409);
        // The same date again is gone.
        assert.equal((await patch(dorus, series, { ...weekly(), scope: "deze", occurrenceDate: "2026-11-16" })).res.status, 409);
    });

    test("this and following: the series ends the day before and a new one starts", async () => {
        const { dorus, partner } = await tokens();
        const series = await create(dorus, weekly({ rule: { freq: "week", days: [0], count: 6 } }));
        await call(`/agenda/events/${series.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });
        const { res, data } = await patch(partner, series, {
            ...weekly({ startDate: "2026-11-16", location: "Zwembad", rule: { freq: "week", days: [0], count: 6 } }),
            scope: "volgende",
            occurrenceDate: "2026-11-16",
        });
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.deepEqual(data.series.rule, { freq: "week", interval: 1, days: [0], until: "2026-11-15" });
        assert.equal(data.series.version, series.version + 1);
        assert.equal(data.series.status.partner.response, "akkoord", "the first part keeps its akkoord");
        // 2 and 9 November happened, so 4 of the 6 are left.
        assert.equal(data.event.rule.count, 4);
        assert.equal(data.event.startDate, "2026-11-16");
        assert.equal(data.event.location, "Zwembad");
        assert.equal(data.event.status.dorus.response, null, "the new series needs akkoord");
        assert.equal(rows("SELECT rule_end FROM agenda_events WHERE id = ?", series.id)[0].rule_end, "2026-11-15");
    });

    test("this and following from the first occurrence changes the whole series", async () => {
        const { dorus } = await tokens();
        const series = await create(dorus, weekly());
        const { data } = await patch(dorus, series, { ...weekly({ title: "Baantjes" }), scope: "volgende", occurrenceDate: "2026-11-02" });
        assert.equal(data.event.id, series.id);
        assert.equal(data.event.title, "Baantjes");
        assert.equal(rows("SELECT COUNT(*) AS n FROM agenda_events")[0].n, 1);
    });

    test("scoped edits need a series and a date", async () => {
        const { dorus } = await tokens();
        const single = await create(dorus, sample());
        assert.equal((await patch(dorus, single, { ...sample(), scope: "deze", occurrenceDate: "2026-11-07" })).res.status, 400);
        const series = await create(dorus, weekly());
        assert.equal((await patch(dorus, series, { ...weekly(), scope: "deze" })).res.status, 400);
        assert.equal((await patch(dorus, series, { ...weekly(), scope: "sommige", occurrenceDate: "2026-11-09" })).res.status, 400);
    });

    test("moving the whole series takes skipped dates along", async () => {
        const { dorus } = await tokens();
        const series = await create(dorus, weekly({ rule: { freq: "dag" } }));
        for (const date of ["2026-11-03", "2026-11-04"]) await call(`/agenda/events/${series.id}?scope=deze&date=${date}`, { method: "DELETE", token: dorus });
        const { data } = await patch(dorus, series, weekly({ startDate: "2026-11-03", rule: { freq: "dag" } }));
        assert.deepEqual(data.event.exceptions.map((x) => x.date), ["2026-11-04", "2026-11-05"]);
    });

    test("deleting one, the following, or all of them", async () => {
        const { dorus } = await tokens();
        const series = await create(dorus, weekly());
        const one = await call(`/agenda/events/${series.id}?scope=deze&date=2026-11-09`, { method: "DELETE", token: dorus });
        assert.equal(one.res.status, 200);
        assert.deepEqual(one.data.event.exceptions, [{ date: "2026-11-09", kind: "skip", movedToId: null }]);

        // A moved occurrence after the cut goes with the following ones.
        const moved = (await patch(dorus, series, { ...weekly({ startDate: "2026-11-24" }), scope: "deze", occurrenceDate: "2026-11-23" })).data.event;
        const following = await call(`/agenda/events/${series.id}?scope=volgende&date=2026-11-16`, { method: "DELETE", token: dorus });
        assert.equal(following.res.status, 200);
        assert.equal(following.data.event.rule.until, "2026-11-15");
        assert.deepEqual(following.data.deleted, [moved.id]);
        assert.deepEqual(following.data.event.exceptions.map((x) => x.date), ["2026-11-09"]);

        const kept = (await patch(dorus, following.data.event, { ...weekly({ startDate: "2026-11-02" }), rule: following.data.event.rule, scope: "deze", occurrenceDate: "2026-11-02" })).data.event;
        const all = await call(`/agenda/events/${series.id}`, { method: "DELETE", token: dorus });
        assert.equal(all.res.status, 200);
        assert.deepEqual(all.data.deleted.sort(), [series.id, kept.id].sort());
        for (const table of ["agenda_events", "agenda_status", "agenda_exceptions"]) {
            assert.equal(rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n, 0, table);
        }
    });

    test("deleting the following from the first occurrence deletes the series", async () => {
        const { dorus } = await tokens();
        const series = await create(dorus, weekly());
        const { res, data } = await call(`/agenda/events/${series.id}?scope=volgende&date=2026-11-02`, { method: "DELETE", token: dorus });
        assert.equal(res.status, 200);
        assert.deepEqual(data.deleted, [series.id]);
        assert.equal(rows("SELECT COUNT(*) AS n FROM agenda_events")[0].n, 0);
    });

    test("akkoord and seen are per series", async () => {
        const { dorus, partner } = await tokens();
        const series = await create(dorus, weekly());
        await call("/agenda/seen", { method: "POST", body: { ids: [series.id] }, token: partner });
        const { data } = await call(`/agenda/events/${series.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });
        assert.equal(data.event.status.partner.response, "akkoord");
        assert.equal(rows("SELECT COUNT(*) AS n FROM agenda_status")[0].n, 2);
    });
});
