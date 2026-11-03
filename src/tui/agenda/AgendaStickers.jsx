// src/tui/agenda/AgendaStickers.jsx
import StickerImage from "./StickerImage";

// Stickers stuck on one item card. A position is stored in cells, not pixels, so it
// lands on the same spot on both phones: `x` is how far along the card (0 = left,
// 1 = right edge, snapped down to a whole column), `y` is whole rows from the top.
// They sit over the text like real stickers. A press goes to `onPress` (hold or
// three taps pick it up, see TuiAgenda); `liftedId` pulses, `hiddenId` is in your hand.
function place(x, y) {
    return { left: `round(down, calc((100% - 9ch) * ${x}), 1ch)`, top: `calc(${y} * 1lh)` };
}

export default function AgendaStickers({ placements = [], stickersById, hiddenId, liftedId, onPress }) {
    const shown = placements.filter((p) => p.id !== hiddenId);
    if (!shown.length) return null;
    return (
        <span className="pointer-events-none absolute inset-0 z-10">
            {shown.map((p) => (
                <span
                    key={p.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={p.id === liftedId ? "Sticker: sleep hem naar een nieuwe plek" : "Sticker (houd vast om te verplaatsen)"}
                    onPointerDown={(e) => onPress?.(e, p)}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`absolute pointer-events-auto select-none ${p.id === liftedId ? "animate-pulse touch-none cursor-grab" : "cursor-pointer"}`}
                    style={{ ...place(p.x, p.y), WebkitTouchCallout: "none" }}
                >
                    <StickerImage sticker={stickersById[p.stickerId]} />
                </span>
            ))}
        </span>
    );
}
