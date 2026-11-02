// test/agendaDates.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    addDays,
    addMonths,
    daysBetween,
    eventsOnDay,
    formatDayLong,
    formatDayShort,
    formatWhen,
    indexByDay,
    isoWeek,
    monthGrid,
    monthTitle,
    relativeDay,
    timeLabel,
    weekdayIndex,
} from "../src/utils/agendaDates.js";
import { itemState, stateGlyph, stateLabel } from "../src/utils/agendaStatus.js";
import { ROUTES, buildSitemap } from "../scripts/seo/lib.mjs";
import { HIDDEN_SECTION_KEYS } from "../src/utils/routing.js";
import { expandYearly, specialLabel, periodsOn } from "../src/utils/agendaSpecial.js";

const ev = (extra = {}) => ({
    id: "1",
    title: "Etentje",
    startDate: "2026-11-07",
    endDate: "2026-11-07",
    allDay: false,
    startTime: "18:00",
    endTime: "21:00",
    ...extra,
});

describe("agenda dates", () => {
    test("adding days crosses months, years and DST", () => {
        assert.equal(addDays("2026-10-31", 1), "2026-11-01");
        assert.equal(addDays("2026-12-31", 1), "2027-01-01");
        assert.equal(addDays("2026-03-29", 1), "2026-03-30");
        assert.equal(addDays("2026-10-25", 1), "2026-10-26");
        assert.equal(addDays("2026-03-01", -1), "2026-02-28");
        assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
    });

    test("months wrap around the year", () => {
        assert.deepEqual(addMonths({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
        assert.deepEqual(addMonths({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
    });

    test("weeks start on Monday and use ISO week numbers", () => {
        assert.equal(weekdayIndex("2026-11-02"), 0, "2 Nov 2026 is a Monday");
        assert.equal(weekdayIndex("2026-11-08"), 6);
        assert.equal(isoWeek("2026-11-02"), 45);
        assert.equal(isoWeek("2027-01-01"), 53, "1 Jan 2027 is in week 53 of 2026");
        assert.equal(isoWeek("2026-01-01"), 1);
    });

    test("the month grid covers whole weeks", () => {
        const grid = monthGrid({ year: 2026, month: 10 });
        assert.equal(grid[0].days[0], "2026-10-26");
        assert.equal(grid.at(-1).days[6], "2026-12-06");
        assert.ok(grid.every((w) => w.days.length === 7));
        assert.equal(grid[0].week, 44);
    });

    test("Dutch names", () => {
        assert.equal(monthTitle({ year: 2026, month: 10 }), "NOVEMBER 2026");
        assert.equal(formatDayShort("2026-11-07"), "za 7 nov");
        assert.equal(formatDayLong("2026-11-07"), "zaterdag 7 november 2026");
        assert.equal(relativeDay("2026-11-03", "2026-11-02"), "morgen");
        assert.equal(relativeDay("2026-11-02", "2026-11-02"), "vandaag");
        assert.equal(relativeDay("2026-11-01", "2026-11-02"), "gisteren");
        assert.equal(relativeDay("2026-11-09", "2026-11-02"), null);
    });

    test("when an item happens", () => {
        assert.equal(formatWhen(ev()), "zaterdag 7 november 2026, 18:00–21:00");
        assert.equal(formatWhen(ev({ endTime: null })), "zaterdag 7 november 2026, 18:00");
        assert.equal(formatWhen(ev({ allDay: true, startTime: null, endTime: null })), "zaterdag 7 november 2026, hele dag");
        assert.equal(
            formatWhen(ev({ allDay: true, endDate: "2026-11-09" })),
            "zaterdag 7 november 2026 t/m maandag 9 november 2026"
        );
    });

    test("time labels per day of a multi-day item", () => {
        const e = ev({ endDate: "2026-11-09", endTime: "10:00" });
        assert.equal(timeLabel(e, "2026-11-07"), "VANAF 18:00");
        assert.equal(timeLabel(e, "2026-11-08"), "HELE DAG");
        assert.equal(timeLabel(e, "2026-11-09"), "TOT 10:00");
        assert.equal(timeLabel(ev(), "2026-11-07"), "18:00–21:00");
    });

    test("items on a day: all-day first, then by time", () => {
        const items = [
            ev({ id: "late", title: "Laat", startTime: "20:00" }),
            ev({ id: "allday", title: "Feest", allDay: true, startTime: null }),
            ev({ id: "early", title: "Vroeg", startTime: "09:00" }),
            ev({ id: "other", startDate: "2026-11-08", endDate: "2026-11-08" }),
        ];
        assert.deepEqual(eventsOnDay(items, "2026-11-07").map((e) => e.id), ["allday", "early", "late"]);
    });

    test("items indexed per day, clipped to the range, in display order", () => {
        const items = [
            ev({ id: "trip", startDate: "2026-11-05", endDate: "2026-11-08", allDay: true }),
            ev({ id: "late", startDate: "2026-11-07", endDate: "2026-11-07", startTime: "20:00" }),
            ev({ id: "early", startDate: "2026-11-07", endDate: "2026-11-07", startTime: "09:00" }),
        ];
        const index = indexByDay(items, "2026-11-06", "2026-11-30");
        assert.deepEqual([...index.keys()].sort(), ["2026-11-06", "2026-11-07", "2026-11-08"]);
        assert.deepEqual(index.get("2026-11-07").map((e) => e.id), ["trip", "early", "late"]);
    });
});

describe("agenda seen / agreed state", () => {
    const ids = ["dorus", "partner"];
    const nameOf = (id) => ({ dorus: "DORUS", partner: "ALEX" })[id];
    const withStatus = (updatedBy, partner = {}, dorus = {}) => ({
        updatedBy,
        status: {
            dorus: { seenAt: null, response: null, ...dorus },
            partner: { seenAt: null, response: null, ...partner },
        },
    });

    test("my own item waits on the other person", () => {
        const s = itemState(withStatus("dorus"), "dorus", ids);
        assert.equal(s.byMe, true);
        assert.equal(s.waitingOn, "partner");
        assert.equal(s.needsMyAnswer, false);
        assert.equal(stateLabel(s, nameOf), "ALEX HEEFT HET NOG NIET GEZIEN");
        assert.equal(stateLabel(itemState(withStatus("dorus", { seenAt: "x" }), "dorus", ids), nameOf), "ALEX HEEFT HET GEZIEN");
        assert.equal(stateLabel(itemState(withStatus("dorus", { seenAt: "x", readAt: "y" }), "dorus", ids), nameOf), "ALEX HEEFT HET GELEZEN");
        assert.equal(stateLabel(itemState(withStatus("dorus", { response: "akkoord" }), "dorus", ids), nameOf), "ALEX IS AKKOORD");
        assert.equal(stateLabel(itemState(withStatus("dorus", { response: "niet" }), "dorus", ids), nameOf), "ALEX IS NIET AKKOORD");
    });

    test("steps: not seen, seen, read, answered", () => {
        const glyph = (partner) => stateGlyph(itemState(withStatus("dorus", partner), "dorus", ids));
        assert.equal(glyph({}), "○");
        assert.equal(glyph({ seenAt: "x" }), "◐");
        assert.equal(glyph({ seenAt: "x", readAt: "y" }), "◉");
        assert.equal(glyph({ readAt: "y" }), "◉", "read implies seen");
        assert.equal(glyph({ response: "akkoord" }), "✓", "answering implies read");
        assert.equal(itemState(withStatus("dorus", { readAt: "y" }), "dorus", ids).seen, true);
    });

        test("the other person's item needs my answer", () => {
        const s = itemState(withStatus("partner"), "dorus", ids);
        assert.equal(s.needsMyAnswer, true);
        assert.equal(stateLabel(s, nameOf), "WACHT OP JOUW ANTWOORD");
        const done = itemState(withStatus("partner", {}, { response: "akkoord" }), "dorus", ids);
        assert.equal(done.needsMyAnswer, false);
        assert.equal(stateLabel(done, nameOf), "JIJ BENT AKKOORD");
    });
});

describe("agenda stays private", () => {
    test("hidden sections are never prerendered or in the sitemap", () => {
        const sitemap = buildSitemap(ROUTES);
        for (const key of HIDDEN_SECTION_KEYS) {
            assert.ok(!ROUTES.some((r) => r.path.replace(/\//g, "") === key), key);
            assert.ok(!sitemap.includes(`/${key}`), key);
        }
    });
});

describe("special days and periods", () => {
    const bday = { id: "b", kind: "bijzonder", reason: "verjaardag", title: "Alex", startDate: "2005-03-14", endDate: "2005-03-14", repeat: "jaarlijks", countYears: true };

    test("yearly days get one occurrence per year from their first year", () => {
        const occ = expandYearly([bday], 2004, 2027);
        assert.deepEqual(occ.map((o) => [o.id, o.startDate, o.years]), [
            ["b@2005", "2005-03-14", 0],
            ...Array.from({ length: 22 }, (_, i) => [`b@${2006 + i}`, `${2006 + i}-03-14`, i + 1]),
        ]);
        assert.ok(occ.every((o) => o.baseId === "b"));
    });

    test("29 February falls on the 28th in other years", () => {
        const leap = { ...bday, startDate: "2024-02-29", endDate: "2024-02-29" };
        assert.deepEqual(expandYearly([leap], 2026, 2028).map((o) => o.startDate), ["2026-02-28", "2027-02-28", "2028-02-29"]);
    });

    test("other items pass through; one-off special days get a baseId", () => {
        const plain = { id: "p", kind: "afspraak", startDate: "2026-11-04" };
        const once = { ...bday, id: "o", repeat: "" };
        const out = expandYearly([plain, once], 2026, 2027);
        assert.equal(out[0], plain);
        assert.deepEqual([out[1].id, out[1].baseId, out[1].years], ["o", "o", null]);
    });

    test("labels count years when asked", () => {
        const [occ] = expandYearly([bday], 2026, 2026);
        assert.equal(specialLabel(occ), "ALEX WORDT 21");
        assert.equal(specialLabel({ ...occ, countYears: false }), "ALEX IS JARIG");
        const anniversary = { ...bday, reason: "jubileum", title: "samen", startDate: "2023-11-04", endDate: "2023-11-04" };
        assert.equal(specialLabel(expandYearly([anniversary], 2026, 2026)[0]), "3 JAAR SAMEN");
        assert.equal(specialLabel(expandYearly([anniversary], 2023, 2023)[0]), "SAMEN", "no '0 jaar' on the first day");
        assert.equal(specialLabel({ ...occ, reason: "anders", title: "Koningsdag", countYears: false }), "KONINGSDAG");
    });

    test("periods on a day, outer zone first", () => {
        const summer = { id: "z", startDate: "2027-07-17", endDate: "2027-08-29" };
        const camp = { id: "k", startDate: "2027-07-20", endDate: "2027-07-25" };
        assert.deepEqual(periodsOn([camp, summer], "2027-07-21").map((p) => p.id), ["z", "k"]);
        assert.deepEqual(periodsOn([camp, summer], "2027-09-01"), []);
    });

    test("only appointments wait for an answer", () => {
        for (const kind of ["onbeschikbaar", "bijzonder", "periode"]) {
            const e = { kind, updatedBy: "partner", status: { dorus: {}, partner: {} } };
            assert.equal(itemState(e, "dorus", ["dorus", "partner"]).needsMyAnswer, false, kind);
        }
        assert.equal(itemState({ kind: "afspraak", updatedBy: "partner", status: {} }, "dorus", ["dorus", "partner"]).needsMyAnswer, true);
    });
});
