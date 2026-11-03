// src/tui/agenda/AgendaStickerLook.jsx
import { STICKER_SCALES } from "../../utils/agendaTransform";
import { BTN_PLAIN, BTN_PRIMARY } from "./ui";

// Size and rotation buttons for the sticker that is picked up, in the bottom bar:
// [−] 1,5× [+]  [↺] 45° [↻]  [OK]. `onChange(what, dir)` steps "scale" or "rot"
// by one up (1) or down (-1), from the newest value (see TuiAgenda).
const sizeText = (scale) => `${String(scale).replace(".", ",")}×`;

function Glyph({ children }) {
    // In a span, so the flex button doesn't eat the brackets' spacing.
    return (
        <span>
            [<span className="cell">{children}</span>]
        </span>
    );
}

export default function AgendaStickerLook({ look, onChange, onDone }) {
    const { scale = 1, rot = 0 } = look;
    return (
        <>
            <button type="button" aria-label="Kleiner" disabled={scale <= STICKER_SCALES[0]} onClick={() => onChange("scale", -1)} className={BTN_PLAIN}>
                <Glyph>−</Glyph>
            </button>
            <span className="text-white w-[5ch] text-center shrink-0" aria-label="Grootte">{sizeText(scale)}</span>
            <button
                type="button"
                aria-label="Groter"
                disabled={scale >= STICKER_SCALES[STICKER_SCALES.length - 1]}
                onClick={() => onChange("scale", 1)}
                className={BTN_PLAIN}
            >
                <Glyph>+</Glyph>
            </button>
            <span className="w-[1ch] shrink-0" />
            <button type="button" aria-label="Linksom draaien" onClick={() => onChange("rot", -1)} className={BTN_PLAIN}>
                <Glyph>↺</Glyph>
            </button>
            <span className="text-white w-[4ch] text-center shrink-0" aria-label="Draaiing">{rot}°</span>
            <button type="button" aria-label="Rechtsom draaien" onClick={() => onChange("rot", 1)} className={BTN_PLAIN}>
                <Glyph>↻</Glyph>
            </button>
            <button type="button" onClick={onDone} className={`${BTN_PRIMARY} ml-auto`}>
                [OK]
            </button>
        </>
    );
}
