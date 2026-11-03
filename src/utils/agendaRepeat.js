// src/utils/agendaRepeat.js
// Repeating appointments and busy blocks. One stored item is a whole series
// with a `rule`: { freq: "dag" | "week" | "maand" | "jaar", interval, days?,
// until?, count? }. `days` (week only) are Monday-based weekday indexes 0-6;
// `until` is the last day an occurrence may start, `count` the number of
// occurrences. The worker returns a series for every range it touches and the
// occurrences are worked out here; the worker uses the same code to check rules
// and to know when a series ends. Dates are "YYYY-MM-DD" strings and all maths
// goes through whole days (addDays), so summer time never shifts anything.

import { addDays, daysBetween, formatDayLong, weekdayIndex } from "./agendaDates.js";

export const FREQS = ["dag", "week", "maand", "jaar"];
export const MAX_INTERVAL = 52;
export const MAX_COUNT = 999;
// Nothing is planned after this, so counting a series stops here.
const LAST_DAY = "2100-12-31";
// Safety net: no loop below takes more steps than this.
const MAX_STEPS = 5000;

const pad = (n) => String(n).padStart(2, "0");
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** Days in a month, `month` 0-11. */
const monthLength = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

function isDate(value) {
    const m = typeof value === "string" ? DATE_RE.exec(value) : null;
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= monthLength(y, mo - 1);
}

const isSet = (value) => value !== undefined && value !== null && value !== "";

// The longest an occurrence may last (days from its first to its last day), so
// two occurrences of one series never cover the same day.
function maxSpan(rule) {
    if (rule.freq === "dag") return rule.interval - 1;
    if (rule.freq === "maand") return 28 * rule.interval - 1;
    if (rule.freq === "jaar") return 365 * rule.interval - 1;
    const days = rule.days;
    let gap = 7 * rule.interval - days[days.length - 1] + days[0];
    for (let i = 1; i < days.length; i++) gap = Math.min(gap, days[i] - days[i - 1]);
    return gap - 1;
}

/**
 * Checks a rule for an item from `startDate` to `endDate` and returns it
 * cleaned up ({ value }, null = no repeat) or { error } in Dutch.
 */
export function checkRule(input, startDate, endDate = startDate) {
    if (!isSet(input)) return { value: null };
    if (typeof input !== "object" || Array.isArray(input) || !FREQS.includes(input.freq)) return { error: "Ongeldige herhaling." };
    const interval = input.interval === undefined ? 1 : input.interval;
    if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return { error: "Ongeldige herhaling." };
    const rule = { freq: input.freq, interval };
    if (rule.freq === "week") {
        const days = input.days === undefined ? [weekdayIndex(startDate)] : input.days;
        if (!Array.isArray(days) || !days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
            return { error: "Kies op welke dagen het herhaalt." };
        }
        rule.days = [...new Set(days)].sort((a, b) => a - b);
    }
    if (isSet(input.until) && isSet(input.count)) return { error: "Kies een einddatum of een aantal keer, niet allebei." };
    if (isSet(input.until)) {
        if (!isDate(input.until)) return { error: "Ongeldige einddatum van de herhaling." };
        if (input.until < startDate) return { error: "De herhaling stopt voordat hij begint." };
        rule.until = input.until;
    }
    if (isSet(input.count)) {
        if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_COUNT) return { error: `Herhaal 1 tot ${MAX_COUNT} keer.` };
        rule.count = input.count;
    }
    if (daysBetween(startDate, endDate) > maxSpan(rule)) return { error: "Zo lang kan een herhaald item niet duren." };
    return { value: rule };
}

// The start dates in period `p` of a series (0 = the period it starts in), in order.
function periodDates(startDate, rule, p) {
    const [y, m, d] = startDate.split("-").map(Number);
    if (rule.freq === "dag") return [addDays(startDate, p * rule.interval)];
    if (rule.freq === "week") {
        const monday = addDays(startDate, 7 * p * rule.interval - weekdayIndex(startDate));
        return rule.days.map((wd) => addDays(monday, wd)).filter((date) => date >= startDate);
    }
    // Monthly on the 31st falls on the last day of shorter months; yearly on
    // 29 February falls on the 28th in other years.
    const total = rule.freq === "maand" ? m - 1 + p * rule.interval : m - 1;
    const year = rule.freq === "maand" ? y + Math.floor(total / 12) : y + p * rule.interval;
    const month = total % 12;
    return [`${year}-${pad(month + 1)}-${pad(Math.min(d, monthLength(year, month)))}`];
}

// The first period that can hold an occurrence on or after `from`.
function firstPeriod(startDate, rule, from) {
    if (from <= startDate) return 0;
    const [y, m] = startDate.split("-").map(Number);
    const [fy, fm] = from.split("-").map(Number);
    if (rule.freq === "dag") return Math.floor(daysBetween(startDate, from) / rule.interval);
    if (rule.freq === "week") return Math.floor(daysBetween(addDays(startDate, -weekdayIndex(startDate)), from) / (7 * rule.interval));
    const steps = rule.freq === "maand" ? (fy - y) * 12 + fm - m : fy - y;
    return Math.max(0, Math.floor(steps / rule.interval) - 1);
}

/**
 * Start dates of a series' occurrences from `from` to `to` (both included), in
 * order, with its `until` and `count` applied (exceptions are not).
 */
export function occurrenceDates(startDate, rule, from, to) {
    const out = [];
    const last = rule.until && rule.until < to ? rule.until : to;
    // A count numbers the occurrences from the first one, so it starts there.
    let p = rule.count ? 0 : firstPeriod(startDate, rule, from);
    let n = 0;
    for (let steps = 0; steps < MAX_STEPS; steps++, p++) {
        for (const date of periodDates(startDate, rule, p)) {
            if (date > last || (rule.count && n >= rule.count)) return out;
            n++;
            if (date >= from) out.push(date);
        }
    }
    return out;
}

/** The first day a series really happens (a weekly one may skip its own start date). */
export function firstOccurrence(event) {
    if (!event.rule) return event.startDate;
    const reach = event.rule.freq === "week" ? 7 * event.rule.interval + 6 : 0;
    return occurrenceDates(event.startDate, event.rule, event.startDate, addDays(event.startDate, reach))[0] ?? null;
}

/** How many occurrences start before `date`. */
export function countBefore(event, date) {
    return event.rule ? occurrenceDates(event.startDate, event.rule, event.startDate, addDays(date, -1)).length : 0;
}

/** The last day a series covers, or null when it never ends. */
export function seriesEnd(event) {
    const rule = event.rule;
    if (!rule) return event.endDate;
    const span = daysBetween(event.startDate, event.endDate);
    if (rule.count) {
        const dates = occurrenceDates(event.startDate, rule, event.startDate, LAST_DAY);
        return addDays(dates[dates.length - 1] ?? event.startDate, span);
    }
    return rule.until ? addDays(rule.until, span) : null;
}

/**
 * One occurrence of a series: the item with its own days, `occurrenceDate`, a
 * `key` that is unique per occurrence and only the stickers stuck on it. It
 * keeps the item's id, since seen, read, akkoord, colour and logo are per series.
 * An item that does not repeat comes back as it is.
 */
export function occurrenceOf(event, date) {
    if (!event?.rule) return event;
    return {
        ...event,
        startDate: date,
        endDate: addDays(date, daysBetween(event.startDate, event.endDate)),
        occurrenceDate: date,
        key: `${event.id}@${date}`,
        seriesStart: event.startDate,
        placements: (event.placements ?? []).filter((p) => p.occurrenceDate === date),
    };
}

/**
 * Replaces each repeating item by its occurrences that touch [from, to]. Dates
 * with an exception (skipped, or moved to an item of their own) are left out.
 */
export function expandRepeats(events, from, to) {
    const out = [];
    for (const e of events) {
        if (!e.rule) {
            out.push(e);
            continue;
        }
        const skip = new Set((e.exceptions ?? []).map((x) => x.date));
        const span = daysBetween(e.startDate, e.endDate);
        for (const date of occurrenceDates(e.startDate, e.rule, addDays(from, -span), to)) {
            if (!skip.has(date)) out.push(occurrenceOf(e, date));
        }
    }
    return out;
}

// ---- The form ----

/** The choices in the form, in order. */
export const PATTERNS = [
    { id: "niet", label: "NIET" },
    { id: "dag", label: "ELKE DAG", freq: "dag", interval: 1 },
    { id: "week", label: "ELKE WEEK", freq: "week", interval: 1 },
    { id: "2weken", label: "ELKE 2 WEKEN", freq: "week", interval: 2 },
    { id: "maand", label: "ELKE MAAND", freq: "maand", interval: 1 },
    { id: "jaar", label: "ELK JAAR", freq: "jaar", interval: 1 },
];

/** Which form choice a rule is. */
export function patternOf(rule) {
    if (!rule) return "niet";
    if (rule.freq === "week") return rule.interval === 2 ? "2weken" : "week";
    return rule.freq;
}

/**
 * A rule from the form's choices: a pattern id, the ticked weekdays, and the end
 * ({ end: "nooit" | "datum" | "keer", until, count }).
 */
export function ruleFrom(patternId, days, { end, until, count }) {
    const pattern = PATTERNS.find((p) => p.id === patternId);
    if (!pattern?.freq) return null;
    const rule = { freq: pattern.freq, interval: pattern.interval };
    if (pattern.freq === "week") rule.days = [...days].sort((a, b) => a - b);
    if (end === "datum") rule.until = until;
    if (end === "keer") rule.count = count;
    return rule;
}

/**
 * Ticked weekdays after the date moves from `from` to `to`: the old date's
 * weekday goes along to the new one, the other ticks stay.
 */
export function moveDays(days, from, to) {
    const old = weekdayIndex(from);
    if (!days.includes(old)) return days;
    return [...new Set([...days.filter((d) => d !== old), weekdayIndex(to)])].sort((a, b) => a - b);
}

/**
 * What to send when an occurrence on `date` of `series` was edited in the form
 * (`form` holds that occurrence's own dates). "alle" moves the whole series by
 * as many days as the occurrence moved; "deze" turns this one date into an item
 * of its own; "volgende" starts a new series from here.
 */
export function editBody(series, date, form, scope) {
    if (scope === "alle") {
        const shift = daysBetween(date, form.startDate);
        const startDate = addDays(series.startDate, shift);
        return { ...form, startDate, endDate: addDays(startDate, daysBetween(form.startDate, form.endDate)), scope };
    }
    return { ...form, rule: scope === "deze" ? null : form.rule, scope, occurrenceDate: date };
}

// ---- In words ----

/** "elke week op ma en wo · tot en met dinsdag 1 december 2026", "elke dag · 10 keer". */
export function repeatText(rule, startDate) {
    if (!rule) return "";
    const [, day, month] = formatDayLong(startDate).split(" ");
    const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} en ${items[items.length - 1]}` : items[0]);
    const every = (one, many) => (rule.interval === 1 ? one : `elke ${rule.interval} ${many}`);
    let text;
    if (rule.freq === "dag") text = every("elke dag", "dagen");
    else if (rule.freq === "week") text = `${every("elke week", "weken")} op ${list(rule.days.map((d) => WEEKDAYS[d]))}`;
    else if (rule.freq === "maand") text = `${every("elke maand", "maanden")} op de ${day}e${Number(day) > 28 ? " (of de laatste dag)" : ""}`;
    else text = `${every("elk jaar", "jaar")} op ${day} ${month}`;
    if (rule.until) text += ` · tot en met ${formatDayLong(rule.until)}`;
    if (rule.count) text += ` · ${rule.count} keer`;
    return text;
}
