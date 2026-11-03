// src/tui/agenda/AgendaStickers.jsx
import StickerImage from "./StickerImage";

// Stickers stuck on one item card. A position is stored in cells, not pixels, so it
// lands on the same spot on both phones: `x` is how far along the card (0 = left,
// 1 = right edge, snapped down to a whole column), `y` is whole rows from the top.
// They sit over the text like real stickers and let taps through to the card.
function place(x, y) {
    return { left: `round(down, calc((100% - 9ch) * ${x}), 1ch)`, top: `calc(${y} * 1lh)` };
}

export default function AgendaStickers({ placements = [], stickersById, ghost }) {
    if (!placements.length && !ghost) return null;
    return (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
            {placements.map((p) => (
                <span key={p.id} className="absolute" style={place(p.x, p.y)}>
                    <StickerImage sticker={stickersById[p.stickerId]} />
                </span>
            ))}
            {ghost && (
                <span data-sticker-ghost className="absolute animate-pulse" style={place(ghost.x, ghost.y)}>
                    <StickerImage sticker={stickersById[ghost.stickerId]} />
                </span>
            )}
        </span>
    );
}
