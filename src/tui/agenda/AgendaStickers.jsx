// src/tui/agenda/AgendaStickers.jsx
import StickerImage from "./StickerImage";

// Stickers stuck on one item card. A position is stored in cells, not pixels, so it
// lands on the same spot on both phones: `x` is how far along the card (0 = left,
// 1 = right edge, snapped down to a whole column), `y` is whole rows from the top.
// They sit over the text like real stickers. Tapping one goes to `onTap` (three
// quick taps pick it up to move it); the one being moved shows as `ghost` instead.
function place(x, y) {
    return { left: `round(down, calc((100% - 9ch) * ${x}), 1ch)`, top: `calc(${y} * 1lh)` };
}

export default function AgendaStickers({ placements = [], stickersById, ghost, onTap }) {
    const shown = ghost?.placementId ? placements.filter((p) => p.id !== ghost.placementId) : placements;
    if (!shown.length && !ghost) return null;
    return (
        <span className="pointer-events-none absolute inset-0 z-10">
            {shown.map((p) => (
                <span
                    key={p.id}
                    role="button"
                    tabIndex={-1}
                    aria-label="Sticker (tik drie keer om te verplaatsen)"
                    onClick={(e) => {
                        e.stopPropagation();
                        onTap?.(p);
                    }}
                    className={`absolute select-none ${ghost ? "" : "pointer-events-auto cursor-pointer"}`}
                    style={{ ...place(p.x, p.y), WebkitTouchCallout: "none" }}
                >
                    <StickerImage sticker={stickersById[p.stickerId]} />
                </span>
            ))}
            {/* Grabbable even where it sticks out past the card; the press goes on to the card. */}
            {ghost && (
                <span data-sticker-ghost aria-hidden="true" className="absolute animate-pulse pointer-events-auto touch-none cursor-grab" style={place(ghost.x, ghost.y)}>
                    <StickerImage sticker={stickersById[ghost.stickerId]} />
                </span>
            )}
        </span>
    );
}
