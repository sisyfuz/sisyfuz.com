// src/tui/agenda/AgendaItem.jsx
import { useEffect, useRef } from "react";
import { timeLabel } from "../../utils/agendaDates";
import { itemState, stateGlyph, stateLabel, stateTone } from "../../utils/agendaStatus";
import { tint } from "../../utils/agendaSpecial";
import { logoOf } from "../../utils/agendaStyle";
import AgendaGutter from "./AgendaGutter";
import AgendaStickers from "./AgendaStickers";
import StickerImage from "./StickerImage";
import { BTN_GREEN, BTN_RED } from "./ui";

// Hovering this long with a mouse, or pressing and holding this long on a touch
// screen, counts as having read the item. Scrolling cancels a hold (pointercancel).
const HOVER_READ_MS = 1500;
const HOLD_READ_MS = 600;

// One item on one day. Tapping the card opens it; when the other person made
// the last change, the answer buttons sit right on the card. While choosing items
// a tap ticks it instead. Pressing a sticker on it goes to `onStickerPress`.

export default function AgendaItem({
    event,
    day,
    people,
    newIds,
    trackSeen,
    onRead,
    onOpen,
    onRespond,
    busy,
    stickersById = {},
    selection = null,
    onToggleSelect,
    stickerHiddenId = null,
    stickerLiftedId = null,
    onStickerPress,
}) {
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

    const selecting = selection !== null;
    const selected = selecting && selection.has(event.id);
    const bigLogo = logoOf(event, stickersById, "groot");
    const smallLogo = logoOf(event, stickersById, "klein");

    const tapCard = () => (selecting ? onToggleSelect(event.id) : onOpen(event.id));

    return (
        <article
            ref={unseenByMe ? trackSeen : undefined}
            data-seen-id={event.id}
            data-item-id={event.id}
            className="relative flex gap-x-[1ch]"
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
                    onClick={tapCard}
                    aria-pressed={selecting ? selected : undefined}
                    className={`block w-full text-left cursor-pointer select-none transition-none focus-visible:outline-none focus-visible:bg-[#262626] ${
                        event.color ? "hover:brightness-125" : "hover:bg-[#141414]"
                    }`}
                    style={event.color ? { backgroundColor: tint(event.color, 0.14) } : undefined}
                >
                    <span className="flex flex-wrap items-baseline gap-x-[2ch]">
                        {selecting && <span className={selected ? "text-white font-bold" : "text-neutral-500"}>[{selected ? "x" : " "}]</span>}
                        <span className="text-neutral-400 uppercase">{timeLabel(event, day)}</span>
                        <span className="uppercase font-bold" style={{ color: forColor }}>
                            <span className="cell">●</span> {people.nameOf(event.forWho)}
                        </span>
                        {isNew && <span className="bg-[#f7e463] text-black font-bold px-[1ch]">NIEUW</span>}
                    </span>
                    <span className="block font-bold break-words" style={{ color: event.color || "#ffffff" }}>
                        {smallLogo && <StickerImage sticker={smallLogo} size="klein" className="mr-[1ch]" />}
                        {event.title}
                    </span>
                    {event.location && <span className="block text-neutral-400 break-words">@ {event.location}</span>}
                    <span className="block text-neutral-500 uppercase">
                        {event.version > 1 ? "GEWIJZIGD DOOR" : "DOOR"} {people.nameOf(event.updatedBy)}
                    </span>
                    <span className={`block uppercase ${stateTone(state)}`}>
                        <span className="cell">{stateGlyph(state)}</span> {stateLabel(state, people.nameOf)}
                    </span>
                </button>

                {state.needsMyAnswer && !selecting && (
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
            {bigLogo && <StickerImage sticker={bigLogo} />}
            <AgendaStickers
                placements={event.placements}
                stickersById={stickersById}
                hiddenId={stickerHiddenId}
                liftedId={stickerLiftedId}
                onPress={(e, p) => onStickerPress?.(e, { kind: "item", eventId: event.id, id: p.id, stickerId: p.stickerId }, tapCard)}
            />
        </article>
    );
}
