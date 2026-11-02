// src/tui/agenda/AgendaSpecialRow.jsx
import { specialLabel, specialType } from "../../utils/agendaSpecial";

// One small line for a special day: ★ VERJAARDAG · SAM WORDT 21.
export default function AgendaSpecialRow({ occurrence, isToday, onOpen }) {
    const type = specialType(occurrence);
    const label = specialLabel(occurrence);
    return (
        <button
            type="button"
            onClick={() => onOpen(occurrence.baseId)}
            aria-label={`${type.label}: ${label}`}
            className="flex flex-wrap items-center gap-x-[1ch] w-full min-h-[2lh] text-left uppercase cursor-pointer select-none transition-none hover:bg-[#141414]"
            style={{ color: type.color }}
        >
            <span className="whitespace-nowrap">
                <span className="cell">{type.glyph}</span> <span className="opacity-60">{type.label} ·</span>{" "}
                <span className="font-bold">{label}</span>
            </span>
            {isToday && <span className="bg-current px-[1ch]"><span className="text-black font-bold">VANDAAG!</span></span>}
        </button>
    );
}
