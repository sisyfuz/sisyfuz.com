// src/tui/agenda/AgendaLibrary.jsx
import { useEffect, useState } from "react";
import AgendaSheet from "./AgendaSheet";
import StickerImage from "./StickerImage";
import { BTN, BTN_PLAIN, BTN_PRIMARY, BTN_RED, BTN_RED_ON } from "./ui";

// The shared library of pictures (stickers and logos), newest first: tap one to
// edit or remove it. Removing only hides it from here: stickers already stuck on
// stay. Sticking them on goes through the tray (AgendaStickerTray).
export default function AgendaLibrary({ stickers, busy, error, onDraw, onImport, onEdit, onArchive, onClose }) {
    const [chosen, setChosen] = useState(null);
    const [confirm, setConfirm] = useState(false);
    const current = stickers.find((s) => s.id === chosen) ?? null;

    useEffect(() => {
        if (!confirm) return undefined;
        const timer = setTimeout(() => setConfirm(false), 4000);
        return () => clearTimeout(timer);
    }, [confirm]);

    const tap = (s) => {
        setConfirm(false);
        setChosen(chosen === s.id ? null : s.id);
    };

    return (
        <AgendaSheet title="PLAATJES" onClose={onClose} wide>
            <div className="space-y-[1lh]">
                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="button" onClick={onDraw} className={BTN_PRIMARY}>
                        [✎ TEKENEN]
                    </button>
                    <button type="button" onClick={onImport} className={BTN_PLAIN}>
                        [+ IMPORTEREN]
                    </button>
                </div>

                {!stickers.length && <p className="text-neutral-500 uppercase">NOG GEEN PLAATJES. TEKEN OF IMPORTEER ER EEN.</p>}

                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    {stickers.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            aria-pressed={chosen === s.id}
                            aria-label={s.name || "Plaatje"}
                            onClick={() => tap(s)}
                            className={`${BTN} flex-col items-start justify-start py-[1lh] min-h-[7lh] w-[11ch] normal-case ${
                                chosen === s.id ? "bg-[#262626]" : "hover:bg-[#141414]"
                            }`}
                        >
                            <StickerImage sticker={s} />
                            <span className="block w-[9ch] truncate uppercase text-neutral-500">{s.name || "·"}</span>
                        </button>
                    ))}
                </div>

                {current && (
                    <div>
                        <p className="uppercase text-white font-bold">{current.name || "ZONDER NAAM"}</p>
                        <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                            <button type="button" disabled={busy} onClick={() => onEdit(current)} className={BTN_PLAIN}>
                                [BEWERKEN]
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => (confirm ? onArchive(current.id).then(() => setChosen(null)) : setConfirm(true))}
                                className={confirm ? BTN_RED_ON : BTN_RED}
                            >
                                {confirm ? "[ZEKER? TIK NOG EEN KEER]" : "[WEGHALEN]"}
                            </button>
                        </div>
                    </div>
                )}

                {error && <p role="alert" className="text-[#ff4d4d] uppercase">{error}</p>}
            </div>
        </AgendaSheet>
    );
}
