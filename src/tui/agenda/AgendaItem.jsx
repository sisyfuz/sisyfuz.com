// src/tui/agenda/AgendaItem.jsx
import { useEffect, useRef } from "react";
import { timeLabel } from "../../utils/agendaDates";
import { itemState, stateGlyph, stateLabel, stateTone } from "../../utils/agendaStatus";
import AgendaGutter from "./AgendaGutter";
import { BTN_GREEN, BTN_RED } from "./ui";

// Hovering this long with a mouse, or pressing and holding this long on a touch
// screen, counts as having read the item. Scrolling cancels a hold (pointercancel).
const HOVER_READ_MS = 1500;
const HOLD_READ_MS = 600;

// One item on one day. Tapping the card opens it; when the other person made
// the last change, the answer buttons sit right on the card.
export default function AgendaItem({ event, day, people, newIds, trackSeen, onRead, onOpen, onRespond, busy }) {
    const isNew = newIds.has(event.id);
    const state = itemState(event, people.me, people.ids);
    const forColor = people.colorOf(event.forWho);
    const unseenByMe = event.updatedBy !== people.me && !event.status?.[people.me]?.seenAt;
    const unreadByMe = event.updatedBy !== people.me && !event.status?.[people.me]?.readAt;
    const dwell = useRef(null);

    const stopDwell = () => {
        clearTimeout(dwell.current);
        dwell.current = null;
    };
    const startDwell = (ms) => {
        if (!unreadByMe || dwell.current) return;
        dwell.current = setTimeout(() => {
            dwell.current = null;
            if (document.visibilityState === "visible") onRead(event.id);
        }, ms);
    };
    useEffect(() => stopDwell, []);

    return (
        <article
            data-seen-id={event.id}
            ref={unseenByMe ? trackSeen : undefined}
            className="flex gap-x-[1ch]"
            style={{ WebkitTouchCallout: "none" }}
            onPointerEnter={(e) => e.pointerType !== "touch" && startDwell(HOVER_READ_MS)}
            onPointerLeave={stopDwell}
            onPointerDown={(e) => e.pointerType === "touch" && startDwell(HOLD_READ_MS)}
            onPointerUp={(e) => e.pointerType === "touch" && stopDwell()}
            onPointerCancel={stopDwell}
        >
            <AgendaGutter color={forColor} />
            <div className="min-w-0 flex-1">
                <button
                    type="button"
                    onClick={() => onOpen(event.id)}
                    className="block w-full text-left cursor-pointer select-none hover:bg-[#141414] transition-none focus-visible:outline-none focus-visible:bg-[#262626]"
                >
                    <span className="flex flex-wrap items-baseline gap-x-[2ch]">
                        <span className="text-neutral-400 uppercase">{timeLabel(event, day)}</span>
                        <span className="uppercase font-bold" style={{ color: forColor }}>
                            <span className="cell">●</span> {people.nameOf(event.forWho)}
                        </span>
                        {isNew && <span className="bg-[#f7e463] text-black font-bold px-[1ch]">NIEUW</span>}
                    </span>
                    <span className="block text-white font-bold break-words">{event.title}</span>
                    {event.location && <span className="block text-neutral-400 break-words">@ {event.location}</span>}
                    <span className="block text-neutral-500 uppercase">
                        {event.version > 1 ? "GEWIJZIGD DOOR" : "DOOR"} {people.nameOf(event.updatedBy)}
                    </span>
                    <span className={`block uppercase ${stateTone(state)}`}>
                        <span className="cell">{stateGlyph(state)}</span> {stateLabel(state, people.nameOf)}
                    </span>
                </button>

                {state.needsMyAnswer && (
                    <div className="flex flex-wrap gap-x-[1ch]">
                        <button type="button" disabled={busy} onClick={() => onRespond(event.id, "akkoord")} className={BTN_GREEN}>
                            [✓ AKKOORD]
                        </button>
                        <button type="button" disabled={busy} onClick={() => onRespond(event.id, "niet")} className={BTN_RED}>
                            [✗ NIET AKKOORD]
                        </button>
                    </div>
                )}
            </div>
        </article>
    );
}
