// src/tui/agenda/AgendaSpecialRow.jsx
import { specialLabel, specialType } from "../../utils/agendaSpecial";
import { logoOf } from "../../utils/agendaStyle";
import StickerImage from "./StickerImage";

// One small line for a special day: ★ VERJAARDAG · SAM WORDT 21. A logo (either
// size) shows small in front; an own colour replaces the type's colour.
export default function AgendaSpecialRow({ occurrence, isToday, onOpen, stickersById = {} }) {
    const type = specialType(occurrence);
    const logo = logoOf(occurrence, stickersById, "klein") ?? logoOf(occurrence, stickersById, "groot");
    const label = specialLabel(occurrence);
    return (
        <button
            type="button"
            onClick={() => onOpen(occurrence.baseId)}
            aria-label={`${type.label}: ${label}`}
            className="flex flex-wrap gap-x-[1ch] w-full text-left uppercase cursor-pointer select-none transition-none hover:bg-[#141414] focus-visible:outline-none focus-visible:bg-[#262626]"
            style={{ color: occurrence.color || type.color }}
        >
            <span className="whitespace-nowrap">
                {logo && <StickerImage sticker={logo} size="klein" className="mr-[1ch]" />}
                <span className="cell">{type.glyph}</span> <span className="opacity-60">{type.label} ·</span>{" "}
                <span className="font-bold">{label}</span>
            </span>
            {isToday && <span className="bg-current px-[1ch]"><span className="text-black font-bold">VANDAAG!</span></span>}
        </button>
    );
}
