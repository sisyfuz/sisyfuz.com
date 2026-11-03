// src/tui/agenda/AgendaBusyRow.jsx
import { logoOf } from "../../utils/agendaStyle";
import StickerImage from "./StickerImage";

// One compact line for busy time, e.g. [ONBESCHIKBAAR · SCHOOL · DORUS] 13:30–18:10.
// `group` comes from busyGroups(); tapping opens the block (or its lessons). The
// first block's own colour and small logo stand for the line.
export default function AgendaBusyRow({ group, people, stickersById = {}, onOpen }) {
    const color = people.colorOf(group.forWho);
    const first = group.items[0];
    const logo = first ? logoOf(first, stickersById, "klein") ?? logoOf(first, stickersById, "groot") : null;
    const count = group.items.length;
    return (
        <button
            type="button"
            onClick={() => onOpen(group)}
            aria-label={`Onbeschikbaar: ${group.reason}, ${people.nameOf(group.forWho)}, ${group.label}${count > 1 ? `, ${count} blokken` : ""}`}
            className="flex flex-wrap gap-x-[1ch] w-full text-left uppercase cursor-pointer select-none transition-none hover:bg-[#141414] focus-visible:outline-none focus-visible:bg-[#262626]"
        >
            <span className="whitespace-nowrap">
                {logo && <StickerImage sticker={logo} size="klein" className="mr-[1ch]" />}
                <span className="text-neutral-600">[</span>
                <span className="text-neutral-500">ONBESCHIKBAAR</span>
                <span className="text-neutral-700"> · </span>
                <span style={{ color: first?.color || color }}>{group.reason}</span>
                <span className="text-neutral-700"> · </span>
                <span className="font-bold" style={{ color }}>{people.nameOf(group.forWho)}</span>
                <span className="text-neutral-600">]</span>
            </span>
            <span className="text-neutral-400 whitespace-nowrap">
                {group.label}
                {count > 1 && <span className="text-neutral-700"> ×{count}</span>}
            </span>
        </button>
    );
}
