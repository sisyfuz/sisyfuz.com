// src/utils/agendaBusy.js
// "Onbeschikbaar" (busy) items: school, therapie, werk... They get one compact
// line each, and back-to-back blocks of the same person and reason on a day
// (lessons with short breaks) merge into one line, e.g. SCHOOL 13:30–18:10.

import { timeLabel } from "./agendaDates.js";

/** Breaks up to this long still merge two blocks into one line. */
export const BUSY_GAP_MINUTES = 30;

export const BUSY_REASONS = ["school", "therapie", "werk", "ziek"];

export function isBusy(event) {
    return event?.kind === "onbeschikbaar";
}

const minutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

/**
 * Groups the busy items of one day into display lines.
 * @param {object[]} items busy items covering `day`
 * @param {string} day YYYY-MM-DD
 * @returns {{ key: string, forWho: string, reason: string, label: string, items: object[], sort: string }[]}
 */
export function busyGroups(items, day) {
    const groups = [];
    const timed = [];
    for (const e of items) {
        const sameDayTimed = !e.allDay && e.startDate === day && e.endDate === day;
        if (sameDayTimed) timed.push(e);
        else groups.push({ key: e.id, forWho: e.forWho, reason: e.reason, label: timeLabel(e, day), items: [e], sort: "00:00" });
    }

    timed.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const open = new Map(); // forWho|reason -> group still accepting blocks
    for (const e of timed) {
        const who = `${e.forWho}|${e.reason.toLowerCase()}`;
        const start = minutes(e.startTime);
        const end = e.endTime ? minutes(e.endTime) : start;
        const g = open.get(who);
        if (g && start <= g.end + BUSY_GAP_MINUTES) {
            g.items.push(e);
            g.end = Math.max(g.end, end);
            continue;
        }
        const group = { key: e.id, forWho: e.forWho, reason: e.reason, items: [e], start, end, sort: e.startTime };
        open.set(who, group);
        groups.push(group);
    }

    const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    return groups
        .map(({ start, end, ...g }) => (start === undefined ? g : { ...g, label: end > start ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start) }))
        .sort((a, b) => a.sort.localeCompare(b.sort));
}
