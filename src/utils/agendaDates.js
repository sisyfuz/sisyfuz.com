// src/utils/agendaDates.js
// Pure date helpers for the agenda. Dates are local calendar days as
// "YYYY-MM-DD" strings, times are "HH:MM"; weeks start on Monday (NL).

const pad = (n) => String(n).padStart(2, "0");

/** @param {Date} date */
export function toIso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {string} iso */
export function parseIso(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function todayIso(now = new Date()) {
    return toIso(now);
}

export function addDays(iso, n) {
    const d = parseIso(iso);
    d.setDate(d.getDate() + n);
    return toIso(d);
}

export function daysBetween(a, b) {
    return Math.round((Date.UTC(...isoParts(b)) - Date.UTC(...isoParts(a))) / 86_400_000);
}

function isoParts(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return [y, m - 1, d];
}

/** { year, month } with month 0-11, shifted by `n` months. */
export function addMonths({ year, month }, n) {
    const total = year * 12 + month + n;
    return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function monthOf(iso) {
    const [y, m] = iso.split("-").map(Number);
    return { year: y, month: m - 1 };
}

/** ISO 8601 week number. */
export function isoWeek(iso) {
    const d = new Date(Date.UTC(...isoParts(iso)));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
}

/** Monday index 0-6 for a date string. */
export function weekdayIndex(iso) {
    return (parseIso(iso).getDay() + 6) % 7;
}

/**
 * Weeks covering a month, Monday first: [{ week, days: [iso x7] }].
 * @param {{ year: number, month: number }} ym
 */
export function monthGrid({ year, month }) {
    const first = toIso(new Date(year, month, 1));
    const last = toIso(new Date(year, month + 1, 0));
    let cursor = addDays(first, -weekdayIndex(first));
    const end = addDays(last, 6 - weekdayIndex(last));
    const weeks = [];
    while (cursor <= end) {
        const days = Array.from({ length: 7 }, (_, i) => addDays(cursor, i));
        weeks.push({ week: isoWeek(days[0]), days });
        cursor = addDays(cursor, 7);
    }
    return weeks;
}

export const WEEKDAYS_SHORT = ["MA", "DI", "WO", "DO", "VR", "ZA", "ZO"];

const MONTHS = [
    "januari", "februari", "maart", "april", "mei", "juni",
    "juli", "augustus", "september", "oktober", "november", "december",
];
const WEEKDAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

export function monthTitle({ year, month }) {
    return `${MONTHS[month]} ${year}`.toUpperCase();
}

/** "za 7 nov" */
export function formatDayShort(iso) {
    const [, m, d] = iso.split("-").map(Number);
    return `${WEEKDAYS[weekdayIndex(iso)].slice(0, 2)} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** "zaterdag 7 november 2026" */
export function formatDayLong(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${WEEKDAYS[weekdayIndex(iso)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** Relative day name for list headers: "vandaag", "morgen", "gisteren" or null. */
export function relativeDay(iso, today) {
    const diff = daysBetween(today, iso);
    if (diff === 0) return "vandaag";
    if (diff === 1) return "morgen";
    if (diff === -1) return "gisteren";
    return null;
}

/** When an item happens, in words: "zaterdag 7 november 2026, 18:00–21:00". */
export function formatWhen(event) {
    const start = formatDayLong(event.startDate);
    const multiDay = event.endDate !== event.startDate;
    if (event.allDay) {
        return multiDay ? `${start} t/m ${formatDayLong(event.endDate)}` : `${start}, hele dag`;
    }
    const startTime = event.startTime;
    if (multiDay) {
        const end = formatDayLong(event.endDate);
        return event.endTime ? `${start} ${startTime} t/m ${end} ${event.endTime}` : `${start} ${startTime} t/m ${end}`;
    }
    return event.endTime ? `${start}, ${startTime}–${event.endTime}` : `${start}, ${startTime}`;
}

/** Short time label for an item on one day of a list. */
export function timeLabel(event, iso) {
    if (event.allDay) return "HELE DAG";
    const isStart = iso === event.startDate;
    const isEnd = iso === event.endDate;
    if (isStart && isEnd) return event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime;
    if (isStart) return `VANAF ${event.startTime}`;
    if (isEnd) return event.endTime ? `TOT ${event.endTime}` : "HELE DAG";
    return "HELE DAG";
}

/** True when an item covers a given day. */
export function coversDay(event, iso) {
    return event.startDate <= iso && event.endDate >= iso;
}

/** Sort key within a day: all-day items first, then by start time. */
function dayOrder(event, iso) {
    if (event.allDay || iso !== event.startDate) return "00:00!";
    return event.startTime;
}

function sortForDay(list, iso) {
    return list.sort((a, b) => dayOrder(a, iso).localeCompare(dayOrder(b, iso)) || a.title.localeCompare(b.title, "nl"));
}

/** Items covering a day, in display order. */
export function eventsOnDay(events, iso) {
    return sortForDay(events.filter((e) => coversDay(e, iso)), iso);
}

/**
 * Items per day for [from, to], each day in display order. One pass over the
 * items instead of filtering all of them again for every day shown.
 * @returns {Map<string, object[]>}
 */
export function indexByDay(events, from, to) {
    const index = new Map();
    for (const e of events) {
        let day = e.startDate < from ? from : e.startDate;
        const end = e.endDate > to ? to : e.endDate;
        while (day <= end) {
            if (!index.has(day)) index.set(day, []);
            index.get(day).push(e);
            day = addDays(day, 1);
        }
    }
    for (const [day, list] of index) sortForDay(list, day);
    return index;
}

/** "vandaag 14:02", "gisteren 9:30" or "ma 3 nov 14:02" for an ISO timestamp. */
export function formatStamp(timestamp, now = new Date()) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const iso = toIso(date);
    const rel = relativeDay(iso, toIso(now));
    if (rel === "vandaag" || rel === "gisteren") return `${rel} ${time}`;
    return `${formatDayShort(iso)} ${time}`;
}

/** Next whole hour as "HH:00", capped at 23:00. */
export function nextWholeHour(now = new Date()) {
    return `${pad(Math.min(now.getHours() + 1, 23))}:00`;
}
