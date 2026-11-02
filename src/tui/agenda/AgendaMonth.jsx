// src/tui/agenda/AgendaMonth.jsx
import { useMemo, useRef } from "react";
import { WEEKDAYS_SHORT, formatDayLong, formatDayShort, indexByDay, monthGrid, monthTitle, relativeDay } from "../../utils/agendaDates";
import { itemState } from "../../utils/agendaStatus";
import { isBusy } from "../../utils/agendaBusy";
import { isAppointment, isPeriod, isSpecial, periodsOn, specialType, tint } from "../../utils/agendaSpecial";
import AgendaDayItems from "./AgendaDayItems";
import { BTN_PRIMARY, BTN_PLAIN } from "./ui";

const SWIPE_MIN_PX = 50;

// Month grid (Monday first, ISO week numbers) with the selected day's items below.
// Periods tint their days with a colored bar along the bottom, so a holiday reads
// as one zone across the weeks; a legend below names them. Swipe to change month.
export default function AgendaMonth({ events, ym, selected, today, onSelect, onMonth, onToday, onNew, itemProps }) {
    const touch = useRef(null);
    const weeks = monthGrid(ym);
    const { people } = itemProps;
    const rel = relativeDay(selected, today);
    const gridFrom = weeks[0].days[0];
    const gridTo = weeks[weeks.length - 1].days[6];
    const periods = useMemo(() => events.filter(isPeriod), [events]);
    // The selected day can lie outside the grid (it stays when the month changes).
    const indexFrom = selected < gridFrom ? selected : gridFrom;
    const indexTo = selected > gridTo ? selected : gridTo;
    const byDay = useMemo(() => indexByDay(events.filter((e) => !isPeriod(e)), indexFrom, indexTo), [events, indexFrom, indexTo]);
    const visiblePeriods = periods
        .filter((p) => p.startDate <= gridTo && p.endDate >= gridFrom)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const selectedZones = periodsOn(periods, selected);

    const onTouchStart = (e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) onMonth(dx < 0 ? 1 : -1);
    };

    return (
        <div className="space-y-[1lh]">
            <div className="flex items-center justify-between">
                <button type="button" onClick={() => onMonth(-1)} className={`${BTN_PLAIN} -ml-[1ch]`} aria-label="Vorige maand">
                    [&lt;]
                </button>
                <h2 className="font-bold text-white uppercase text-center" aria-live="polite">{monthTitle(ym)}</h2>
                <button type="button" onClick={() => onMonth(1)} className={`${BTN_PLAIN} -mr-[1ch]`} aria-label="Volgende maand">
                    [&gt;]
                </button>
            </div>

            <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="touch-pan-y">
                <div role="grid" aria-label={monthTitle(ym)} className="grid grid-cols-[3ch_repeat(7,minmax(0,1fr))]">
                    <div role="row" className="contents">
                        <span role="columnheader" className="text-neutral-600" title="Weeknummer">WK</span>
                        {WEEKDAYS_SHORT.map((d) => (
                            <span key={d} role="columnheader" className="text-neutral-500 text-center">{d}</span>
                        ))}
                    </div>
                    {weeks.map(({ week, days }) => (
                        <div role="row" key={days[0]} className="contents">
                            <span role="rowheader" className="text-neutral-600 h-[3lh] border-t border-[#1a1a1a]">{week}</span>
                            {days.map((day) => {
                                const items = byDay.get(day) ?? [];
                                const zone = periodsOn(periods, day)[0];
                                const zoneColor = zone ? people.colorOf(zone.forWho) : null;
                                const specials = [...new Map(items.filter(isSpecial).map((e) => [e.reason, specialType(e)])).values()].slice(0, 2);
                                const inMonth = Number(day.slice(5, 7)) - 1 === ym.month;
                                const isSelected = day === selected;
                                const isToday = day === today;
                                const colors = [...new Set(items.filter(isAppointment).map((e) => people.colorOf(e.forWho)))].slice(0, 3 - specials.length);
                                const busyColors = [...new Set(items.filter(isBusy).map((e) => people.colorOf(e.forWho)))].slice(0, Math.max(0, 3 - specials.length - colors.length));
                                const needsAnswer = items.some((e) => itemState(e, people.me, people.ids).needsMyAnswer);
                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        role="gridcell"
                                        aria-selected={isSelected}
                                        aria-current={isToday ? "date" : undefined}
                                        aria-label={`${formatDayLong(day)}${zone ? `, ${zone.title}` : ""}${items.length ? `, ${items.length} ${items.length === 1 ? "item" : "items"}` : ""}${needsAnswer ? ", wacht op jouw antwoord" : ""}`}
                                        onClick={() => onSelect(day)}
                                        style={zoneColor && !isSelected ? { backgroundColor: tint(zoneColor, 0.16), boxShadow: `inset 0 -3px 0 ${zoneColor}` } : undefined}
                                        className={`h-[3lh] flex flex-col items-center justify-start cursor-pointer transition-none border-t border-[#1a1a1a] ${
                                            isSelected
                                                ? "bg-white text-black font-bold"
                                                : isToday
                                                ? "text-white font-bold underline underline-offset-4 hover:bg-[#141414]"
                                                : inMonth
                                                ? "text-neutral-200 hover:bg-[#141414]"
                                                : "text-neutral-700 hover:bg-[#141414]"
                                        }`}
                                    >
                                        <span>{isToday && !isSelected ? `[${Number(day.slice(8))}]` : Number(day.slice(8))}</span>
                                        <span aria-hidden="true" className="flex">
                                            {specials.map((t) => (
                                                <span key={t.glyph} className="cell" style={{ color: isSelected ? "#000" : t.color }}>{t.glyph}</span>
                                            ))}
                                            {colors.map((c) => (
                                                <span key={c} className="cell" style={{ color: isSelected ? "#000" : c }}>●</span>
                                            ))}
                                            {busyColors.map((c) => (
                                                <span key={`b${c}`} className="cell" style={{ color: isSelected ? "#000" : c, opacity: isSelected ? 1 : 0.6 }}>░</span>
                                            ))}
                                            {needsAnswer && <span className={`cell ${isSelected ? "" : "text-[#f7e463]"}`}>?</span>}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {visiblePeriods.length > 0 && (
                <ul aria-label="Periodes" className="uppercase">
                    {visiblePeriods.map((p) => {
                        const color = people.colorOf(p.forWho);
                        return (
                            <li key={p.id}>
                                <button
                                    type="button"
                                    onClick={() => itemProps.onOpen(p.id)}
                                    className="flex items-center gap-x-[1ch] w-full min-h-[2lh] text-left uppercase cursor-pointer transition-none hover:brightness-125"
                                >
                                    <span aria-hidden="true" className="w-[3ch] h-[1lh] shrink-0" style={{ backgroundColor: tint(color, 0.16), boxShadow: `inset 0 -3px 0 ${color}` }} />
                                    <span className="font-bold shrink-0" style={{ color }}>{p.title}</span>
                                    <span className="text-neutral-500 truncate">{formatDayShort(p.startDate)} – {formatDayShort(p.endDate)}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className="flex flex-wrap items-center gap-x-[1ch] -ml-[1ch]">
                {selected !== today && (
                    <button type="button" onClick={onToday} className={BTN_PLAIN}>[VANDAAG]</button>
                )}
                <button type="button" onClick={() => onNew(selected)} className={BTN_PRIMARY}>[+ OP DEZE DAG]</button>
            </div>

            <section aria-label={formatDayLong(selected)} className="space-y-[1lh]">
                <h3 className="uppercase font-bold text-white">
                    {rel ? `${rel} · ` : ""}
                    {formatDayLong(selected)}
                </h3>
                {selectedZones.map((p) => (
                    <p key={p.id} className="uppercase" style={{ color: people.colorOf(p.forWho) }}>
                        ░ {p.title} <span className="text-neutral-500">t/m {formatDayShort(p.endDate)}</span>
                    </p>
                ))}
                <AgendaDayItems items={byDay.get(selected) ?? []} day={selected} today={today} itemProps={itemProps} />
            </section>
        </div>
    );
}
