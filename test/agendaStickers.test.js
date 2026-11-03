// test/agendaStickers.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { createFakeD1 } from "./helpers/fakeD1.js";

const BASE = "https://sisyfuz-counter.sisyfuz.workers.dev";
const ORIGIN = "https://sisyfuz.com";
const PASS_DORUS = "test-pass-dorus";
const PASS_PARTNER = "test-pass-partner";
const SESSION_KEY = "test-session-key-that-is-long-enough-1234";

let ipCounter = 0;
const uniqueIp = () => `203.0.113.${++ipCounter % 250}`;

const realNow = Date.now;
const originalConsoleError = console.error;
let db;
let clock;

// Each test starts 20 s after the previous one, so in-memory rate-limit windows
// from earlier tests have passed (the clock stands still inside a test).
let testOffset = 0;

beforeEach(() => {
    db = createFakeD1();
    testOffset += 20_000;
    clock = realNow() + testOffset + 10_000_000;
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

async function tokens(e = env()) {
    const login = async (passphrase) => (await call("/agenda/login", { method: "POST", body: { passphrase } }, e)).data.token;
    return { dorus: await login(PASS_DORUS), partner: await login(PASS_PARTNER) };
}

const sampleEvent = (extra = {}) => ({
    title: "Etentje",
    startDate: "2026-11-07",
    allDay: false,
    startTime: "18:00",
    endTime: "21:00",
    location: "Utrecht",
    note: "",
    forWho: "samen",
    ...extra,
});

const birthday = (extra = {}) => ({
    title: "Sam",
    kind: "bijzonder",
    reason: "verjaardag",
    startDate: "1990-05-04",
    forWho: "samen",
    ...extra,
});

// A PNG with a real signature and IHDR, padded with an IDAT chunk to `total` bytes.
// The worker looks at the signature and the IHDR size only, so the CRCs are zero.
function pngBytes(size, total = 200) {
    const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const chunk = (type, data) => [...u32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...u32(size), ...u32(size), 8, 6, 0, 0, 0])];
    const tail = chunk("IEND", []);
    const fill = Math.max(0, total - head.length - tail.length - 12);
    return Uint8Array.from([...head, ...chunk("IDAT", new Array(fill).fill(7)), ...tail]);
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const png = (size = 64, total) => b64(pngBytes(size, total));

const picture = (extra = {}) => ({ name: "Hartje", png: png(64), pngSmall: png(16), ...extra });

async function addSticker(token, extra = {}) {
    const { res, data } = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture(extra)] }, token });
    assert.equal(res.status, 201);
    return data.stickers[0];
}

async function addEvent(token, extra = {}) {
    const { res, data } = await call("/agenda/events", { method: "POST", body: sampleEvent(extra), token });
    assert.equal(res.status, 201);
    return data.event;
}

// Like addEvent, but takes the whole body (a special day, for example).
async function addEventRaw(token, body) {
    const { res, data } = await call("/agenda/events", { method: "POST", body, token });
    assert.equal(res.status, 201, JSON.stringify(data));
    return data.event;
}

const place = (token, eventId, stickerId, extra = {}) =>
    call("/agenda/placements", { method: "POST", body: { eventId, stickerId, occurrenceDate: null, x: 0.5, y: 2, ...extra }, token });

const rev = async (token) => (await call("/agenda/rev", { token })).data.rev;
const rows = (sql, ...params) => db.sqlite.prepare(sql).all(...params);

describe("Agenda stickers: library", () => {
    test("both people share one library; stickers keep who made them", async () => {
        const { dorus, partner } = await tokens();
        const { res, data } = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture({ name: "  Hartje " }), picture({ name: "" })] }, token: dorus });
        assert.equal(res.status, 201);
        assert.equal(data.stickers.length, 2);
        const [first, second] = data.stickers;
        assert.match(first.id, /^[0-9a-f-]{36}$/);
        assert.equal(first.name, "Hartje", "names are trimmed");
        assert.equal(second.name, "", "a name may be empty");
        assert.equal(first.createdBy, "dorus");
        assert.equal(first.archived, false);
        assert.equal(first.png, picture().png);
        assert.equal(first.pngSmall, picture().pngSmall);
        assert.ok(first.createdAt && first.updatedAt);
        assert.equal(data.rev, await rev(dorus));

        const list = await call("/agenda/stickers", { token: partner });
        assert.equal(list.res.status, 200);
        assert.deepEqual(list.data.stickers.map((s) => s.id), [first.id, second.id]);
        assert.equal(list.data.rev, data.rev);
    });

    test("only real 64x64 and 16x16 PNGs within the byte limits are accepted", async () => {
        const { dorus } = await tokens();
        const good = picture();
        const bad = [
            { png: "" },
            { png: undefined },
            { png: 42 },
            { png: "geen base64!" },
            { png: `data:image/png;base64,${good.png}` },
            { png: b64(new TextEncoder().encode("x".repeat(100))) },
            { png: png(32), name: "te klein" },
            { png: png(128) },
            { png: good.pngSmall },
            { pngSmall: good.png },
            { pngSmall: undefined },
            { pngSmall: png(8) },
            { png: png(64, 20 * 1024 + 1) },
            { pngSmall: png(16, 4 * 1024 + 1) },
            { name: "x".repeat(41) },
            { name: 7 },
        ];
        for (const extra of bad) {
            const { res } = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture(extra)] }, token: dorus });
            assert.equal(res.status, 400, JSON.stringify(extra).slice(0, 60));
        }
        assert.equal(rows("SELECT * FROM agenda_stickers").length, 0, "nothing was stored");

        // The IHDR length and type are checked as well, not just the size bytes.
        const brokenHeader = pngBytes(64);
        brokenHeader[15] = 0x58;
        const broken = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture({ png: b64(brokenHeader) })] }, token: dorus });
        assert.equal(broken.res.status, 400);

        const edge = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture({ png: png(64, 20 * 1024), pngSmall: png(16, 4 * 1024) })] }, token: dorus });
        assert.equal(edge.res.status, 201, "exactly at the limits is fine");
    });

    test("one bad image rejects the whole batch; the size of a batch is 1 to 10", async () => {
        const { dorus } = await tokens();
        const mixed = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture(), picture({ png: png(32) })] }, token: dorus });
        assert.equal(mixed.res.status, 400);
        assert.match(mixed.data.error, /^Plaatje 2:/);
        assert.equal(rows("SELECT * FROM agenda_stickers").length, 0);

        for (const stickers of [[], Array.from({ length: 11 }, picture), "nee", [null], [[]]]) {
            assert.equal((await call("/agenda/stickers", { method: "POST", body: { stickers }, token: dorus })).res.status, 400);
        }
        const ten = await call("/agenda/stickers", { method: "POST", body: { stickers: Array.from({ length: 10 }, picture) }, token: dorus });
        assert.equal(ten.res.status, 201);
        assert.equal(ten.data.stickers.length, 10);
    });

    test("sticker routes take bodies up to 400 KB, everything else stays at 16 KB", async () => {
        const { dorus } = await tokens();
        const body = { stickers: Array.from({ length: 10 }, () => picture({ png: png(64, 20 * 1024), pngSmall: png(16, 4 * 1024) })) };
        assert.ok(JSON.stringify(body).length > 250_000);
        assert.equal((await call("/agenda/stickers", { method: "POST", body, token: dorus })).res.status, 201);

        const huge = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture()], padding: "x".repeat(400 * 1024) }, token: dorus });
        assert.equal(huge.res.status, 400);
        assert.deepEqual(huge.data, { error: "Te groot" });

        const event = await addEvent(dorus);
        const small = await place(dorus, event.id, rows("SELECT id FROM agenda_stickers")[0].id, { padding: "x".repeat(20_000) });
        assert.equal(small.res.status, 400);
        assert.deepEqual(small.data, { error: "Te groot" });
        const style = await call("/agenda/events/style", { method: "POST", body: { ids: [event.id], padding: "x".repeat(20_000) }, token: dorus });
        assert.deepEqual(style.data, { error: "Te groot" });
    });

    test("the library holds at most 500 stickers; archived ones do not count", async () => {
        const { dorus } = await tokens();
        await addSticker(dorus);
        const insert = db.sqlite.prepare(
            "INSERT INTO agenda_stickers (id, name, png, png_small, created_by, created_at, updated_at) VALUES (?, '', 'x', 'y', 'dorus', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')"
        );
        for (let i = 0; i < 498; i++) insert.run(`filler-${i}`);

        const two = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture(), picture()] }, token: dorus });
        assert.equal(two.res.status, 400, "499 + 2 is over the limit");
        assert.equal(rows("SELECT * FROM agenda_stickers").length, 499, "nothing from the refused batch was stored");

        const last = await addSticker(dorus);
        assert.equal(rows("SELECT * FROM agenda_stickers WHERE archived = 0").length, 500);
        const over = await call("/agenda/stickers", { method: "POST", body: { stickers: [picture()] }, token: dorus });
        assert.equal(over.res.status, 400);
        assert.match(over.data.error, /500/);

        assert.equal((await call(`/agenda/stickers/${last.id}`, { method: "DELETE", token: dorus })).res.status, 200);
        assert.equal((await call("/agenda/stickers", { method: "POST", body: { stickers: [picture()] }, token: dorus })).res.status, 201);
    });

    test("since returns only what changed after it, archived ones included", async () => {
        const { dorus } = await tokens();
        const [a, b, c] = [await addSticker(dorus), await addSticker(dorus), await addSticker(dorus)];
        const setUpdated = db.sqlite.prepare("UPDATE agenda_stickers SET updated_at = ? WHERE id = ?");
        setUpdated.run("2026-01-01T00:00:00.000Z", a.id);
        setUpdated.run("2026-02-01T00:00:00.000Z", b.id);
        setUpdated.run("2026-03-01T00:00:00.000Z", c.id);

        const ids = async (query) => (await call(`/agenda/stickers${query}`, { token: dorus })).data.stickers.map((s) => s.id);
        assert.deepEqual(await ids(""), [a.id, b.id, c.id]);
        assert.deepEqual(await ids("?since=2026-01-01T00:00:00.000Z"), [b.id, c.id]);
        assert.deepEqual(await ids("?since=2026-02-15T00:00:00Z"), [c.id]);
        assert.deepEqual(await ids("?since=2026-03-01T00:00:00.000Z"), []);

        await call(`/agenda/stickers/${a.id}`, { method: "DELETE", token: dorus });
        assert.deepEqual(await ids("?since=2026-04-01T00:00:00.000Z"), [a.id], "archiving counts as a change");
        const archived = (await call("/agenda/stickers", { token: dorus })).data.stickers.find((s) => s.id === a.id);
        assert.equal(archived.archived, true, "archived stickers stay in the list");

        assert.equal((await call("/agenda/stickers?since=gisteren", { token: dorus })).res.status, 400);
    });

    test("patch changes the name and the images; archiving keeps the sticker", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        db.sqlite.prepare("UPDATE agenda_stickers SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(s.id);

        const other = png(64, 300);
        const { res, data } = await call(`/agenda/stickers/${s.id}`, { method: "PATCH", body: { name: " Ster ", png: other }, token: partner });
        assert.equal(res.status, 200);
        assert.equal(data.sticker.name, "Ster");
        assert.equal(data.sticker.png, other);
        assert.equal(data.sticker.pngSmall, s.pngSmall, "what was not sent stays");
        assert.equal(data.sticker.createdBy, "dorus", "whoever edits, the maker stays");
        assert.ok(data.sticker.updatedAt > "2026-01-01T00:00:00.000Z");
        assert.equal(data.rev, await rev(dorus));

        for (const body of [{}, { name: "x".repeat(41) }, { png: png(16) }, { pngSmall: png(64) }, { png: "kapot" }]) {
            assert.equal((await call(`/agenda/stickers/${s.id}`, { method: "PATCH", body, token: dorus })).res.status, 400, JSON.stringify(body).slice(0, 40));
        }
        const missing = await call("/agenda/stickers/00000000-0000-0000-0000-000000000000", { method: "PATCH", body: { name: "x" }, token: dorus });
        assert.equal(missing.res.status, 404);

        const gone = await call(`/agenda/stickers/${s.id}`, { method: "DELETE", token: partner });
        assert.equal(gone.res.status, 200);
        assert.equal(gone.data.ok, true);
        assert.equal(gone.data.rev, await rev(dorus));
        assert.equal(rows("SELECT archived FROM agenda_stickers WHERE id = ?", s.id)[0].archived, 1, "archived, not deleted");
        assert.equal((await call("/agenda/stickers/00000000-0000-0000-0000-000000000000", { method: "DELETE", token: dorus })).res.status, 404);
    });

    test("needs a session, and rejects the wrong method", async () => {
        const { dorus } = await tokens();
        for (const [path, method] of [["/agenda/stickers", "GET"], ["/agenda/stickers", "POST"], ["/agenda/placements", "POST"], ["/agenda/events/style", "POST"]]) {
            assert.equal((await call(path, { method })).res.status, 401, path);
        }
        assert.equal((await call("/agenda/stickers", { method: "PUT", token: dorus })).res.status, 405);
        assert.equal((await call("/agenda/placements", { method: "GET", token: dorus })).res.status, 405);
        assert.equal((await call("/agenda/events/style", { method: "GET", token: dorus })).res.status, 405);
        const id = "00000000-0000-0000-0000-000000000000";
        assert.equal((await call(`/agenda/stickers/${id}`, { method: "GET", token: dorus })).res.status, 405);
        assert.equal((await call(`/agenda/placements/${id}`, { method: "POST", token: dorus })).res.status, 405);
        assert.equal((await call("/agenda/stickers/nope", { method: "DELETE", token: dorus })).res.status, 404);
    });
});

describe("Agenda stickers: placements", () => {
    test("a placement shows on the item, oldest first, for both people", async () => {
        const { dorus, partner } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);

        const first = await place(dorus, event.id, s.id, { x: 0.25, y: 3 });
        assert.equal(first.res.status, 201);
        assert.deepEqual(
            { ...first.data.placement, id: undefined, createdAt: undefined },
            { id: undefined, eventId: event.id, stickerId: s.id, occurrenceDate: null, x: 0.25, y: 3, placedBy: "dorus", createdAt: undefined }
        );
        assert.match(first.data.placement.id, /^[0-9a-f-]{36}$/);
        const second = await place(partner, event.id, s.id, { x: 1, y: 20 });
        assert.equal(second.data.placement.placedBy, "partner");
        assert.equal(second.data.rev, await rev(dorus));

        const list = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: partner });
        assert.deepEqual(list.data.events[0].placements.map((p) => p.id), [first.data.placement.id, second.data.placement.id]);
        const other = await addEvent(dorus, { title: "Zonder" });
        const again = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.deepEqual(again.data.events.find((e) => e.id === other.id).placements, []);
    });

    test("every response with an item carries its placements", async () => {
        const { dorus, partner } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        const p = (await place(dorus, event.id, s.id)).data.placement;

        const answered = await call(`/agenda/events/${event.id}/response`, { method: "POST", body: { response: "akkoord" }, token: partner });
        assert.deepEqual(answered.data.event.placements.map((x) => x.id), [p.id]);
        const edited = await call(`/agenda/events/${event.id}`, { method: "PATCH", body: { ...sampleEvent({ title: "Anders" }), version: 1 }, token: partner });
        assert.deepEqual(edited.data.event.placements.map((x) => x.id), [p.id], "editing the text keeps the stickers");
    });

    test("a yearly item is stuck per year; other items always have occurrenceDate null", async () => {
        const { dorus } = await tokens();
        const yearly = await addEventRaw(dorus, birthday());
        const plain = await addEvent(dorus);
        const s = await addSticker(dorus);

        assert.equal((await place(dorus, yearly.id, s.id)).res.status, 400, "a yearly item needs the year");
        assert.equal((await place(dorus, yearly.id, s.id, { occurrenceDate: "2026-02-30" })).res.status, 400);
        assert.equal((await place(dorus, yearly.id, s.id, { occurrenceDate: "4 mei 2026" })).res.status, 400);
        const ok = await place(dorus, yearly.id, s.id, { occurrenceDate: "2026-05-04" });
        assert.equal(ok.res.status, 201);
        assert.equal(ok.data.placement.occurrenceDate, "2026-05-04");

        const ignored = await place(dorus, plain.id, s.id, { occurrenceDate: "2026-11-07" });
        assert.equal(ignored.data.placement.occurrenceDate, null);
    });

    test("at most 8 per item per person, counted per occurrence", async () => {
        const { dorus, partner } = await tokens();
        const plain = await addEvent(dorus);
        const yearly = await addEventRaw(dorus, birthday());
        const s = await addSticker(dorus);

        for (let i = 0; i < 8; i++) assert.equal((await place(dorus, plain.id, s.id, { x: i / 10 })).res.status, 201);
        const ninth = await place(dorus, plain.id, s.id);
        assert.equal(ninth.res.status, 400);
        assert.match(ninth.data.error, /8/);
        assert.equal((await place(partner, plain.id, s.id)).res.status, 201, "the other person has their own 8");

        for (let i = 0; i < 8; i++) assert.equal((await place(dorus, yearly.id, s.id, { occurrenceDate: "2026-05-04" })).res.status, 201);
        assert.equal((await place(dorus, yearly.id, s.id, { occurrenceDate: "2026-05-04" })).res.status, 400);
        assert.equal((await place(dorus, yearly.id, s.id, { occurrenceDate: "2027-05-04" })).res.status, 201, "next year starts empty");

        const count = rows("SELECT COUNT(*) AS n FROM agenda_placements WHERE event_id = ?", plain.id)[0].n;
        assert.equal(count, 9);
    });

    test("validation: position, item, and a sticker that exists and is not archived", async () => {
        const { dorus } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        for (const extra of [{ x: -0.1 }, { x: 1.1 }, { x: "0.5" }, { x: null }, { y: -1 }, { y: 21 }, { y: 1.5 }, { y: "2" }, { eventId: 5 }, { stickerId: "" }]) {
            assert.equal((await place(dorus, event.id, s.id, extra)).res.status, 400, JSON.stringify(extra));
        }
        assert.equal((await place(dorus, event.id, s.id, { x: 0, y: 0 })).res.status, 201, "the corners are fine");
        assert.equal((await place(dorus, "00000000-0000-0000-0000-000000000000", s.id)).res.status, 404);
        assert.equal((await place(dorus, event.id, "00000000-0000-0000-0000-000000000000")).res.status, 404);

        await call(`/agenda/stickers/${s.id}`, { method: "DELETE", token: dorus });
        assert.equal((await place(dorus, event.id, s.id)).res.status, 404, "archived stickers cannot be stuck any more");
        const list = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.equal(list.data.events[0].placements.length, 1, "but the ones already stuck stay");
    });

    test("either person can remove any placement", async () => {
        const { dorus, partner } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        const p = (await place(dorus, event.id, s.id)).data.placement;

        const before = await rev(dorus);
        const removed = await call(`/agenda/placements/${p.id}`, { method: "DELETE", token: partner });
        assert.equal(removed.res.status, 200);
        assert.equal(removed.data.ok, true);
        assert.ok(removed.data.rev > before);
        assert.equal((await call(`/agenda/placements/${p.id}`, { method: "DELETE", token: dorus })).res.status, 404);
        assert.deepEqual((await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events[0].placements, []);
    });

    test("deleting an item deletes its placements, not the sticker or other items' placements", async () => {
        const { dorus } = await tokens();
        const [a, b] = [await addEvent(dorus), await addEvent(dorus, { title: "Ander" })];
        const s = await addSticker(dorus);
        await place(dorus, a.id, s.id);
        await place(dorus, a.id, s.id);
        await place(dorus, b.id, s.id);

        assert.equal((await call(`/agenda/events/${a.id}`, { method: "DELETE", token: dorus })).res.status, 200);
        assert.deepEqual(rows("SELECT event_id FROM agenda_placements").map((r) => r.event_id), [b.id]);
        assert.equal(rows("SELECT * FROM agenda_stickers").length, 1);
    });

    test("an archived sticker still draws on items that use it", async () => {
        const { dorus } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        await place(dorus, event.id, s.id);
        await call("/agenda/events/style", { method: "POST", body: { ids: [event.id], logoId: s.id }, token: dorus });
        await call(`/agenda/stickers/${s.id}`, { method: "DELETE", token: dorus });

        const e = (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events[0];
        assert.equal(e.placements.length, 1);
        assert.equal(e.logoId, s.id);
        const lib = (await call("/agenda/stickers", { token: dorus })).data.stickers;
        assert.ok(lib.find((x) => x.id === s.id).png, "its pixels are still there");
    });

    test("either person can move a sticker, and only its spot changes", async () => {
        const { dorus, partner } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        const placed = (await place(dorus, event.id, s.id, { x: 0.25, y: 3 })).data.placement;

        const moved = await call(`/agenda/placements/${placed.id}`, { method: "PATCH", body: { x: 0.75, y: 0, stickerId: "x", placedBy: "partner" }, token: partner });
        assert.equal(moved.res.status, 200);
        assert.deepEqual(moved.data.placement, { ...placed, x: 0.75, y: 0 });
        const e = (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events[0];
        assert.deepEqual(e.placements, [{ ...placed, x: 0.75, y: 0 }]);
        assert.equal(e.version, 1, "moving is cosmetic");
    });

    test("moving checks the spot and the sticker", async () => {
        const { dorus } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        const placed = (await place(dorus, event.id, s.id)).data.placement;
        for (const spot of [{ x: 1.5, y: 0 }, { x: 0.5, y: 21 }, { x: 0.5, y: 1.5 }, { x: "0.5", y: 1 }, {}]) {
            const r = await call(`/agenda/placements/${placed.id}`, { method: "PATCH", body: spot, token: dorus });
            assert.equal(r.res.status, 400, JSON.stringify(spot));
        }
        await call(`/agenda/placements/${placed.id}`, { method: "DELETE", token: dorus });
        const gone = await call(`/agenda/placements/${placed.id}`, { method: "PATCH", body: { x: 0, y: 0 }, token: dorus });
        assert.equal(gone.res.status, 404);
    });
});

describe("Agenda stickers: colour and logo", () => {
    test("items have no colour and no logo until one is chosen", async () => {
        const { dorus } = await tokens();
        const e = await addEvent(dorus);
        assert.equal(e.color, "");
        assert.equal(e.logoId, null);
        assert.equal(e.logoSize, "");
        assert.deepEqual(e.placements, []);
    });

    test("create accepts colour, logo and size", async () => {
        const { dorus } = await tokens();
        const s = await addSticker(dorus);
        const full = await addEvent(dorus, { color: "#FF8800", logoId: s.id, logoSize: "groot" });
        assert.equal(full.color, "#ff8800", "colours are stored in lower case");
        assert.equal(full.logoId, s.id);
        assert.equal(full.logoSize, "groot");

        const noSize = await addEvent(dorus, { logoId: s.id });
        assert.equal(noSize.logoSize, "klein", "a logo without a size starts small");
        const noLogo = await addEvent(dorus, { logoSize: "groot", color: "" });
        assert.equal(noLogo.logoSize, "", "no logo, no size");
        const cleared = await addEvent(dorus, { logoId: null, logoSize: "klein", color: null });
        assert.equal(cleared.logoSize, "");
        assert.equal(cleared.color, "");
    });

    test("create refuses a bad colour, size, or a logo that is missing or archived", async () => {
        const { dorus } = await tokens();
        const s = await addSticker(dorus);
        const old = await addSticker(dorus);
        await call(`/agenda/stickers/${old.id}`, { method: "DELETE", token: dorus });
        const bad = [
            { color: "rood" },
            { color: "#fff" },
            { color: "#gggggg" },
            { color: "ff8800" },
            { color: 5 },
            { logoId: s.id, logoSize: "enorm" },
            { logoId: "00000000-0000-0000-0000-000000000000" },
            { logoId: old.id },
            { logoId: 7 },
            { logoId: "" },
        ];
        for (const extra of bad) {
            const { res } = await call("/agenda/events", { method: "POST", body: sampleEvent(extra), token: dorus });
            assert.equal(res.status, 400, JSON.stringify(extra));
        }
        assert.equal(rows("SELECT * FROM agenda_events").length, 0);
    });

    test("editing an item ignores colour and logo", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        const other = await addSticker(dorus);
        const e = await addEvent(dorus, { color: "#112233", logoId: s.id, logoSize: "groot" });
        const { res, data } = await call(`/agenda/events/${e.id}`, {
            method: "PATCH",
            body: { ...sampleEvent({ title: "Nieuw" }), version: 1, color: "#ffffff", logoId: other.id, logoSize: "klein", placements: [] },
            token: partner,
        });
        assert.equal(res.status, 200);
        assert.equal(data.event.title, "Nieuw");
        assert.equal(data.event.color, "#112233");
        assert.equal(data.event.logoId, s.id);
        assert.equal(data.event.logoSize, "groot");
    });

    test("style sets the colour of several items at once and leaves the logo alone", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        const a = await addEvent(dorus, { logoId: s.id, logoSize: "groot" });
        const b = await addEvent(dorus, { title: "Twee" });
        const c = await addEvent(dorus, { title: "Drie" });

        const { res, data } = await call("/agenda/events/style", { method: "POST", body: { ids: [b.id, a.id], color: "#00AAFF" }, token: partner });
        assert.equal(res.status, 200);
        assert.deepEqual(data.events.map((e) => e.id), [b.id, a.id], "in the order asked");
        assert.deepEqual(data.events.map((e) => e.color), ["#00aaff", "#00aaff"]);
        assert.equal(data.events[1].logoId, s.id);
        assert.equal(data.events[1].logoSize, "groot");
        assert.equal(data.rev, await rev(dorus));
        const untouched = (await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus })).data.events.find((e) => e.id === c.id);
        assert.equal(untouched.color, "");

        const cleared = await call("/agenda/events/style", { method: "POST", body: { ids: [a.id], color: "" }, token: dorus });
        assert.equal(cleared.data.events[0].color, "");
    });

    test("style sets, resizes and clears the logo", async () => {
        const { dorus } = await tokens();
        const s = await addSticker(dorus);
        const t = await addSticker(dorus);
        const e = await addEvent(dorus, { color: "#112233" });
        const style = async (body) => (await call("/agenda/events/style", { method: "POST", body: { ids: [e.id], ...body }, token: dorus })).data.events[0];

        let now = await style({ logoId: s.id });
        assert.deepEqual([now.logoId, now.logoSize], [s.id, "klein"], "a new logo starts small");
        now = await style({ logoSize: "groot" });
        assert.deepEqual([now.logoId, now.logoSize], [s.id, "groot"]);
        now = await style({ logoId: t.id });
        assert.deepEqual([now.logoId, now.logoSize], [t.id, "groot"], "another logo keeps the size");
        now = await style({ logoId: s.id, logoSize: "klein" });
        assert.deepEqual([now.logoId, now.logoSize], [s.id, "klein"]);
        assert.equal(now.color, "#112233", "the colour was not touched");
        now = await style({ logoId: null });
        assert.deepEqual([now.logoId, now.logoSize], [null, ""], "null clears the logo and its size");
        now = await style({ logoSize: "groot" });
        assert.deepEqual([now.logoId, now.logoSize], [null, ""], "a size without a logo means nothing");
        now = await style({ logoId: t.id, logoSize: "groot", color: "#abcdef" });
        assert.deepEqual([now.logoId, now.logoSize, now.color], [t.id, "groot", "#abcdef"]);
        now = await style({ logoId: null, logoSize: "groot" });
        assert.deepEqual([now.logoId, now.logoSize], [null, ""]);
    });

    test("style validates its input", async () => {
        const { dorus } = await tokens();
        const s = await addSticker(dorus);
        const old = await addSticker(dorus);
        await call(`/agenda/stickers/${old.id}`, { method: "DELETE", token: dorus });
        const e = await addEvent(dorus);
        const bad = [
            {},
            { ids: [] },
            { ids: "x", color: "#ffffff" },
            { ids: [7], color: "#ffffff" },
            { ids: Array.from({ length: 101 }, (_, i) => `id-${i}`), color: "#ffffff" },
            { ids: [e.id] },
            { ids: [e.id], color: "blauw" },
            { ids: [e.id], logoId: "00000000-0000-0000-0000-000000000000" },
            { ids: [e.id], logoId: old.id },
            { ids: [e.id], logoId: s.id, logoSize: "enorm" },
            { ids: [e.id], logoSize: "enorm" },
        ];
        for (const body of bad) {
            assert.equal((await call("/agenda/events/style", { method: "POST", body, token: dorus })).res.status, 400, JSON.stringify(body).slice(0, 70));
        }
        const missing = await call("/agenda/events/style", { method: "POST", body: { ids: ["00000000-0000-0000-0000-000000000000"], color: "#ffffff" }, token: dorus });
        assert.equal(missing.res.status, 404);

        const some = await call("/agenda/events/style", { method: "POST", body: { ids: [e.id, "00000000-0000-0000-0000-000000000000", e.id], color: "#ffffff" }, token: dorus });
        assert.equal(some.res.status, 200, "an item deleted in the meantime does not fail the rest");
        assert.deepEqual(some.data.events.map((x) => x.id), [e.id]);
        const hundred = await call("/agenda/events/style", { method: "POST", body: { ids: Array.from({ length: 100 }, (_, i) => `id-${i}`).concat(e.id).slice(-100), color: "#000000" }, token: dorus });
        assert.equal(hundred.res.status, 200, "100 ids are fine");
    });

    test("style never touches version, who changed it, when, or anyone's answer", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        const e = await addEvent(dorus);
        await call(`/agenda/events/${e.id}/response`, { method: "POST", body: { response: "niet" }, token: partner });
        await call(`/agenda/events/${e.id}`, { method: "PATCH", body: { ...sampleEvent({ title: "Aangepast" }), version: 1 }, token: dorus });
        await call("/agenda/seen", { method: "POST", body: { ids: [e.id], level: "read" }, token: partner });
        const before = rows("SELECT * FROM agenda_events WHERE id = ?", e.id)[0];
        const statusBefore = rows("SELECT * FROM agenda_status ORDER BY person");
        assert.equal(before.version, 2);

        await call("/agenda/events/style", { method: "POST", body: { ids: [e.id], color: "#123456", logoId: s.id, logoSize: "groot" }, token: partner });
        await place(partner, e.id, s.id);
        await place(dorus, e.id, s.id);
        await call("/agenda/events/style", { method: "POST", body: { ids: [e.id], logoId: null }, token: dorus });

        const after = rows("SELECT * FROM agenda_events WHERE id = ?", e.id)[0];
        const strip = ({ color, logo_id, logo_size, ...rest }) => rest; // eslint-disable-line no-unused-vars
        assert.deepEqual(strip(after), strip(before), "only colour and logo columns differ");
        assert.equal(after.version, 2);
        assert.equal(after.updated_by, "dorus");
        assert.deepEqual(rows("SELECT * FROM agenda_status ORDER BY person"), statusBefore, "seen, read and akkoord stay as they were");
    });

    test("an item imported from a calendar file has no style, and a re-import keeps the one it got", async () => {
        const { dorus } = await tokens();
        const body = { events: [{ ...sampleEvent(), uid: "stijl-1" }] };
        await call("/agenda/import", { method: "POST", body, token: dorus });
        const id = rows("SELECT id FROM agenda_events")[0].id;
        await call("/agenda/events/style", { method: "POST", body: { ids: [id], color: "#336699" }, token: dorus });
        body.events[0].title = "Andere titel";
        await call("/agenda/import", { method: "POST", body, token: dorus });
        const row = rows("SELECT title, color FROM agenda_events")[0];
        assert.deepEqual({ ...row }, { title: "Andere titel", color: "#336699" });
    });
});

describe("Agenda stickers: on days", () => {
    const stick = (token, stickerId, extra = {}) =>
        call("/agenda/day-stickers", { method: "POST", body: { view: "maand", day: "2026-11-12", stickerId, dx: -3, dy: -1, ...extra }, token });
    const list = (token, from = "2026-11-01", to = "2026-11-30") => call(`/agenda/day-stickers?from=${from}&to=${to}`, { token });

    test("a sticker on a day shows for both people, only in its range", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        const made = await stick(dorus, s.id);
        assert.equal(made.res.status, 201);
        assert.deepEqual(
            { ...made.data.daySticker, id: undefined, createdAt: undefined },
            { id: undefined, view: "maand", day: "2026-11-12", stickerId: s.id, dx: -3, dy: -1, placedBy: "dorus", createdAt: undefined }
        );
        await stick(partner, s.id, { view: "lijst", day: "2026-12-01", dx: 20, dy: 0 });
        const nov = await list(partner);
        assert.deepEqual(nov.data.daySticks.map((d) => d.day), ["2026-11-12"]);
        assert.equal(nov.data.rev, await rev(dorus));
        assert.equal((await list(dorus, "2026-11-01", "2026-12-31")).data.daySticks.length, 2);
    });

    test("either person can move a day sticker, also to another day or view", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        const made = (await stick(dorus, s.id)).data.daySticker;
        const moved = await call(`/agenda/day-stickers/${made.id}`, { method: "PATCH", body: { view: "lijst", day: "2026-11-13", dx: 5, dy: 2, placedBy: "partner" }, token: partner });
        assert.equal(moved.res.status, 200);
        assert.deepEqual(moved.data.daySticker, { ...made, view: "lijst", day: "2026-11-13", dx: 5, dy: 2 });
        const removed = await call(`/agenda/day-stickers/${made.id}`, { method: "DELETE", token: partner });
        assert.equal(removed.res.status, 200);
        assert.deepEqual((await list(dorus)).data.daySticks, []);
        assert.equal((await call(`/agenda/day-stickers/${made.id}`, { method: "DELETE", token: dorus })).res.status, 404);
        assert.equal((await call(`/agenda/day-stickers/${made.id}`, { method: "PATCH", body: { view: "maand", day: "2026-11-13", dx: 0, dy: 0 }, token: dorus })).res.status, 404);
    });

    test("spots, days, views and pictures are checked", async () => {
        const { dorus } = await tokens();
        const s = await addSticker(dorus);
        for (const bad of [{ view: "week" }, { day: "2026-02-30" }, { dx: 81 }, { dx: -13 }, { dy: 41 }, { dy: -9 }, { dx: 1.5 }, { dy: "1" }]) {
            assert.equal((await stick(dorus, s.id, bad)).res.status, 400, JSON.stringify(bad));
        }
        assert.equal((await stick(dorus, "00000000-0000-0000-0000-000000000000")).res.status, 404);
        await call(`/agenda/stickers/${s.id}`, { method: "DELETE", token: dorus });
        assert.equal((await stick(dorus, s.id)).res.status, 404, "archived pictures can't be stuck on");
        assert.equal((await list(dorus, "2026-11-30", "2026-11-01")).res.status, 400);
        assert.equal((await list(dorus, "2026-01-01", "2027-12-31")).res.status, 400);
    });

    test("at most 8 per day per person per view", async () => {
        const { dorus, partner } = await tokens();
        const s = await addSticker(dorus);
        for (let i = 0; i < 8; i++) assert.equal((await stick(dorus, s.id, { dx: i })).res.status, 201);
        assert.equal((await stick(dorus, s.id)).res.status, 400);
        assert.equal((await stick(partner, s.id)).res.status, 201, "the other person has their own 8");
        assert.equal((await stick(dorus, s.id, { view: "lijst" })).res.status, 201, "the list has its own 8");
    });

    test("sticking, moving and removing bump the revision", async () => {
        const { dorus } = await tokens();
        const s = await addSticker(dorus);
        let last = await rev(dorus);
        const made = await stick(dorus, s.id);
        assert.ok(made.data.rev > last);
        last = made.data.rev;
        const moved = await call(`/agenda/day-stickers/${made.data.daySticker.id}`, { method: "PATCH", body: { view: "maand", day: "2026-11-12", dx: 1, dy: 1 }, token: dorus });
        assert.ok(moved.data.rev > last);
        last = moved.data.rev;
        const removed = await call(`/agenda/day-stickers/${made.data.daySticker.id}`, { method: "DELETE", token: dorus });
        assert.ok(removed.data.rev > last);
        await list(dorus);
        assert.equal(await rev(dorus), removed.data.rev, "reading is free");
    });
});

describe("Agenda stickers: revision counter", () => {
    test("every change bumps the revision; reading does not", async () => {
        const { dorus, partner } = await tokens();
        const event = await addEvent(dorus);
        const s = await addSticker(dorus);
        let last = await rev(dorus);

        const p = await place(dorus, event.id, s.id);
        const steps = [
            ["create stickers", () => call("/agenda/stickers", { method: "POST", body: { stickers: [picture()] }, token: partner })],
            ["patch sticker", () => call(`/agenda/stickers/${s.id}`, { method: "PATCH", body: { name: "Nieuw" }, token: partner })],
            ["place", () => place(partner, event.id, s.id)],
            ["move", () => call(`/agenda/placements/${p.data.placement.id}`, { method: "PATCH", body: { x: 0.2, y: 1 }, token: partner })],
            ["unplace", () => call(`/agenda/placements/${p.data.placement.id}`, { method: "DELETE", token: partner })],
            ["style", () => call("/agenda/events/style", { method: "POST", body: { ids: [event.id], color: "#ffffff" }, token: partner })],
            ["archive", () => call(`/agenda/stickers/${s.id}`, { method: "DELETE", token: partner })],
        ];
        assert.ok(p.data.rev > last, "placing bumps");
        last = p.data.rev;
        for (const [name, step] of steps) {
            const { data } = await step();
            const now = await rev(dorus);
            assert.ok(now > last, name);
            assert.equal(data.rev, now, `${name}: the response carries the new revision`);
            last = now;
        }

        await call("/agenda/stickers", { token: dorus });
        await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.equal(await rev(dorus), last, "reading is free");

        const refused = [
            () => call("/agenda/stickers", { method: "POST", body: { stickers: [picture({ png: png(32) })] }, token: dorus }),
            () => place(dorus, event.id, s.id, { x: 9 }),
            () => call("/agenda/events/style", { method: "POST", body: { ids: [event.id], color: "rood" }, token: dorus }),
        ];
        for (const step of refused) await step();
        assert.equal(await rev(dorus), last, "refused requests change nothing");

        const before = await rev(dorus);
        await call(`/agenda/events/${event.id}`, { method: "DELETE", token: dorus });
        assert.ok((await rev(dorus)) > before, "deleting an item (and its stickers) bumps");
    });
});

describe("Agenda stickers: database migration", () => {
    // The agenda_events table as the live database has it today.
    const OLD_EVENTS = `CREATE TABLE agenda_events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
        location TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', for_who TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'afspraak',
        reason TEXT NOT NULL DEFAULT '', repeat TEXT NOT NULL DEFAULT '', count_years INTEGER NOT NULL DEFAULT 0, source_uid TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)`;

    function oldDatabase() {
        db.sqlite.exec(OLD_EVENTS);
        db.sqlite.exec("CREATE TABLE agenda_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)");
        db.sqlite.exec("INSERT INTO agenda_meta (key, value) VALUES ('rev', 41)");
        db.sqlite.exec(
            `INSERT INTO agenda_events (id, title, start_date, end_date, start_time, end_time, for_who, created_by, created_at, updated_by, updated_at, version)
             VALUES ('11111111-1111-1111-1111-111111111111', 'Oud item', '2026-11-07', '2026-11-07', '18:00', NULL, 'samen', 'dorus', '2026-01-01T00:00:00.000Z', 'dorus', '2026-01-01T00:00:00.000Z', 3)`
        );
    }
    const columns = () => rows("PRAGMA table_info(agenda_events)").map((c) => c.name);
    const schemaVersion = () => rows("SELECT value FROM agenda_meta WHERE key = 'schema'")[0]?.value;
    const LATEST = 3;

    test("a database from before stickers gets the new columns and tables, and keeps its items", async () => {
        oldDatabase();
        assert.ok(!columns().includes("color"));
        const { dorus } = await tokens();

        for (const name of ["color", "logo_id", "logo_size"]) assert.ok(columns().includes(name), name);
        assert.equal(schemaVersion(), LATEST);
        const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
        assert.ok(tables.includes("agenda_stickers") && tables.includes("agenda_placements"));
        assert.equal(rows("SELECT value FROM agenda_meta WHERE key = 'rev'")[0].value, 41, "the revision carries on");

        const { data } = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        const old = data.events[0];
        assert.equal(old.title, "Oud item");
        assert.equal(old.version, 3);
        assert.equal(old.color, "");
        assert.equal(old.logoId, null);
        assert.equal(old.logoSize, "");
        assert.deepEqual(old.placements, []);
        const s = await addSticker(dorus);
        assert.equal((await place(dorus, old.id, s.id)).res.status, 201);
    });

    test("the live database (schema 2) only gets the day sticker table", async () => {
        await tokens();
        db.sqlite.exec("DROP TABLE agenda_day_stickers");
        db.sqlite.exec("UPDATE agenda_meta SET value = 2 WHERE key = 'schema'");
        const { dorus } = await tokens(env({ AGENDA_DB: { ...db } }));
        assert.equal(schemaVersion(), LATEST);
        const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
        assert.ok(tables.includes("agenda_day_stickers"));
        const { res } = await call("/agenda/day-stickers?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.equal(res.status, 200);
    });

    test("a fresh database ends up the same way", async () => {
        await tokens();
        assert.equal(schemaVersion(), LATEST);
        assert.deepEqual(columns().slice(-3), ["color", "logo_id", "logo_size"]);
    });

    test("it runs once per database, not on every request", async () => {
        oldDatabase();
        const { dorus } = await tokens();
        const statements = [];
        const prepare = db.prepare;
        db.prepare = (sql) => {
            statements.push(sql);
            return prepare(sql);
        };
        await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.ok(!statements.some((sql) => /ALTER TABLE/.test(sql)));
        assert.ok(!statements.some((sql) => /'schema'/.test(sql)));
    });

    test("two isolates starting at once both get through (duplicate column counts as done)", async () => {
        oldDatabase();
        // Same database, separate isolates: each has its own idea of "already migrated".
        const [a, b] = [{ ...db }, { ...db }];
        const ea = env({ AGENDA_DB: a });
        const eb = env({ AGENDA_DB: b });
        const [one, two] = await Promise.all([call("/agenda/me", {}, ea), call("/agenda/me", {}, eb)]);
        assert.equal(one.res.status, 401);
        assert.equal(two.res.status, 401);
        assert.equal(columns().filter((c) => c === "color").length, 1);
        assert.equal(schemaVersion(), LATEST);

        const { dorus } = await tokens(eb);
        assert.equal((await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus }, ea)).res.status, 200);
    });

    test("columns that an interrupted run already added do not stop the next one", async () => {
        oldDatabase();
        db.sqlite.exec("ALTER TABLE agenda_events ADD COLUMN color TEXT NOT NULL DEFAULT ''");
        db.sqlite.exec("ALTER TABLE agenda_events ADD COLUMN logo_id TEXT");
        const { dorus } = await tokens();
        assert.ok(columns().includes("logo_size"));
        assert.equal(schemaVersion(), LATEST);
        const { data } = await call("/agenda/events?from=2026-11-01&to=2026-11-30", { token: dorus });
        assert.equal(data.events[0].title, "Oud item");
    });

    test("other database errors are not swallowed", async () => {
        const failing = {
            ...db,
            prepare: (sql) => {
                if (/ALTER TABLE/.test(sql)) throw new Error("D1_ERROR: database is locked");
                return db.prepare(sql);
            },
        };
        oldDatabase();
        const res = await worker.fetch(req("/agenda/me"), env({ AGENDA_DB: failing })).catch((err) => err);
        assert.ok(res instanceof Error || res.status >= 500, "the request fails instead of running on a half-migrated database");
        assert.ok(!columns().includes("color"));
    });
});
