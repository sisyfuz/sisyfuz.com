// src/tui/agenda/AgendaList.jsx
import { Fragment, useMemo } from "react";
import { formatDayShort, indexByDay, monthOf, monthTitle, relativeDay } from "../../utils/agendaDates";
import { isPeriod, periodsOn } from "../../utils/agendaSpecial";
import AgendaDayItems from "./AgendaDayItems";
import AgendaGutter from "./AgendaGutter";
import { PeriodBanner, PeriodEnd } from "./AgendaPeriod";
import { BTN_PLAIN } from "./ui";

// Scrolling day-by-day list: only days with items, plus today, with a header per
// month. Periods (zomervakantie...) are zones: a banner on their first day, a
// colored edge along the days inside, and an end line on their last day.
export default function AgendaList({ events, from, to, today, onEarlier, onLater, loading, itemProps }) {
    const periods = useMemo(() => events.filter(isPeriod), [events]);
    const byDay = useMemo(() => indexByDay(events.filter((e) => !isPeriod(e)), from, to), [events, from, to]);
    const days = useMemo(() => {
        const marks = [today];
        for (const p of periods) marks.push(p.startDate < from ? from : p.startDate, p.endDate);
        return [...new Set([...byDay.keys(), ...marks.filter((d) => d >= from && d <= to)])].sort();
    }, [byDay, periods, today, from, to]);
    const people = itemProps.people;

    return (
        <div className="space-y-[1lh]">
            <button type="button" onClick={onEarlier} disabled={loading} className={`${BTN_PLAIN} -ml-[1ch]`}>
                [↑ EERDER]
            </button>

            {days.map((day, i) => {
                const month = monthTitle(monthOf(day));
                const showMonth = i === 0 || day.slice(0, 7) !== days[i - 1].slice(0, 7);
                const rel = relativeDay(day, today);
                const isToday = day === today;
                const zones = periodsOn(periods, day);
                const starting = zones.filter((p) => p.startDate === day || (i === 0 && p.startDate < day));
                const ongoing = zones.filter((p) => !starting.includes(p));
                const ending = zones.filter((p) => p.endDate === day);
                const edge = zones[0] ? people.colorOf(zones[0].forWho) : null;

                return (
                    <Fragment key={day}>
                        {showMonth && (
                            <div aria-hidden="true" className="flex items-center gap-x-[1ch] text-neutral-500 overflow-hidden whitespace-nowrap pt-[1lh]">
                                <span>--</span>
                                <span className="text-neutral-300 font-bold">{month}</span>
                                <span className="flex-1 overflow-hidden">{"-".repeat(80)}</span>
                            </div>
                        )}
                        {starting.map((p) => (
                            <PeriodBanner key={p.id} period={p} people={people} continued={p.startDate < day} onOpen={itemProps.onOpen} />
                        ))}
                        <section
                            aria-label={`${rel ? `${rel}, ` : ""}${formatDayShort(day)}${zones.length ? `, ${zones.map((p) => p.title).join(", ")}` : ""}`}
                            className="flex gap-x-[1ch]"
                        >
                            {edge && <AgendaGutter color={edge} glyph="░" />}
                            <div className="min-w-0 flex-1 space-y-[1lh]">
                                <h3 className={`uppercase font-bold ${day < today ? "text-neutral-500" : "text-white"}`}>
                                    {isToday ? (
                                        <span className="bg-[#e8e8e8] text-black px-[1ch] -ml-[1ch]">
                                            <span className="cell">▶</span> {rel}
                                        </span>
                                    ) : (
                                        rel
                                    )}
                                    {rel ? " · " : ""}
                                    {formatDayShort(day)}
                                    {ongoing.map((p) => (
                                        <span key={p.id} className="font-normal" style={{ color: people.colorOf(p.forWho) }}>
                                            {" "}· ░ {p.title}
                                        </span>
                                    ))}
                                </h3>
                                <AgendaDayItems items={byDay.get(day) ?? []} day={day} today={today} itemProps={itemProps} />
                            </div>
                        </section>
                        {ending.map((p) => (
                            <PeriodEnd key={p.id} period={p} people={people} />
                        ))}
                    </Fragment>
                );
            })}

            {days.length <= 1 && events.length === 0 && (
                <p className="text-neutral-400">Nog niks gepland. Tik op [+ NIEUW] om iets toe te voegen.</p>
            )}

            <button type="button" onClick={onLater} disabled={loading} className={`${BTN_PLAIN} -ml-[1ch]`}>
                [↓ LATER]
            </button>
        </div>
    );
}
