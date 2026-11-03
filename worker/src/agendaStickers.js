/**
 * Stickers, logos and colours for the private agenda (see agenda.js).
 *
 * A library image ("plaatje") is a 64x64 PNG plus a 16x16 one, shared by both
 * people. It can be stuck on an item (a placement) or used as an item's logo.
 * Colour, logo and placements are cosmetic: they never touch an item's version,
 * updated_by, updated_at or the agree/seen steps.
 *
 * Routes (same bearer token as the rest of the agenda):
 *   GET    /agenda/stickers?since=<ISO>  -> { stickers, rev } (archived ones included)
 *   POST   /agenda/stickers              { stickers: [{ name, png, pngSmall }] } (1..10) -> { stickers, rev }
 *   PATCH  /agenda/stickers/:id          any of { name, png, pngSmall } -> { sticker, rev }
 *   DELETE /agenda/stickers/:id          archives it -> { ok, rev }
 *   POST   /agenda/placements            { eventId, stickerId, occurrenceDate, x, y } -> { placement, rev }
 *   PATCH  /agenda/placements/:id        { x, y } (moves it) -> { placement, rev }
 *   DELETE /agenda/placements/:id        -> { ok, rev }
 *   POST   /agenda/events/style          { ids, color?, logoId?, logoSize? } -> { events, rev }
 *   GET    /agenda/day-stickers?from=&to= -> { daySticks, rev } stuck on days in [from, to]
 *   POST   /agenda/day-stickers          { view, day, stickerId, dx, dy } -> { daySticker, rev }
 *   PATCH  /agenda/day-stickers/:id      { view, day, dx, dy } (moves it) -> { daySticker, rev }
 *   DELETE /agenda/day-stickers/:id      -> { ok, rev }
 *
 * The routes need a few helpers from agenda.js; they come in through `tools`
 * so the two files do not import each other.
 */

const MAX_STICKER_BODY_BYTES = 400 * 1024;
const MAX_STICKERS_PER_REQUEST = 10;
const MAX_STICKERS = 500;
const MAX_PLACEMENTS_PER_PERSON = 8;
const MAX_STYLE_IDS = 100;
const MAX_NAME = 40;
const BIG_SIZE = 64;
const SMALL_SIZE = 16;
const MAX_BIG_BYTES = 20 * 1024;
const MAX_SMALL_BYTES = 4 * 1024;
const MAX_PLACEMENT_ROW = 20;
// Day stickers sit on a day in the month grid ("maand") or the list ("lijst"),
// `dx` columns and `dy` rows from that day's top-left corner (may be negative,
// so a ring can go around the day number).
const DAY_VIEWS = ["maand", "lijst"];
const DAY_DX = [-12, 80];
const DAY_DY = [-8, 40];
const MAX_DAY_RANGE_DAYS = 400;

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOGO_SIZES = ["groot", "klein"];
const DEFAULT_LOGO_SIZE = "klein";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const STICKER_PATH = /^\/agenda\/stickers\/([0-9a-f-]{36})$/;
const PLACEMENT_PATH = /^\/agenda\/placements\/([0-9a-f-]{36})$/;
const DAY_STICKER_PATH = /^\/agenda\/day-stickers\/([0-9a-f-]{36})$/;

export const STICKER_MIGRATION = {
  version: 2,
  // SQLite has no "ADD COLUMN IF NOT EXISTS"; a duplicate column counts as done.
  alter: [
    "ALTER TABLE agenda_events ADD COLUMN color TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE agenda_events ADD COLUMN logo_id TEXT",
    "ALTER TABLE agenda_events ADD COLUMN logo_size TEXT NOT NULL DEFAULT ''",
  ],
  create: [
    `CREATE TABLE IF NOT EXISTS agenda_stickers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      png TEXT NOT NULL,
      png_small TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS agenda_stickers_updated ON agenda_stickers (updated_at)`,
    `CREATE TABLE IF NOT EXISTS agenda_placements (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      sticker_id TEXT NOT NULL,
      occurrence_date TEXT,
      x REAL NOT NULL,
      y INTEGER NOT NULL,
      placed_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS agenda_placements_event ON agenda_placements (event_id)`,
  ],
};

export const DAY_STICKER_MIGRATION = {
  version: 3,
  alter: [],
  create: [
    `CREATE TABLE IF NOT EXISTS agenda_day_stickers (
      id TEXT PRIMARY KEY,
      view TEXT NOT NULL,
      day TEXT NOT NULL,
      sticker_id TEXT NOT NULL,
      dx INTEGER NOT NULL,
      dy INTEGER NOT NULL,
      placed_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS agenda_day_stickers_day ON agenda_day_stickers (day)`,
  ],
};

// -------------------------------------------------------------
// Validation
// -------------------------------------------------------------

// Returns the decoded bytes of a base64 PNG of exactly size x size pixels, or null.
// Only the signature and the IHDR chunk are looked at; the browser draws the rest.
function decodePng(text, size, maxBytes) {
  if (typeof text !== "string" || !text || text.length % 4 !== 0 || text.length > Math.ceil(maxBytes / 3) * 4) return null;
  if (!BASE64_RE.test(text)) return null;
  let bin;
  try {
    bin = atob(text);
  } catch {
    return null;
  }
  if (bin.length > maxBytes || bin.length < 33) return null;
  const at = (i) => bin.charCodeAt(i);
  if (PNG_SIGNATURE.some((b, i) => at(i) !== b)) return null;
  const word = (i) => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  if (word(8) !== 13 || bin.slice(12, 16) !== "IHDR") return null;
  if (word(16) !== size || word(20) !== size) return null;
  return bin;
}

function checkName(value, tools) {
  const name = tools.cleanText(value, MAX_NAME);
  return name === null ? { error: "De naam is te lang (max. 40 tekens)." } : { name };
}

function checkImages(input) {
  if (!decodePng(input.png, BIG_SIZE, MAX_BIG_BYTES)) return { error: "Het plaatje moet een PNG van 64x64 zijn (max. 20 KB)." };
  if (!decodePng(input.pngSmall, SMALL_SIZE, MAX_SMALL_BYTES)) return { error: "Het kleine plaatje moet een PNG van 16x16 zijn (max. 4 KB)." };
  return {};
}

function validateStickerInput(input, tools) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Ongeldige invoer" };
  const named = checkName(input.name, tools);
  if (named.error) return named;
  const images = checkImages(input);
  if (images.error) return images;
  return { value: { name: named.name, png: input.png, pngSmall: input.pngSmall } };
}

/**
 * Colour, logo and logo size from a request body.
 * Creating fills in defaults; changing (`partial`) only returns the fields that were sent.
 */
export function parseStyle(input, { partial = false } = {}) {
  const value = {};

  if (input.color !== undefined || !partial) {
    const color = input.color === undefined || input.color === null ? "" : input.color;
    if (color !== "" && !(typeof color === "string" && COLOR_RE.test(color))) return { error: "Ongeldige kleur." };
    value.color = color.toLowerCase();
  }

  if (input.logoId !== undefined || !partial) {
    const logoId = input.logoId === undefined ? null : input.logoId;
    if (logoId !== null && (typeof logoId !== "string" || !logoId || logoId.length > 64)) return { error: "Ongeldig logo." };
    value.logoId = logoId;
  }

  if (input.logoSize !== undefined && input.logoSize !== null && input.logoSize !== "" && !LOGO_SIZES.includes(input.logoSize)) {
    return { error: "Ongeldige logogrootte." };
  }
  const size = input.logoSize || undefined;
  if (value.logoId === null) {
    // No logo, no size. A size sent without any logoId is applied only if the item has a logo.
    if (!partial || input.logoId === null) value.logoSize = "";
    else if (size) value.logoSize = size;
  } else if (value.logoId !== undefined) {
    // A new logo keeps the item's current size if it has one (decided in SQL).
    value.logoSize = partial ? size : size ?? DEFAULT_LOGO_SIZE;
  } else if (size) {
    value.logoSize = size;
  }
  return { value };
}

/** Is this a library image that can still be picked? Returns an error text or null. */
export async function checkLogo(db, logoId) {
  if (logoId === null || logoId === undefined) return null;
  const row = await db.prepare("SELECT archived FROM agenda_stickers WHERE id = ?").bind(logoId).first();
  return row && row.archived === 0 ? null : "Dit plaatje bestaat niet meer.";
}

function isValidDate(value) {
  const m = typeof value === "string" ? DATE_RE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// -------------------------------------------------------------
// JSON shapes
// -------------------------------------------------------------

function toSticker(row) {
  return {
    id: row.id,
    name: row.name,
    png: row.png,
    pngSmall: row.png_small,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
  };
}

export function toPlacement(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    stickerId: row.sticker_id,
    occurrenceDate: row.occurrence_date,
    x: row.x,
    y: row.y,
    placedBy: row.placed_by,
    createdAt: row.created_at,
  };
}

// -------------------------------------------------------------
// Stickers
// -------------------------------------------------------------

async function listStickers(url, env, origin, tools) {
  const db = env.AGENDA_DB;
  const rawSince = url.searchParams.get("since");
  let since = null;
  if (rawSince !== null) {
    const time = Date.parse(rawSince);
    if (Number.isNaN(time)) return tools.reply({ error: "Ongeldige datum." }, 400, origin);
    since = new Date(time).toISOString();
  }
  const [stickersRes, revRes] = await db.batch([
    since === null
      ? db.prepare("SELECT * FROM agenda_stickers ORDER BY rowid")
      : db.prepare("SELECT * FROM agenda_stickers WHERE updated_at > ? ORDER BY rowid").bind(since),
    db.prepare("SELECT value FROM agenda_meta WHERE key = 'rev'"),
  ]);
  return tools.reply({ stickers: stickersRes.results.map(toSticker), rev: revRes.results[0]?.value ?? 0 }, 200, origin);
}

async function createStickers(request, env, origin, person, tools) {
  const { body, error } = await tools.readBody(request, MAX_STICKER_BODY_BYTES);
  if (error) return tools.reply({ error }, 400, origin);
  const list = Array.isArray(body.stickers) ? body.stickers : null;
  if (!list || list.length === 0 || list.length > MAX_STICKERS_PER_REQUEST) {
    return tools.reply({ error: `Stuur 1 tot ${MAX_STICKERS_PER_REQUEST} plaatjes per keer.` }, 400, origin);
  }
  const items = [];
  for (const [i, input] of list.entries()) {
    const checked = validateStickerInput(input, tools);
    if (checked.error) return tools.reply({ error: `Plaatje ${i + 1}: ${checked.error}` }, 400, origin);
    items.push(checked.value);
  }

  const db = env.AGENDA_DB;
  const count = await db.prepare("SELECT COUNT(*) AS n FROM agenda_stickers WHERE archived = 0").first("n");
  const full = { error: `De bibliotheek zit vol (max. ${MAX_STICKERS} plaatjes).` };
  if (count + items.length > MAX_STICKERS) return tools.reply(full, 400, origin);

  const now = new Date().toISOString();
  const ids = items.map(() => crypto.randomUUID());
  // The count is checked again inside the statement, so two phones adding at once cannot go over.
  const results = await db.batch([
    ...items.map((s, i) =>
      db
        .prepare(
          `INSERT INTO agenda_stickers (id, name, png, png_small, created_by, created_at, updated_at, archived)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6, 0 WHERE (SELECT COUNT(*) FROM agenda_stickers WHERE archived = 0) < ?7`
        )
        .bind(ids[i], s.name, s.png, s.pngSmall, person, now, MAX_STICKERS)
    ),
    tools.bumpRev(db),
  ]);
  if (results.slice(0, items.length).some((r) => !r.meta || r.meta.changes === 0)) return tools.reply(full, 400, origin);

  const { results: rows } = await db.prepare(`SELECT * FROM agenda_stickers WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY rowid`).bind(...ids).all();
  return tools.reply({ stickers: rows.map(toSticker), rev: await tools.readRev(db) }, 201, origin);
}

async function updateSticker(request, env, origin, id, tools) {
  const { body, error } = await tools.readBody(request, MAX_STICKER_BODY_BYTES);
  if (error) return tools.reply({ error }, 400, origin);

  const sets = [];
  const params = [];
  if (body.name !== undefined) {
    const named = checkName(body.name, tools);
    if (named.error) return tools.reply({ error: named.error }, 400, origin);
    sets.push("name = ?");
    params.push(named.name);
  }
  if (body.png !== undefined) {
    if (!decodePng(body.png, BIG_SIZE, MAX_BIG_BYTES)) return tools.reply({ error: "Het plaatje moet een PNG van 64x64 zijn (max. 20 KB)." }, 400, origin);
    sets.push("png = ?");
    params.push(body.png);
  }
  if (body.pngSmall !== undefined) {
    if (!decodePng(body.pngSmall, SMALL_SIZE, MAX_SMALL_BYTES)) return tools.reply({ error: "Het kleine plaatje moet een PNG van 16x16 zijn (max. 4 KB)." }, 400, origin);
    sets.push("png_small = ?");
    params.push(body.pngSmall);
  }
  if (sets.length === 0) return tools.reply({ error: "Niets om aan te passen." }, 400, origin);

  const db = env.AGENDA_DB;
  const now = new Date().toISOString();
  const [result] = await db.batch([
    db.prepare(`UPDATE agenda_stickers SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...params, now, id),
    tools.bumpRev(db),
  ]);
  if (!result.meta || result.meta.changes === 0) return tools.reply({ error: "Dit plaatje bestaat niet meer." }, 404, origin);
  const row = await db.prepare("SELECT * FROM agenda_stickers WHERE id = ?").bind(id).first();
  return tools.reply({ sticker: toSticker(row), rev: await tools.readRev(db) }, 200, origin);
}

// Archived images stay in the library, so placements and logos that use them still draw.
async function archiveSticker(env, origin, id, tools) {
  const db = env.AGENDA_DB;
  const [result] = await db.batch([
    db.prepare("UPDATE agenda_stickers SET archived = 1, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id),
    tools.bumpRev(db),
  ]);
  if (!result.meta || result.meta.changes === 0) return tools.reply({ error: "Dit plaatje bestaat niet meer." }, 404, origin);
  return tools.reply({ ok: true, rev: await tools.readRev(db) }, 200, origin);
}

// -------------------------------------------------------------
// Placements
// -------------------------------------------------------------

// x is a fraction of the card's width, y a whole row from its top.
function isValidSpot(body) {
  return (
    typeof body.x === "number" && Number.isFinite(body.x) && body.x >= 0 && body.x <= 1 &&
    Number.isInteger(body.y) && body.y >= 0 && body.y <= MAX_PLACEMENT_ROW
  );
}

async function createPlacement(request, env, origin, person, tools) {
  const { body, error } = await tools.readBody(request);
  if (error) return tools.reply({ error }, 400, origin);
  const { eventId, stickerId } = body;
  if (typeof eventId !== "string" || !eventId || eventId.length > 64) return tools.reply({ error: "Ongeldig item." }, 400, origin);
  if (typeof stickerId !== "string" || !stickerId || stickerId.length > 64) return tools.reply({ error: "Ongeldig plaatje." }, 400, origin);
  if (!isValidSpot(body)) return tools.reply({ error: "Ongeldige plek." }, 400, origin);

  const db = env.AGENDA_DB;
  const [eventRes, stickerRes] = await db.batch([
    db.prepare("SELECT repeat FROM agenda_events WHERE id = ?").bind(eventId),
    db.prepare("SELECT archived FROM agenda_stickers WHERE id = ?").bind(stickerId),
  ]);
  const event = eventRes.results[0];
  if (!event) return tools.reply({ error: "Dit item bestaat niet meer." }, 404, origin);
  const sticker = stickerRes.results[0];
  if (!sticker || sticker.archived === 1) return tools.reply({ error: "Dit plaatje bestaat niet meer." }, 404, origin);

  // Yearly items are stuck per year; any other item has just one set of stickers.
  let occurrenceDate = null;
  if (event.repeat === "jaarlijks") {
    if (!isValidDate(body.occurrenceDate)) return tools.reply({ error: "Ongeldige datum." }, 400, origin);
    occurrenceDate = body.occurrenceDate;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const limit = { error: `Je kunt maximaal ${MAX_PLACEMENTS_PER_PERSON} plaatjes per item plakken.` };
  const [result] = await db.batch([
    db
      .prepare(
        `INSERT INTO agenda_placements (id, event_id, sticker_id, occurrence_date, x, y, placed_by, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE (SELECT COUNT(*) FROM agenda_placements WHERE event_id = ?2 AND occurrence_date IS ?4 AND placed_by = ?7) < ?9`
      )
      .bind(id, eventId, stickerId, occurrenceDate, body.x, body.y, person, now, MAX_PLACEMENTS_PER_PERSON),
    tools.bumpRev(db),
  ]);
  if (!result.meta || result.meta.changes === 0) return tools.reply(limit, 400, origin);
  const row = await db.prepare("SELECT * FROM agenda_placements WHERE id = ?").bind(id).first();
  return tools.reply({ placement: toPlacement(row), rev: await tools.readRev(db) }, 201, origin);
}

// Either person can move any sticker, like removing one.
async function movePlacement(request, env, origin, id, tools) {
  const { body, error } = await tools.readBody(request);
  if (error) return tools.reply({ error }, 400, origin);
  if (!isValidSpot(body)) return tools.reply({ error: "Ongeldige plek." }, 400, origin);
  const db = env.AGENDA_DB;
  const result = await db.prepare("UPDATE agenda_placements SET x = ?, y = ? WHERE id = ?").bind(body.x, body.y, id).run();
  if (!result.meta || result.meta.changes === 0) return tools.reply({ error: "Dit plaatje zit er niet meer op." }, 404, origin);
  const [, rowRes] = await db.batch([tools.bumpRev(db), db.prepare("SELECT * FROM agenda_placements WHERE id = ?").bind(id)]);
  return tools.reply({ placement: toPlacement(rowRes.results[0]), rev: await tools.readRev(db) }, 200, origin);
}

async function deletePlacement(env, origin, id, tools) {
  const db = env.AGENDA_DB;
  const [result] = await db.batch([db.prepare("DELETE FROM agenda_placements WHERE id = ?").bind(id), tools.bumpRev(db)]);
  if (!result.meta || result.meta.changes === 0) return tools.reply({ error: "Dit plaatje zit er niet meer op." }, 404, origin);
  return tools.reply({ ok: true, rev: await tools.readRev(db) }, 200, origin);
}

// -------------------------------------------------------------
// Item style
// -------------------------------------------------------------

// Colour and logo for several items at once. Cosmetic: version, updated_by,
// updated_at and the agree/seen steps stay as they are.
async function styleEvents(request, env, origin, tools) {
  const { body, error } = await tools.readBody(request);
  if (error) return tools.reply({ error }, 400, origin);
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id) => typeof id === "string" && id.length <= 64))] : [];
  if (ids.length === 0 || ids.length > MAX_STYLE_IDS) return tools.reply({ error: "Ongeldige invoer" }, 400, origin);
  const parsed = parseStyle(body, { partial: true });
  if (parsed.error) return tools.reply({ error: parsed.error }, 400, origin);
  const style = parsed.value;
  if (Object.keys(style).length === 0) return tools.reply({ error: "Niets om aan te passen." }, 400, origin);

  const db = env.AGENDA_DB;
  const logoError = await checkLogo(db, style.logoId);
  if (logoError) return tools.reply({ error: logoError }, 400, origin);

  const sets = [];
  const params = [];
  if (style.color !== undefined) {
    sets.push("color = ?");
    params.push(style.color);
  }
  if (style.logoId === null) {
    sets.push("logo_id = NULL", "logo_size = ''");
  } else if (style.logoId !== undefined) {
    // Without an explicit size, a new logo keeps the item's size, or starts small.
    sets.push("logo_id = ?", "logo_size = COALESCE(?, NULLIF(logo_size, ''), ?)");
    params.push(style.logoId, style.logoSize ?? null, DEFAULT_LOGO_SIZE);
  } else if (style.logoSize !== undefined) {
    sets.push("logo_size = CASE WHEN logo_id IS NULL THEN '' ELSE ? END");
    params.push(style.logoSize);
  }

  const results = await db.batch([
    ...ids.map((id) => db.prepare(`UPDATE agenda_events SET ${sets.join(", ")} WHERE id = ?`).bind(...params, id)),
    tools.bumpRev(db),
  ]);
  if (results.slice(0, ids.length).every((r) => !r.meta || r.meta.changes === 0)) return tools.reply({ error: "Dit item bestaat niet meer." }, 404, origin);
  return tools.reply({ events: await tools.loadEvents(db, ids), rev: await tools.readRev(db) }, 200, origin);
}

// -------------------------------------------------------------
// Day stickers
// -------------------------------------------------------------

function toDaySticker(row) {
  return { id: row.id, view: row.view, day: row.day, stickerId: row.sticker_id, dx: row.dx, dy: row.dy, placedBy: row.placed_by, createdAt: row.created_at };
}

const inRange = (n, [min, max]) => Number.isInteger(n) && n >= min && n <= max;

function checkDaySpot(body) {
  if (!DAY_VIEWS.includes(body.view)) return "Ongeldige plek.";
  if (!isValidDate(body.day)) return "Ongeldige datum.";
  if (!inRange(body.dx, DAY_DX) || !inRange(body.dy, DAY_DY)) return "Ongeldige plek.";
  return "";
}

async function listDayStickers(url, env, origin, tools) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isValidDate(from) || !isValidDate(to) || from > to) return tools.reply({ error: "Ongeldige periode." }, 400, origin);
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > MAX_DAY_RANGE_DAYS) return tools.reply({ error: "Die periode is te lang." }, 400, origin);
  const db = env.AGENDA_DB;
  const [listRes, revRes] = await db.batch([
    db.prepare("SELECT * FROM agenda_day_stickers WHERE day >= ?1 AND day <= ?2 ORDER BY created_at, id").bind(from, to),
    db.prepare("SELECT value FROM agenda_meta WHERE key = 'rev'"),
  ]);
  return tools.reply({ daySticks: listRes.results.map(toDaySticker), rev: revRes.results[0]?.value ?? 0 }, 200, origin);
}

async function createDaySticker(request, env, origin, person, tools) {
  const { body, error } = await tools.readBody(request);
  if (error) return tools.reply({ error }, 400, origin);
  const problem = checkDaySpot(body);
  if (problem) return tools.reply({ error: problem }, 400, origin);
  if (typeof body.stickerId !== "string" || !body.stickerId || body.stickerId.length > 64) return tools.reply({ error: "Ongeldig plaatje." }, 400, origin);
  const db = env.AGENDA_DB;
  const sticker = await db.prepare("SELECT archived FROM agenda_stickers WHERE id = ?").bind(body.stickerId).first();
  if (!sticker || sticker.archived === 1) return tools.reply({ error: "Dit plaatje bestaat niet meer." }, 404, origin);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const [result] = await db.batch([
    db
      .prepare(
        `INSERT INTO agenda_day_stickers (id, view, day, sticker_id, dx, dy, placed_by, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE (SELECT COUNT(*) FROM agenda_day_stickers WHERE view = ?2 AND day = ?3 AND placed_by = ?7) < ?9`
      )
      .bind(id, body.view, body.day, body.stickerId, body.dx, body.dy, person, now, MAX_PLACEMENTS_PER_PERSON),
    tools.bumpRev(db),
  ]);
  if (!result.meta || result.meta.changes === 0) {
    return tools.reply({ error: `Je kunt maximaal ${MAX_PLACEMENTS_PER_PERSON} plaatjes per dag plakken.` }, 400, origin);
  }
  const row = await db.prepare("SELECT * FROM agenda_day_stickers WHERE id = ?").bind(id).first();
  return tools.reply({ daySticker: toDaySticker(row), rev: await tools.readRev(db) }, 201, origin);
}

// Moving can take it to another day (or from the month to the list); either person
// can move or remove any day sticker.
async function moveDaySticker(request, env, origin, id, tools) {
  const { body, error } = await tools.readBody(request);
  if (error) return tools.reply({ error }, 400, origin);
  const problem = checkDaySpot(body);
  if (problem) return tools.reply({ error: problem }, 400, origin);
  const db = env.AGENDA_DB;
  const result = await db
    .prepare("UPDATE agenda_day_stickers SET view = ?, day = ?, dx = ?, dy = ? WHERE id = ?")
    .bind(body.view, body.day, body.dx, body.dy, id)
    .run();
  if (!result.meta || result.meta.changes === 0) return tools.reply({ error: "Dit plaatje zit er niet meer op." }, 404, origin);
  const [, rowRes] = await db.batch([tools.bumpRev(db), db.prepare("SELECT * FROM agenda_day_stickers WHERE id = ?").bind(id)]);
  return tools.reply({ daySticker: toDaySticker(rowRes.results[0]), rev: await tools.readRev(db) }, 200, origin);
}

async function deleteDaySticker(env, origin, id, tools) {
  const db = env.AGENDA_DB;
  const result = await db.prepare("DELETE FROM agenda_day_stickers WHERE id = ?").bind(id).run();
  if (!result.meta || result.meta.changes === 0) return tools.reply({ error: "Dit plaatje zit er niet meer op." }, 404, origin);
  await tools.bumpRev(db).run();
  return tools.reply({ ok: true, rev: await tools.readRev(db) }, 200, origin);
}

// -------------------------------------------------------------
// Router
// -------------------------------------------------------------

/** True for the paths this module answers. */
export function isStickerPath(path) {
  return (
    path === "/agenda/stickers" ||
    path === "/agenda/placements" ||
    path === "/agenda/events/style" ||
    path === "/agenda/day-stickers" ||
    STICKER_PATH.test(path) ||
    PLACEMENT_PATH.test(path) ||
    DAY_STICKER_PATH.test(path)
  );
}

export async function handleStickers(request, env, origin, url, person, path, tools) {
  const method = request.method;
  const notAllowed = (allow) => tools.methodNotAllowed(origin, allow);

  if (path === "/agenda/stickers") {
    if (method === "GET") return listStickers(url, env, origin, tools);
    if (method === "POST") return createStickers(request, env, origin, person, tools);
    return notAllowed("GET, POST");
  }
  if (path === "/agenda/placements") {
    return method === "POST" ? createPlacement(request, env, origin, person, tools) : notAllowed("POST");
  }
  if (path === "/agenda/events/style") {
    return method === "POST" ? styleEvents(request, env, origin, tools) : notAllowed("POST");
  }

  const sticker = STICKER_PATH.exec(path);
  if (sticker) {
    if (method === "PATCH") return updateSticker(request, env, origin, sticker[1], tools);
    if (method === "DELETE") return archiveSticker(env, origin, sticker[1], tools);
    return notAllowed("PATCH, DELETE");
  }
  if (path === "/agenda/day-stickers") {
    if (method === "GET") return listDayStickers(url, env, origin, tools);
    if (method === "POST") return createDaySticker(request, env, origin, person, tools);
    return notAllowed("GET, POST");
  }
  const daySticker = DAY_STICKER_PATH.exec(path);
  if (daySticker) {
    if (method === "PATCH") return moveDaySticker(request, env, origin, daySticker[1], tools);
    if (method === "DELETE") return deleteDaySticker(env, origin, daySticker[1], tools);
    return notAllowed("PATCH, DELETE");
  }
  const placement = PLACEMENT_PATH.exec(path);
  if (placement) {
    if (method === "PATCH") return movePlacement(request, env, origin, placement[1], tools);
    if (method === "DELETE") return deletePlacement(env, origin, placement[1], tools);
    return notAllowed("PATCH, DELETE");
  }

  return tools.reply({ error: "Not found" }, 404, origin);
}
