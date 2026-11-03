// src/tui/agenda/AgendaBusySheet.jsx
import { formatDayLong, timeLabel } from "../../utils/agendaDates";
import AgendaSheet from "./AgendaSheet";

// The blocks behind one merged busy line (e.g. the lessons of a school day).
export default function AgendaBusySheet({ group, day, people, onClose, onOpen }) {
    const color = people.colorOf(group.forWho);
    return (
        <AgendaSheet title={`ONBESCHIKBAAR · ${group.reason}`} onClose={onClose}>
            <p className="uppercase">
                <span className="font-bold" style={{ color }}>{people.nameOf(group.forWho)}</span>
                <span className="text-neutral-500"> · {formatDayLong(day)} · {group.label}</span>
            </p>
            <ul className="mt-[1lh]">
                {group.items.map((e) => (
                    <li key={e.key ?? e.id}>
                        <button
                            type="button"
                            onClick={() => onOpen(e.id, e.occurrenceDate ?? null)}
                            className="flex gap-x-[2ch] w-full min-h-[3lh] items-center text-left cursor-pointer transition-none hover:bg-[#141414] focus-visible:outline-none focus-visible:bg-[#262626]"
                        >
                            <span className="text-neutral-400 shrink-0">{timeLabel(e, day)}</span>
                            <span className="text-white min-w-0 truncate">{e.title}</span>
                            {e.location && <span className="text-neutral-500 min-w-0 truncate">@ {e.location}</span>}
                        </button>
                    </li>
                ))}
            </ul>
        </AgendaSheet>
    );
}
