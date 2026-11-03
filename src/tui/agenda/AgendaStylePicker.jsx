// src/tui/agenda/AgendaStylePicker.jsx
import { ITEM_COLORS, LOGO_SIZES, readableColor } from "../../utils/agendaStyle";
import AgendaChoice from "./AgendaChoice";
import StickerImage from "./StickerImage";
import { BTN, BTN_PLAIN, LABEL } from "./ui";

// Colour and logo for one or more items. `value` is { color, logoId, logoSize };
// `onChange` gets the whole new value. New pictures are made in the editor or the
// import, which open on top (`onDraw`, `onImport`) and hand the new one back.
export default function AgendaStylePicker({ value, onChange, stickers, onDraw, onImport }) {
    const set = (patch) => onChange({ ...value, ...patch });
    const custom = value.color && !ITEM_COLORS.includes(value.color);
    const swatch = (active) => `${BTN} ${active ? "text-black font-bold" : "hover:brightness-125"}`;

    return (
        <>
            <fieldset>
                <legend className={LABEL}>KLEUR</legend>
                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="button" aria-pressed={!value.color} onClick={() => set({ color: "" })} className={!value.color ? `${BTN} bg-white text-black font-bold` : BTN_PLAIN}>
                        [GEEN]
                    </button>
                    {ITEM_COLORS.map((color) => (
                        <button
                            key={color}
                            type="button"
                            aria-label={`Kleur ${color}`}
                            aria-pressed={value.color === color}
                            onClick={() => set({ color })}
                            className={swatch(value.color === color)}
                            style={value.color === color ? { backgroundColor: color } : { color }}
                        >
                            {value.color === color ? "[✓]" : "███"}
                        </button>
                    ))}
                    <label className={`${BTN} relative ${custom ? "text-black font-bold" : "text-neutral-300 hover:bg-white hover:text-black"}`} style={custom ? { backgroundColor: value.color } : undefined}>
                        [+ EIGEN]
                        <input
                            type="color"
                            value={value.color || "#ffffff"}
                            onChange={(e) => set({ color: readableColor(e.target.value) })}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            aria-label="Eigen kleur kiezen"
                        />
                    </label>
                </div>
            </fieldset>

            <fieldset>
                <legend className={LABEL}>LOGO</legend>
                <AgendaChoice
                    options={LOGO_SIZES}
                    value={value.logoId ? value.logoSize || "klein" : ""}
                    onChange={(logoSize) =>
                        set(logoSize ? { logoSize, logoId: value.logoId || stickers[0]?.id || null } : { logoSize: "", logoId: null })
                    }
                />
                {(value.logoId || value.logoSize) && !stickers.length && (
                    <p className="text-neutral-500 uppercase">NOG GEEN PLAATJES. TEKEN OF IMPORTEER ER EEN.</p>
                )}
                {(value.logoId || value.logoSize) && (
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        {stickers.map((s) => {
                            const active = value.logoId === s.id;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    aria-pressed={active}
                                    aria-label={s.name || "Plaatje"}
                                    title={s.name}
                                    onClick={() => set({ logoId: s.id, logoSize: value.logoSize || "klein" })}
                                    className={`${BTN} items-start py-[1lh] min-h-[6lh] ${active ? "bg-[#262626]" : "hover:bg-[#141414]"}`}
                                >
                                    <StickerImage sticker={s} />
                                </button>
                            );
                        })}
                    </div>
                )}
                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="button" onClick={onDraw} className={BTN_PLAIN}>
                        [✎ TEKENEN]
                    </button>
                    <button type="button" onClick={onImport} className={BTN_PLAIN}>
                        [+ IMPORTEREN]
                    </button>
                </div>
            </fieldset>
        </>
    );
}
