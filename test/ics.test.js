// test/ics.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseIcs, guessKind, guessReason, unfold } from "../src/utils/ics.js";
import { busyGroups } from "../src/utils/agendaBusy.js";

const TZ = "Europe/Amsterdam";
const cal = (...events) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Rooster Dorus", ...events.flat(), "END:VCALENDAR"].join("\r\n");
const vevent = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const parse = (text, window = { from: "2026-01-01", to: "2026-12-31" }) => parseIcs(text, { ...window, timeZone: TZ });

describe("parseIcs", () => {
    test("a simple timed item, folded lines and escaped text", () => {
        const { items, calendarName } = parse(
            cal(
                vevent([
                    "UID:les-1@zermelo",
                    "DTSTART;TZID=Europe/Amsterdam:20261104T133000",
                    "DTEND;TZID=Europe/Amsterdam:20261104T142000",
                    "SUMMARY:Wiskunde\\, blok B",
                    "LOCATION:Lokaal 2.14",
                    "DESCRIPTION:Neem je rekenmachine\\nmee",
                    "  en je boek",
                ])
            )
        );
        assert.equal(calendarName, "Rooster Dorus");
        assert.deepEqual(items, [
            {
                uid: "les-1@zermelo",
                title: "Wiskunde, blok B",
                location: "Lokaal 2.14",
                note: "Neem je rekenmachine\nmee en je boek",
                allDay: false,
                startDate: "2026-11-04",
                endDate: "2026-11-04",
                startTime: "13:30",
                endTime: "14:20",
            },
        ]);
    });

    test("UTC times become local time, across daylight saving", () => {
        const { items } = parse(
            cal(
                vevent(["UID:a", "DTSTART:20261104T123000Z", "DTEND:20261104T132000Z", "SUMMARY:Winter"]),
                vevent(["UID:b", "DTSTART:20260704T123000Z", "DTEND:20260704T132000Z", "SUMMARY:Zomer"])
            )
        );
        assert.deepEqual(items.map((e) => [e.title, e.startTime, e.endTime]), [
            ["Zomer", "14:30", "15:20"],
            ["Winter", "13:30", "14:20"],
        ]);
    });

    test("other time zones and Outlook zone names are converted", () => {
        const { items } = parse(
            cal(
                vevent(["UID:ny", "DTSTART;TZID=America/New_York:20261104T090000", "DURATION:PT1H", "SUMMARY:Call"]),
                vevent(["UID:ol", 'DTSTART;TZID="W. Europe Standard Time":20261105T100000', "DTEND;TZID=\"W. Europe Standard Time\":20261105T110000", "SUMMARY:Outlook"])
            )
        );
        assert.deepEqual(items.map((e) => [e.title, e.startTime, e.endTime]), [
            ["Call", "15:00", "16:00"],
            ["Outlook", "10:00", "11:00"],
        ]);
    });

    test("all-day items: DTEND is exclusive", () => {
        const { items } = parse(
            cal(
                vevent(["UID:d1", "DTSTART;VALUE=DATE:20261104", "DTEND;VALUE=DATE:20261105", "SUMMARY:Studiedag"]),
                vevent(["UID:d2", "DTSTART;VALUE=DATE:20261221", "DTEND;VALUE=DATE:20270104", "SUMMARY:Kerstvakantie"]),
                vevent(["UID:d3", "DTSTART;VALUE=DATE:20261110", "SUMMARY:Zonder einde"])
            )
        );
        const by = Object.fromEntries(items.map((e) => [e.title, [e.allDay, e.startDate, e.endDate, e.startTime]]));
        assert.deepEqual(by.Studiedag, [true, "2026-11-04", "2026-11-04", null]);
        assert.deepEqual(by.Kerstvakantie, [true, "2026-12-21", "2027-01-03", null]);
        assert.deepEqual(by["Zonder einde"], [true, "2026-11-10", "2026-11-10", null]);
    });

    test("ending at midnight stays on the same day", () => {
        const { items } = parse(cal(vevent(["UID:m", "DTSTART:20261104T220000", "DTEND:20261105T000000", "SUMMARY:Laat"])));
        assert.deepEqual([items[0].startDate, items[0].endDate, items[0].endTime], ["2026-11-04", "2026-11-04", "23:59"]);
    });

    test("weekly repeats with BYDAY, COUNT, EXDATE and a moved lesson", () => {
        const { items } = parse(
            cal(
                vevent([
                    "UID:series",
                    "DTSTART;TZID=Europe/Amsterdam:20261102T083000",
                    "DTEND;TZID=Europe/Amsterdam:20261102T092000",
                    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6",
                    "EXDATE;TZID=Europe/Amsterdam:20261104T083000",
                    "SUMMARY:Engels",
                ]),
                vevent([
                    "UID:series",
                    "RECURRENCE-ID;TZID=Europe/Amsterdam:20261109T083000",
                    "DTSTART;TZID=Europe/Amsterdam:20261109T100000",
                    "DTEND;TZID=Europe/Amsterdam:20261109T105000",
                    "SUMMARY:Engels (verplaatst)",
                ])
            )
        );
        assert.deepEqual(items.map((e) => `${e.startDate} ${e.startTime} ${e.title}`), [
            "2026-11-02 08:30 Engels",
            "2026-11-09 10:00 Engels (verplaatst)",
            "2026-11-11 08:30 Engels",
            "2026-11-16 08:30 Engels",
            "2026-11-18 08:30 Engels",
        ]);
        assert.equal(items[1].uid, "series#2026-11-09T08:30", "a moved lesson keeps its original key");
        assert.equal(new Set(items.map((e) => e.uid)).size, items.length);
    });

    test("weekly repeats keep local time across the DST change", () => {
        const { items } = parse(
            cal(vevent(["UID:w", "DTSTART;TZID=Europe/Amsterdam:20261019T083000", "DURATION:PT50M", "RRULE:FREQ=WEEKLY;UNTIL=20261102T235959Z", "SUMMARY:Les"]))
        );
        assert.deepEqual(items.map((e) => [e.startDate, e.startTime, e.endTime]), [
            ["2026-10-19", "08:30", "09:20"],
            ["2026-10-26", "08:30", "09:20"],
            ["2026-11-02", "08:30", "09:20"],
        ]);
    });

    test("endless repeats stop at the window; old series still reach it", () => {
        const { items } = parse(
            cal(vevent(["UID:old", "DTSTART;TZID=Europe/Amsterdam:20050103T090000", "DURATION:PT1H", "RRULE:FREQ=WEEKLY", "SUMMARY:Therapie"])),
            { from: "2026-11-01", to: "2026-11-30" }
        );
        assert.deepEqual(items.map((e) => e.startDate), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    });

    test("a daily series from long ago still reaches the window", () => {
        const { items } = parse(
            cal(vevent(["UID:old-daily", "DTSTART;TZID=Europe/Amsterdam:19700101T070000", "DURATION:PT30M", "RRULE:FREQ=DAILY", "SUMMARY:Medicijn"])),
            { from: "2026-11-01", to: "2026-11-03" }
        );
        assert.deepEqual(items.map((e) => [e.startDate, e.startTime]), [
            ["2026-11-01", "07:00"],
            ["2026-11-02", "07:00"],
            ["2026-11-03", "07:00"],
        ]);
        assert.equal(items[0].uid, "old-daily#2026-11-01T07:00", "keys stay the same as without the jump");
    });

        test("daily, monthly (nth weekday) and yearly repeats", () => {
        const window = { from: "2026-11-01", to: "2027-03-31" };
        const daily = parse(cal(vevent(["UID:d", "DTSTART:20261101T100000", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3", "SUMMARY:x"])), window);
        assert.deepEqual(daily.items.map((e) => e.startDate), ["2026-11-01", "2026-11-03", "2026-11-05"]);

        const monthly = parse(cal(vevent(["UID:m", "DTSTART:20261110T100000", "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=4", "SUMMARY:x"])), window);
        assert.deepEqual(monthly.items.map((e) => e.startDate), ["2026-11-10", "2026-12-08", "2027-01-12", "2027-02-09"]);

        const lastFriday = parse(cal(vevent(["UID:l", "DTSTART:20261127T100000", "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2", "SUMMARY:x"])), window);
        assert.deepEqual(lastFriday.items.map((e) => e.startDate), ["2026-11-27", "2026-12-25"]);

        const yearly = parse(cal(vevent(["UID:y", "DTSTART;VALUE=DATE:20250214", "RRULE:FREQ=YEARLY", "SUMMARY:Valentijn"])), { from: "2026-01-01", to: "2027-12-31" });
        assert.deepEqual(yearly.items.map((e) => e.startDate), ["2026-02-14", "2027-02-14"]);
    });

    test("cancelled items are skipped and counted", () => {
        const r = parse(cal(vevent(["UID:c", "DTSTART:20261104T100000", "STATUS:CANCELLED", "SUMMARY:Uitval"])));
        assert.equal(r.items.length, 0);
        assert.equal(r.cancelled, 1);
    });

    test("items outside the window are left out", () => {
        const r = parse(cal(vevent(["UID:old", "DTSTART:20200101T100000", "SUMMARY:Oud"])), { from: "2026-01-01", to: "2026-12-31" });
        assert.equal(r.items.length, 0);
    });

    test("items without a UID get a stable one", () => {
        const text = cal(vevent(["DTSTART:20261104T100000", "SUMMARY:Geen uid"]));
        assert.equal(parse(text).items[0].uid, parse(text).items[0].uid);
    });

    test("garbage does not throw", () => {
        assert.deepEqual(parse("hallo").items, []);
        assert.deepEqual(parse("").items, []);
        assert.deepEqual(parse(cal(vevent(["UID:x", "DTSTART:nope", "SUMMARY:x"]))).items, []);
    });

    test("unfold joins continuation lines", () => {
        assert.equal(unfold("A:1\r\n 2\r\n\t3\r\nB:4"), "A:123\nB:4");
    });

    test("guessKind", () => {
        assert.deepEqual(guessKind("Schoolvakanties regio midden"), { kind: "periode" });
        assert.deepEqual(guessKind("", "birthdays.ics"), { kind: "bijzonder", specialKind: "verjaardag" });
        assert.deepEqual(guessKind("Zermelo rooster"), {});
    });

    test("guessReason", () => {
        assert.equal(guessReason("Rooster Dorus"), "school");
        assert.equal(guessReason("", "zermelo-export.ics"), "school");
        assert.equal(guessReason("Afspraken GGZ"), "therapie");
        assert.equal(guessReason("Werkrooster"), "werk");
        assert.equal(guessReason("Diensten"), "werk");
        assert.equal(guessReason("Verjaardagen"), "");
    });
});

describe("busyGroups", () => {
    const busy = (id, startTime, endTime, extra = {}) => ({
        id, kind: "onbeschikbaar", reason: "school", forWho: "dorus",
        startDate: "2026-11-04", endDate: "2026-11-04", allDay: false, startTime, endTime, ...extra,
    });

    test("back-to-back lessons with short breaks become one line", () => {
        const groups = busyGroups(
            [busy("a", "13:30", "14:20"), busy("b", "14:30", "15:20"), busy("c", "15:40", "16:30"), busy("d", "17:20", "18:10")],
            "2026-11-04"
        );
        assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
            ["13:30–16:30", ["a", "b", "c"]],
            ["17:20–18:10", ["d"]],
        ]);
    });

    test("a different person or reason is its own line", () => {
        const groups = busyGroups(
            [busy("a", "09:00", "10:00"), busy("b", "10:00", "11:00", { forWho: "partner" }), busy("c", "10:00", "11:00", { reason: "therapie" })],
            "2026-11-04"
        );
        assert.equal(groups.length, 3);
    });

    test("all-day and multi-day items stay separate and come first", () => {
        const groups = busyGroups(
            [busy("t", "09:00", "10:00"), busy("w", null, null, { allDay: true, reason: "ziek" }), busy("m", "20:00", "08:00", { endDate: "2026-11-05" })],
            "2026-11-04"
        );
        assert.deepEqual(groups.map((g) => [g.key, g.label]), [
            ["w", "HELE DAG"],
            ["m", "VANAF 20:00"],
            ["t", "09:00–10:00"],
        ]);
    });
});
