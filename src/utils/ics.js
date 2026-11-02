// src/utils/ics.js
// Reads iCalendar (.ics) files, as exported by school timetables (Zermelo,
// Somtoday, Magister), Google, Apple and Outlook, into agenda items in the
// device's own time zone. Repeating items (RRULE) are expanded within a window;
// EXDATE, RECURRENCE-ID and cancelled items are honoured.
//
// Every item gets a stable `uid` (the file's UID, plus the original start for
// one occurrence of a repeating item), so importing the same file again updates
// items instead of adding copies.

const MAX_ITEMS = 3000;
const MAX_PER_SERIES = 1000;
const MAX_LOOP = 20000;
const DAY_MS = 86_400_000;
const LIMITS = { title: 120, location: 120, note: 2000 };

// Outlook writes Windows zone names; map the common European ones.
const WINDOWS_ZONES = {
    "W. Europe Standard Time": "Europe/Amsterdam",
    "Romance Standard Time": "Europe/Paris",
    "Central Europe Standard Time": "Europe/Budapest",
    "GMT Standard Time": "Europe/London",
    UTC: "UTC",
};

const WEEKDAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Lines and properties
// ---------------------------------------------------------------------------

/** Joins folded lines (a line starting with a space or tab continues the previous one). */
export function unfold(text) {
    return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
}

function parseLine(line) {
    let inQuote = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuote = !inQuote;
        else if (line[i] === ":" && !inQuote) {
            colon = i;
            break;
        }
    }
    if (colon < 0) return null;
    const [name, ...rawParams] = line.slice(0, colon).split(";");
    const params = {};
    for (const p of rawParams) {
        const eq = p.indexOf("=");
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value) {
    return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

/** Splits a file into calendar properties and VEVENT property lists. */
function readComponents(text) {
    const events = [];
    const calendar = {};
    const stack = [];
    let current = null;
    for (const raw of unfold(text).split("\n")) {
        if (!raw.trim()) continue;
        const prop = parseLine(raw);
        if (!prop) continue;
        if (prop.name === "BEGIN") {
            stack.push(prop.value.toUpperCase());
            if (prop.value.toUpperCase() === "VEVENT" && stack.length === 2) current = {};
            continue;
        }
        if (prop.name === "END") {
            if (prop.value.toUpperCase() === "VEVENT" && current) {
                events.push(current);
                current = null;
            }
            stack.pop();
            continue;
        }
        if (current && stack.at(-1) === "VEVENT") {
            (current[prop.name] ??= []).push(prop);
        } else if (stack.length === 1) {
            calendar[prop.name] ??= prop;
        }
    }
    return { calendar, events };
}

// ---------------------------------------------------------------------------
// Time zones. A "wall" time is [y, m (1-12), d, h, min] in some zone; wall
// arithmetic is done as if it were UTC, so adding days never shifts the hour.
// ---------------------------------------------------------------------------

const formatters = new Map();

function zoneFormatter(timeZone) {
    if (!formatters.has(timeZone)) {
        formatters.set(
            timeZone,
            new Intl.DateTimeFormat("en-CA", {
                timeZone,
                hourCycle: "h23",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            })
        );
    }
    return formatters.get(timeZone);
}

function validZone(name) {
    if (!name) return null;
    const zone = WINDOWS_ZONES[name] ?? name;
    try {
        zoneFormatter(zone);
        return zone;
    } catch {
        return null;
    }
}

/** UTC instant -> wall time in a zone. */
function utcToWall(ms, timeZone) {
    const p = Object.fromEntries(zoneFormatter(timeZone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute)];
}

const wallMs = (w) => Date.UTC(w[0], w[1] - 1, w[2], w[3] ?? 0, w[4] ?? 0);

function msToWall(ms) {
    const d = new Date(ms);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

/** Wall time in a zone -> UTC instant. */
function wallToUtc(wall, timeZone) {
    const guess = wallMs(wall);
    const offset = (ms) => wallMs(utcToWall(ms, timeZone)) - Math.floor(ms / 60_000) * 60_000;
    const first = guess - offset(guess);
    return guess - offset(first);
}

/** Moves a wall time from one zone (null = floating) to the target zone. */
function convertWall(wall, fromZone, toZone) {
    if (!fromZone || fromZone === toZone) return wall;
    const utc = fromZone === "UTC" ? wallMs(wall) : wallToUtc(wall, fromZone);
    return utcToWall(utc, toZone);
}

/**
 * Parses a DATE or DATE-TIME property.
 * @returns {{ wall: number[], allDay: boolean, zone: string|null } | null}
 */
function parseDateProp(prop) {
    const v = prop.value.trim();
    const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (date || prop.params.VALUE === "DATE") {
        const m = date || /^(\d{4})(\d{2})(\d{2})/.exec(v);
        if (!m) return null;
        return { wall: [Number(m[1]), Number(m[2]), Number(m[3]), 0, 0], allDay: true, zone: null };
    }
    const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!dt) return null;
    const wall = [Number(dt[1]), Number(dt[2]), Number(dt[3]), Number(dt[4]), Number(dt[5])];
    const zone = dt[7] ? "UTC" : validZone(prop.params.TZID);
    return { wall, allDay: false, zone };
}

/** ISO 8601 duration (P1D, PT1H30M, P1W) in ms. */
function parseDuration(value) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
    if (!m) return null;
    const [, sign, w, d, h, min, s] = m;
    const ms = ((Number(w || 0) * 7 + Number(d || 0)) * 24 * 60 + Number(h || 0) * 60 + Number(min || 0)) * 60_000 + Number(s || 0) * 1000;
    return sign === "-" ? -ms : ms;
}

// ---------------------------------------------------------------------------
// Repeating items
// ---------------------------------------------------------------------------

function parseRule(value) {
    const rule = {};
    for (const part of value.split(";")) {
        const [k, v] = part.split("=");
        if (k && v) rule[k.toUpperCase()] = v.toUpperCase();
    }
    return rule;
}

const SUPPORTED_RULE_PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"]);

function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day of month for "2TU" / "-1FR" style rules, or null if that day does not exist. */
function nthWeekday(y, m, weekday, n) {
    if (n > 0) {
        const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
        const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
        return day <= daysInMonth(y, m) ? day : null;
    }
    const last = daysInMonth(y, m);
    const lastDow = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
    const day = last - ((lastDow - weekday + 7) % 7) + (n + 1) * 7;
    return day >= 1 ? day : null;
}

/**
 * Start wall times of a repeating item, in the item's own zone, between `fromMs`
 * and `untilMs` (wall ms), honouring COUNT and UNTIL. Occurrences before `fromMs`
 * still count towards COUNT but are not returned, so old series do not use up
 * the cap before reaching the window.
 */
function expandRule(startWall, rule, untilMs, fromMs = -Infinity) {
    const interval = Math.max(1, Number(rule.INTERVAL) || 1);
    const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
    const startMs = wallMs(startWall);
    const [, , , h, min] = startWall;
    const out = [];
    let produced = 0;

    const take = (ms) => {
        if (ms < startMs) return true;
        if (produced >= count || ms > untilMs) return false;
        produced += 1;
        if (ms < fromMs) return true;
        if (out.length >= MAX_PER_SERIES) return false;
        out.push(msToWall(ms));
        return true;
    };

    const byDay = (rule.BYDAY || "").split(",").filter(Boolean).map((d) => {
        const m = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(d);
        return m ? { n: m[1] ? Number(m[1]) : 0, day: WEEKDAYS[m[2]] } : null;
    }).filter(Boolean);

    // Without COUNT, daily and weekly series can jump straight to the window, so a
    // daily item from long ago does not run out of loops before reaching it.
    const periodMs = rule.FREQ === "DAILY" ? DAY_MS * interval : rule.FREQ === "WEEKLY" ? 7 * DAY_MS * interval : 0;
    const first = !rule.COUNT && periodMs && fromMs > startMs ? Math.max(0, Math.floor((fromMs - startMs) / periodMs) - 1) : 0;

    for (let i = first; i < first + MAX_LOOP; i++) {
        let candidates;
        if (rule.FREQ === "DAILY") {
            candidates = [startMs + i * interval * DAY_MS];
        } else if (rule.FREQ === "WEEKLY") {
            const dow = new Date(startMs).getUTCDay();
            const weekStart = startMs - ((dow + 6) % 7) * DAY_MS + i * interval * 7 * DAY_MS;
            const days = byDay.length ? byDay.map((b) => b.day) : [dow];
            candidates = [...new Set(days)].map((d) => weekStart + ((d + 6) % 7) * DAY_MS).sort((a, b) => a - b);
        } else if (rule.FREQ === "MONTHLY") {
            const total = startWall[0] * 12 + (startWall[1] - 1) + i * interval;
            const y = Math.floor(total / 12);
            const m = (total % 12) + 1;
            let days;
            if (byDay.some((b) => b.n !== 0)) days = byDay.map((b) => nthWeekday(y, m, b.day, b.n || 1));
            else if (rule.BYMONTHDAY) days = rule.BYMONTHDAY.split(",").map(Number).map((d) => (d < 0 ? daysInMonth(y, m) + d + 1 : d));
            else days = [startWall[2]];
            candidates = days
                .filter((d) => d && d >= 1 && d <= daysInMonth(y, m))
                .sort((a, b) => a - b)
                .map((d) => Date.UTC(y, m - 1, d, h, min));
        } else if (rule.FREQ === "YEARLY") {
            const y = startWall[0] + i * interval;
            candidates = startWall[2] <= daysInMonth(y, startWall[1]) ? [Date.UTC(y, startWall[1] - 1, startWall[2], h, min)] : [];
        } else {
            return [startWall];
        }
        if (candidates.length && candidates[0] > untilMs) break;
        for (const ms of candidates) if (!take(ms)) return out;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const toDate = (w) => `${w[0]}-${pad(w[1])}-${pad(w[2])}`;
const toTime = (w) => `${pad(w[3])}:${pad(w[4])}`;

function occurrenceKey(wall, allDay) {
    return allDay ? toDate(wall) : `${toDate(wall)}T${toTime(wall)}`;
}

function text(props, name, max) {
    const v = props[name]?.[0]?.value;
    return v ? unescapeText(v).slice(0, max) : "";
}

/** Builds one agenda item from a start (in the target zone) and a length. */
function makeItem(base, startWall, lengthMs, allDay) {
    if (allDay) {
        const days = Math.max(1, Math.round(lengthMs / DAY_MS));
        return {
            ...base,
            allDay: true,
            startDate: toDate(startWall),
            endDate: toDate(msToWall(wallMs(startWall) + (days - 1) * DAY_MS)),
            startTime: null,
            endTime: null,
        };
    }
    let endWall = msToWall(wallMs(startWall) + Math.max(0, lengthMs));
    let endTime = lengthMs > 0 ? toTime(endWall) : null;
    // Ending at midnight belongs to the day before.
    if (endTime === "00:00" && toDate(endWall) > toDate(startWall)) {
        endWall = msToWall(wallMs(endWall) - DAY_MS);
        endTime = "23:59";
    }
    return {
        ...base,
        allDay: false,
        startDate: toDate(startWall),
        endDate: toDate(endWall),
        startTime: toTime(startWall),
        endTime,
    };
}

/**
 * Parses an .ics file into agenda items.
 * @param {string} source file contents
 * @param {{ from: string, to: string, timeZone?: string }} window  only items overlapping
 *   [from, to] (YYYY-MM-DD) are returned; repeats are expanded up to `to`.
 * @returns {{ items: object[], calendarName: string, cancelled: number, unsupported: number, truncated: boolean }}
 */
export function parseIcs(source, { from, to, timeZone } = {}) {
    const target = validZone(timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { calendar, events } = readComponents(String(source ?? ""));
    const calendarZone = validZone(calendar["X-WR-TIMEZONE"]?.value);
    const dayMs = (iso) => Date.UTC(...iso.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
    const untilMs = to ? dayMs(to) + DAY_MS - 60_000 : Infinity;
    const fromMs = from ? dayMs(from) - DAY_MS : -Infinity;
    // All-day dates stay as they are; date-times move to the target zone.
    const localWall = (parsed) => (parsed.allDay ? parsed.wall : convertWall(parsed.wall, parsed.zone ?? calendarZone, target));

    // Moved or cancelled single occurrences, by UID and original start.
    const overrides = new Map();
    for (const props of events) {
        const rid = props["RECURRENCE-ID"]?.[0];
        const uid = props.UID?.[0]?.value;
        if (!rid || !uid) continue;
        const parsed = parseDateProp(rid);
        if (!parsed) continue;
        overrides.set(`${uid}#${occurrenceKey(localWall(parsed), parsed.allDay)}`, props);
    }

    const items = [];
    let cancelled = 0;
    let unsupported = 0;
    let truncated = false;

    for (const props of events) {
        const startProp = props.DTSTART?.[0];
        const start = startProp && parseDateProp(startProp);
        if (!start) {
            unsupported += 1;
            continue;
        }
        const isOverride = Boolean(props["RECURRENCE-ID"]);
        const status = props.STATUS?.[0]?.value?.toUpperCase();
        if (status === "CANCELLED") {
            cancelled += 1;
            continue;
        }

        const zone = start.allDay ? null : start.zone ?? calendarZone;
        const endProp = props.DTEND?.[0];
        const end = endProp && parseDateProp(endProp);
        let lengthMs;
        if (end) {
            const endWall = start.allDay ? end.wall : convertWall(end.wall, end.zone ?? calendarZone, zone ?? target);
            lengthMs = wallMs(endWall) - wallMs(start.wall);
        } else if (props.DURATION?.[0]) {
            lengthMs = parseDuration(props.DURATION[0].value) ?? 0;
        } else {
            lengthMs = start.allDay ? DAY_MS : 0;
        }
        if (start.allDay && lengthMs <= 0) lengthMs = DAY_MS;

        const fileUid = props.UID?.[0]?.value?.trim();
        const title = text(props, "SUMMARY", LIMITS.title) || "(zonder titel)";
        const base = {
            title,
            location: text(props, "LOCATION", LIMITS.location),
            note: text(props, "DESCRIPTION", LIMITS.note),
        };
        const fallbackUid = `${title}|${occurrenceKey(start.wall, start.allDay)}`;

        const rrule = props.RRULE?.[0]?.value;
        if (!rrule || isOverride) {
            const wall = start.allDay ? start.wall : convertWall(start.wall, zone, target);
            let uid = fileUid || fallbackUid;
            if (isOverride && fileUid) {
                const rid = parseDateProp(props["RECURRENCE-ID"][0]);
                uid = `${fileUid}#${occurrenceKey(localWall(rid), rid.allDay)}`;
            }
            items.push(makeItem({ ...base, uid }, wall, lengthMs, start.allDay));
            continue;
        }

        const rule = parseRule(rrule);
        if (Object.keys(rule).some((k) => !SUPPORTED_RULE_PARTS.has(k))) unsupported += 1;
        let ruleUntil = untilMs;
        if (rule.UNTIL) {
            const u = parseDateProp({ value: rule.UNTIL, params: {} });
            if (u) {
                const uWall = u.allDay ? [...u.wall.slice(0, 3), 23, 59] : convertWall(u.wall, u.zone, zone ?? target);
                ruleUntil = Math.min(ruleUntil, wallMs(uWall));
            }
        }

        const exdates = new Set();
        for (const ex of props.EXDATE ?? []) {
            for (const value of ex.value.split(",")) {
                const parsed = parseDateProp({ value, params: ex.params });
                if (!parsed) continue;
                exdates.add(occurrenceKey(localWall(parsed), start.allDay));
            }
        }

        for (const occWall of expandRule(start.wall, rule, ruleUntil, fromMs - Math.max(lengthMs, 0))) {
            const wall = start.allDay ? occWall : convertWall(occWall, zone, target);
            const key = occurrenceKey(wall, start.allDay);
            if (exdates.has(key) || overrides.has(`${fileUid}#${key}`)) continue;
            items.push(makeItem({ ...base, uid: `${fileUid || fallbackUid}#${key}` }, wall, lengthMs, start.allDay));
        }
    }

    let inRange = items.filter((e) => (!from || e.endDate >= from) && (!to || e.startDate <= to));
    inRange.sort((a, b) => `${a.startDate}${a.startTime ?? ""}`.localeCompare(`${b.startDate}${b.startTime ?? ""}`));
    if (inRange.length > MAX_ITEMS) {
        inRange = inRange.slice(0, MAX_ITEMS);
        truncated = true;
    }

    const name = calendar["X-WR-CALNAME"]?.value;
    return { items: inRange, calendarName: name ? unescapeText(name) : "", cancelled, unsupported, truncated };
}

/** Guesses a reason from a calendar or file name. */
export function guessReason(...names) {
    const s = names.filter(Boolean).join(" ").toLowerCase();
    if (/therap|psycholo|ggz/.test(s)) return "therapie";
    if (/werk|dienst|shift|work/.test(s)) return "werk";
    if (/school|rooster|les|zermelo|somtoday|magister|college|studie|uni/.test(s)) return "school";
    return "";
}

/** Guesses how a calendar should come in: holidays as periods, birthdays as special days. */
export function guessKind(...names) {
    const s = names.filter(Boolean).join(" ").toLowerCase();
    if (/vakantie|vacation|holiday|feestdag/.test(s)) return { kind: "periode" };
    if (/verjaardag|birthday|jarig/.test(s)) return { kind: "bijzonder", specialKind: "verjaardag" };
    return {};
}
