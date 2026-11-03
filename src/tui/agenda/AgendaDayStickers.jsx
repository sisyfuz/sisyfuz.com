// src/tui/agenda/AgendaDayStickers.jsx
import StickerImage from "./StickerImage";

// Stickers stuck on days, over the month grid or a day in the list. `place(d)`
// gives each one's position (in ch and lh, so it lands on the grid); they sit on
// top of everything and let taps through except on the sticker itself. Tapping one
// goes to `onTap`; the one picked up to move pulses and can be dragged
// (`onGrab`, a pointerdown).
export default function AgendaDayStickers({ items, stickersById, place, movingId, onTap, onGrab }) {
    if (!items.length) return null;
    return (
        <span className="pointer-events-none absolute inset-0 z-10">
            {items.map((d) => {
                const moving = d.id === movingId;
                return (
                    <span
                        key={d.id}
                        role="button"
                        tabIndex={-1}
                        aria-label={moving ? "Sticker: sleep hem naar een nieuwe plek" : "Sticker (tik drie keer om te verplaatsen)"}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!moving) onTap(d);
                        }}
                        onPointerDown={moving ? (e) => onGrab(e, d) : undefined}
                        className={`absolute pointer-events-auto select-none ${moving ? "animate-pulse touch-none cursor-grab" : "cursor-pointer"}`}
                        style={{ ...place(d), WebkitTouchCallout: "none" }}
                    >
                        <StickerImage sticker={stickersById[d.stickerId]} />
                    </span>
                );
            })}
        </span>
    );
}
