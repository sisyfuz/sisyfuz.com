// src/tui/agenda/AgendaStyleSheet.jsx
import { useState } from "react";
import AgendaSheet from "./AgendaSheet";
import AgendaStylePicker from "./AgendaStylePicker";
import { BTN_PLAIN, BTN_PRIMARY } from "./ui";

// Colour and logo for several chosen items at once. Only what you change is sent:
// picking a colour leaves each item's own logo alone, and the other way round.
function common(events, get) {
    const values = new Set(events.map(get));
    return values.size === 1 ? [...values][0] : undefined;
}

export default function AgendaStyleSheet({ events, stickers, busy, error, onApply, onStudio, onClose }) {
    const start = {
        color: common(events, (e) => e.color || "") ?? "",
        logoId: common(events, (e) => e.logoId || null) ?? null,
        logoSize: common(events, (e) => e.logoSize || "") ?? "",
    };
    const [value, setValue] = useState(start);
    const [touched, setTouched] = useState({ color: false, logo: false });

    const change = (next) => {
        setTouched((t) => ({
            color: t.color || next.color !== value.color,
            logo: t.logo || next.logoId !== value.logoId || next.logoSize !== value.logoSize,
        }));
        setValue(next);
    };
    const newLogo = (sticker) => change({ ...value, logoId: sticker.id, logoSize: value.logoSize || "klein" });

    const apply = () => {
        const body = {};
        if (touched.color) body.color = value.color;
        if (touched.logo) {
            body.logoId = value.logoId;
            if (value.logoId) body.logoSize = value.logoSize || "klein";
        }
        onApply(body);
    };

    return (
        <AgendaSheet title={`${events.length} ${events.length === 1 ? "ITEM" : "ITEMS"} OPMAKEN`} onClose={onClose}>
            <div className="space-y-[1lh]">
                <AgendaStylePicker
                    value={value}
                    onChange={change}
                    stickers={stickers}
                    onDraw={() => onStudio("editor", newLogo)}
                    onImport={() => onStudio("import", newLogo)}
                />
                <p className="text-neutral-500">Kleur en logo vragen niet opnieuw om akkoord.</p>
                {error && <p role="alert" className="text-[#ff4d4d] uppercase">{error}</p>}
                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="button" disabled={busy || (!touched.color && !touched.logo)} onClick={apply} className={BTN_PRIMARY}>
                        {busy ? "[ BEZIG... ]" : "[ TOEPASSEN ]"}
                    </button>
                    <button type="button" onClick={onClose} className={BTN_PLAIN}>
                        [ANNULEREN]
                    </button>
                </div>
            </div>
        </AgendaSheet>
    );
}
