// src/tui/agenda/AgendaGutter.jsx

// A one-character column of glyphs (│ for an item, ░ for a zone) that grows with
// its row, instead of a CSS border: the edge stays a character on the grid.
// Every row of the content is a whole line, so clipping always ends on a glyph.
const ROWS = 200;

export default function AgendaGutter({ color, glyph = "│" }) {
    return (
        <span aria-hidden="true" className="relative w-[1ch] shrink-0 self-stretch overflow-hidden select-none" style={{ color }}>
            {/* Absolute, so the glyphs fill the column without making the row taller. */}
            <span className="absolute inset-0 whitespace-pre">{`${glyph}\n`.repeat(ROWS)}</span>
        </span>
    );
}
