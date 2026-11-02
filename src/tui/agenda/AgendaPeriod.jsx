// src/tui/agenda/AgendaPeriod.jsx
import { daysBetween, formatDayShort } from "../../utils/agendaDates";
import { tint } from "../../utils/agendaSpecial";

/** Start of a zone in the list: a tinted two-line banner. */
export function PeriodBanner({ period, people, continued, onOpen }) {
    const color = people.colorOf(period.forWho);
    const days = daysBetween(period.startDate, period.endDate) + 1;
    return (
        <button
            type="button"
            onClick={() => onOpen(period.id)}
            className="block w-full text-left uppercase cursor-pointer transition-none hover:brightness-125"
            style={{ backgroundColor: tint(color, 0.18) }}
        >
            <span className="flex items-center gap-x-[1ch] overflow-hidden whitespace-nowrap font-bold" style={{ color }}>
                <span aria-hidden="true">░░</span>
                <span className="shrink-0">{period.title}</span>
                {continued && <span className="shrink-0 font-normal opacity-70">(LOOPT AL)</span>}
                <span aria-hidden="true" className="flex-1 overflow-hidden">{"░".repeat(80)}</span>
            </span>
            <span className="block text-neutral-300 pl-[3ch]">
                {formatDayShort(period.startDate)} t/m {formatDayShort(period.endDate)} · {days} {days === 1 ? "dag" : "dagen"} ·{" "}
                <span style={{ color }}>{people.nameOf(period.forWho)}</span>
            </span>
        </button>
    );
}

/** End of a zone in the list. */
export function PeriodEnd({ period, people }) {
    const color = people.colorOf(period.forWho);
    return (
        <p className="uppercase whitespace-nowrap overflow-hidden" style={{ color }}>
            <span aria-hidden="true" className="opacity-60">└──</span> EINDE {period.title}
        </p>
    );
}
