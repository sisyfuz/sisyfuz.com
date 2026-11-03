// test/agendaRepeat.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    checkRule,
    countBefore,
    editBody,
    expandRepeats,
    firstOccurrence,
    moveDays,
    occurrenceDates,
    occurrenceOf,
    patternOf,
    repeatText,
    ruleFrom,
    seriesEnd,
} from "../src/utils/agendaRepeat.js";

const series = (rule, extra = {}) => ({
    id: "s1",
    title: "Zwemmen",
    startDate: "2026-11-02", // a Monday
    endDate: "2026-11-02",
    rule,
    exceptions: [],
    placements: [],
    ...extra,
});

describe("occurrenceDates", () => {
    test("every day, inside the range only", () => {
        assert.deepEqual(occurrenceDates("2026-11-02", { freq: "dag", interval: 1 }, "2026-11-05", "2026-11-07"), [
            "2026-11-05",
            "2026-11-06",
            "2026-11-07",
        ]);
    });

    test("nothing before the series starts", () => {
        assert.deepEqual(occurrenceDates("2026-11-02", { freq: "dag", interval: 1 }, "2026-10-30", "2026-11-03"), ["2026-11-02", "2026-11-03"]);
    });

    test("weekly on the ticked weekdays", () => {
        const rule = { freq: "week", interval: 1, days: [0, 2] }; // ma, wo
        assert.deepEqual(occurrenceDates("2026-11-02", rule, "2026-11-01", "2026-11-15"), ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"]);
    });

    test("weekly skips ticked days before its own start date", () => {
        const rule = { freq: "week", interval: 1, days: [0, 4] }; // ma, vr; starts on a Wednesday
        assert.deepEqual(occurrenceDates("2026-11-04", rule, "2026-11-01", "2026-11-10"), ["2026-11-06", "2026-11-09"]);
    });

    test("every 2 weeks counts weeks from the start week", () => {
        const rule = { freq: "week", interval: 2, days: [0] };
        assert.deepEqual(occurrenceDates("2026-11-02", rule, "2026-11-01", "2026-12-01"), ["2026-11-02", "2026-11-16", "2026-11-30"]);
        // Starting the range far later still lands on the same weeks.
        assert.deepEqual(occurrenceDates("2026-11-02", rule, "2027-06-01", "2027-06-30"), ["2027-06-14", "2027-06-28"]);
    });

    test("monthly on the 31st falls on the last day of short months", () => {
        const rule = { freq: "maand", interval: 1 };
        assert.deepEqual(occurrenceDates("2026-01-31", rule, "2026-01-01", "2026-05-31"), [
            "2026-01-31",
            "2026-02-28",
            "2026-03-31",
            "2026-04-30",
            "2026-05-31",
        ]);
        assert.deepEqual(occurrenceDates("2027-12-31", rule, "2028-02-01", "2028-02-29"), ["2028-02-29"]);
    });

    test("monthly far ahead lands on the right month", () => {
        assert.deepEqual(occurrenceDates("2026-11-15", { freq: "maand", interval: 1 }, "2030-03-01", "2030-04-30"), ["2030-03-15", "2030-04-15"]);
    });

    test("yearly on 29 February falls on the 28th in other years", () => {
        assert.deepEqual(occurrenceDates("2024-02-29", { freq: "jaar", interval: 1 }, "2024-01-01", "2028-12-31"), [
            "2024-02-29",
            "2025-02-28",
            "2026-02-28",
            "2027-02-28",
            "2028-02-29",
        ]);
    });

    test("until is the last day an occurrence may start", () => {
        const rule = { freq: "dag", interval: 1, until: "2026-11-04" };
        assert.deepEqual(occurrenceDates("2026-11-02", rule, "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-03", "2026-11-04"]);
    });

    test("count counts from the first occurrence, also for a later range", () => {
        const rule = { freq: "week", interval: 1, days: [0, 2], count: 5 };
        assert.deepEqual(occurrenceDates("2026-11-02", rule, "2026-11-10", "2026-12-31"), ["2026-11-11", "2026-11-16"]);
    });

    test("summer time does not shift anything", () => {
        // The Netherlands changes clocks on 29 March and 25 October 2026.
        assert.deepEqual(occurrenceDates("2026-03-28", { freq: "dag", interval: 1 }, "2026-03-28", "2026-03-30"), [
            "2026-03-28",
            "2026-03-29",
            "2026-03-30",
        ]);
        const weekly = { freq: "week", interval: 1, days: [6] };
        assert.deepEqual(occurrenceDates("2026-10-18", weekly, "2026-10-18", "2026-11-01"), ["2026-10-18", "2026-10-25", "2026-11-01"]);
    });
});

describe("expandRepeats", () => {
    test("leaves items without a rule alone", () => {
        const plain = { id: "p", startDate: "2026-11-03", endDate: "2026-11-03", rule: null };
        assert.deepEqual(expandRepeats([plain], "2026-11-01", "2026-11-30"), [plain]);
    });

    test("occurrences keep the id, get their own days, key and stickers", () => {
        const placements = [
            { id: "a", occurrenceDate: "2026-11-09" },
            { id: "b", occurrenceDate: "2026-11-16" },
        ];
        const out = expandRepeats([series({ freq: "week", interval: 1, days: [0] }, { placements })], "2026-11-08", "2026-11-17");
        assert.deepEqual(
            out.map((o) => [o.id, o.key, o.startDate, o.occurrenceDate, o.placements.map((p) => p.id)]),
            [
                ["s1", "s1@2026-11-09", "2026-11-09", "2026-11-09", ["a"]],
                ["s1", "s1@2026-11-16", "2026-11-16", "2026-11-16", ["b"]],
            ]
        );
        assert.equal(out[0].seriesStart, "2026-11-02");
    });

    test("skipped and moved dates are left out", () => {
        const exceptions = [
            { date: "2026-11-03", kind: "skip", movedToId: null },
            { date: "2026-11-05", kind: "moved", movedToId: "x" },
        ];
        const out = expandRepeats([series({ freq: "dag", interval: 1 }, { exceptions })], "2026-11-02", "2026-11-06");
        assert.deepEqual(out.map((o) => o.startDate), ["2026-11-02", "2026-11-04", "2026-11-06"]);
    });

    test("a multi-day occurrence that started before the range is included", () => {
        const weekend = series({ freq: "week", interval: 1, days: [5] }, { startDate: "2026-11-07", endDate: "2026-11-08" });
        const out = expandRepeats([weekend], "2026-11-15", "2026-11-15");
        assert.deepEqual(out.map((o) => [o.startDate, o.endDate]), [["2026-11-14", "2026-11-15"]]);
    });

    test("occurrenceOf passes a plain item through", () => {
        const plain = { id: "p", startDate: "2026-11-03", endDate: "2026-11-03" };
        assert.equal(occurrenceOf(plain, "2026-11-10"), plain);
    });
});

describe("series ends", () => {
    test("endless, until and count", () => {
        assert.equal(seriesEnd(series({ freq: "dag", interval: 1 })), null);
        assert.equal(seriesEnd(series({ freq: "dag", interval: 1, until: "2026-12-01" })), "2026-12-01");
        assert.equal(seriesEnd(series({ freq: "week", interval: 2, days: [0], count: 3 })), "2026-11-30");
        // A two-day occurrence ends a day after it starts.
        const weekend = series({ freq: "week", interval: 1, days: [5], count: 2 }, { startDate: "2026-11-07", endDate: "2026-11-08" });
        assert.equal(seriesEnd(weekend), "2026-11-15");
        assert.equal(seriesEnd({ startDate: "2026-11-02", endDate: "2026-11-04", rule: null }), "2026-11-04");
    });

    test("first occurrence and how many come before a date", () => {
        const rule = { freq: "week", interval: 1, days: [4] };
        assert.equal(firstOccurrence(series(rule)), "2026-11-06");
        assert.equal(countBefore(series(rule), "2026-11-20"), 2);
        assert.equal(countBefore(series(rule), "2026-11-06"), 0);
    });
});

describe("checkRule", () => {
    test("no rule", () => {
        assert.deepEqual(checkRule(null, "2026-11-02"), { value: null });
        assert.deepEqual(checkRule(undefined, "2026-11-02"), { value: null });
    });

    test("cleans weekdays and defaults them to the start date's own", () => {
        assert.deepEqual(checkRule({ freq: "week", days: [4, 0, 4] }, "2026-11-02").value, { freq: "week", interval: 1, days: [0, 4] });
        assert.deepEqual(checkRule({ freq: "week" }, "2026-11-04").value, { freq: "week", interval: 1, days: [2] });
        assert.deepEqual(checkRule({ freq: "dag", days: [1] }, "2026-11-02").value, { freq: "dag", interval: 1 });
    });

    test("refuses bad rules", () => {
        for (const bad of [
            "elke week",
            { freq: "uur" },
            { freq: "dag", interval: 0 },
            { freq: "dag", interval: 1.5 },
            { freq: "week", days: [] },
            { freq: "week", days: [7] },
            { freq: "dag", until: "2026-11-01" },
            { freq: "dag", until: "2026-02-30" },
            { freq: "dag", count: 0 },
            { freq: "dag", count: 1000 },
            { freq: "dag", until: "2026-12-01", count: 3 },
        ]) {
            assert.ok(checkRule(bad, "2026-11-02").error, JSON.stringify(bad));
        }
    });

    test("an occurrence may not run into the next one", () => {
        assert.ok(checkRule({ freq: "dag" }, "2026-11-02", "2026-11-03").error);
        assert.ok(checkRule({ freq: "week", days: [0, 1] }, "2026-11-02", "2026-11-03").error);
        assert.ok(!checkRule({ freq: "week", days: [0, 2] }, "2026-11-02", "2026-11-03").error);
        assert.ok(!checkRule({ freq: "week", days: [5] }, "2026-11-07", "2026-11-13").error);
        assert.ok(checkRule({ freq: "week", days: [5] }, "2026-11-07", "2026-11-14").error);
    });
});

describe("form helpers", () => {
    test("patterns round-trip through rules", () => {
        assert.equal(patternOf(null), "niet");
        assert.equal(patternOf({ freq: "week", interval: 2, days: [0] }), "2weken");
        assert.equal(ruleFrom("niet", [], { end: "nooit" }), null);
        assert.deepEqual(ruleFrom("2weken", [3, 1], { end: "keer", count: 6 }), { freq: "week", interval: 2, days: [1, 3], count: 6 });
        assert.deepEqual(ruleFrom("maand", [0], { end: "datum", until: "2027-01-01" }), { freq: "maand", interval: 1, until: "2027-01-01" });
    });

    test("moving the date moves its own weekday tick along", () => {
        assert.deepEqual(moveDays([0, 3], "2026-11-02", "2026-11-03"), [1, 3]);
        assert.deepEqual(moveDays([3], "2026-11-02", "2026-11-03"), [3]);
    });

    test("edit bodies per scope", () => {
        const s = series({ freq: "week", interval: 1, days: [0] });
        const form = { title: "Zwemmen", startDate: "2026-11-17", endDate: "2026-11-17", rule: { freq: "week", interval: 1, days: [1] } };
        // The occurrence of 16 Nov moved a day: the whole series moves a day.
        assert.deepEqual(editBody(s, "2026-11-16", form, "alle"), { ...form, startDate: "2026-11-03", endDate: "2026-11-03", scope: "alle" });
        assert.deepEqual(editBody(s, "2026-11-16", form, "deze"), { ...form, rule: null, scope: "deze", occurrenceDate: "2026-11-16" });
        assert.deepEqual(editBody(s, "2026-11-16", form, "volgende"), { ...form, scope: "volgende", occurrenceDate: "2026-11-16" });
    });

    test("in words", () => {
        assert.equal(repeatText({ freq: "week", interval: 1, days: [0, 2, 4] }, "2026-11-02"), "elke week op ma, wo en vr");
        assert.equal(repeatText({ freq: "week", interval: 2, days: [0], count: 4 }, "2026-11-02"), "elke 2 weken op ma · 4 keer");
        assert.equal(repeatText({ freq: "maand", interval: 1 }, "2026-01-31"), "elke maand op de 31e (of de laatste dag)");
        assert.equal(repeatText({ freq: "jaar", interval: 1, until: "2030-12-01" }, "2026-11-02"), "elk jaar op 2 november · tot en met zondag 1 december 2030");
        assert.equal(repeatText({ freq: "dag", interval: 1 }, "2026-11-02"), "elke dag");
    });
});
