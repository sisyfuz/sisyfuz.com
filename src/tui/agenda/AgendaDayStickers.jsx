// src/tui/agenda/AgendaDayStickers.jsx
import StickerImage from "./StickerImage";

// Stickers stuck on days, over the month grid or a day in the list. `place(d)`
// gives each one's position (in ch and lh, so it lands on the grid); they sit on
// top of everything and let taps through except on the sticker itself. A press
// goes to `onPress` (hold or three taps pick it up, see TuiAgenda); `liftedId`
// pulses, `hiddenId` is in your hand.
export default function AgendaDayStickers({ items, stickersById, place, hiddenId, liftedId, onPress }) {
    const shown = items.filter((d) => d.id !== hiddenId);
    if (!shown.length) return null;
    return (
        <span className="pointer-events-none absolute inset-0 z-10">
            {shown.map((d) => (
                <span
                    key={d.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={d.id === liftedId ? "Sticker: sleep hem naar een nieuwe plek" : "Sticker (houd vast om te verplaatsen)"}
                    onPointerDown={(e) => onPress(e, d)}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`absolute pointer-events-auto select-none ${d.id === liftedId ? "animate-pulse touch-none cursor-grab" : "cursor-pointer"}`}
                    style={{ ...place(d), WebkitTouchCallout: "none" }}
                >
                    <StickerImage sticker={stickersById[d.stickerId]} scale={d.scale ?? 1} rot={d.rot ?? 0} />
                </span>
            ))}
        </span>
    );
}
