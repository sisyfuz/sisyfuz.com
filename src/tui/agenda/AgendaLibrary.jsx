// src/tui/agenda/AgendaLibrary.jsx
import { useEffect, useState } from "react";
import AgendaSheet from "./AgendaSheet";
import StickerImage from "./StickerImage";
import { BTN, BTN_PLAIN, BTN_PRIMARY, BTN_RED, BTN_RED_ON, LABEL } from "./ui";

// The shared library of pictures: they are both the stickers and the logos. It
// says what they are for, makes new ones (draw or load an image), edits one with
// a tap on it, removes one with its own [WEG] (asking once more), and leads on to
// sticking them (`onStick`). Removing only hides it here: stickers already stuck
// on and logos in use stay.
export default function AgendaLibrary({ stickers, busy, error, onDraw, onImport, onEdit, onArchive, onStick, onClose }) {
    const [confirm, setConfirm] = useState(null);

    useEffect(() => {
        if (!confirm) return undefined;
        const timer = setTimeout(() => setConfirm(null), 4000);
        return () => clearTimeout(timer);
    }, [confirm]);

    const remove = (s) => {
        if (confirm !== s.id) return setConfirm(s.id);
        setConfirm(null);
        onArchive(s.id);
    };

    return (
        <AgendaSheet title="JE PLAATJES" onClose={onClose} wide>
            <div className="space-y-[1lh]">
                <p className="text-neutral-300">
                    Plaatjes zijn jullie stickers én logo&apos;s, van jullie allebei. Maak er een, en plak hem daarna op een dag of afspraak.
                </p>

                <div>
                    <p className={LABEL}>NIEUW PLAATJE</p>
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        <button type="button" onClick={onDraw} className={BTN_PRIMARY}>
                            <span>[<span className="cell">✎</span> ZELF TEKENEN]</span>
                        </button>
                        <button type="button" onClick={onImport} className={BTN_PLAIN}>
                            [+ AFBEELDING INLADEN]
                        </button>
                    </div>
                </div>

                <div>
                    <p className={LABEL}>
                        {stickers.length ? `${stickers.length} ${stickers.length === 1 ? "PLAATJE" : "PLAATJES"} · TIK EROP OM TE BEWERKEN` : "NOG GEEN PLAATJES"}
                    </p>
                    {stickers.length === 0 && <p className="text-neutral-500">Teken je eerste, of laad een afbeelding in. Hij wordt 64 bij 64 pixels.</p>}
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        {stickers.map((s) => (
                            <div key={s.id} className="flex flex-col items-start w-[11ch]">
                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={`${s.name || "Plaatje"} bewerken`}
                                    onClick={() => onEdit(s)}
                                    className={`${BTN} flex-col items-start justify-start w-full pt-[1lh] min-h-[5lh] hover:bg-[#141414]`}
                                >
                                    <StickerImage sticker={s} />
                                    <span className="block w-[9ch] truncate uppercase text-neutral-400">{s.name || "·"}</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={`${s.name || "Plaatje"} weghalen`}
                                    onClick={() => remove(s)}
                                    className={confirm === s.id ? BTN_RED_ON : BTN_RED}
                                >
                                    {confirm === s.id ? "[ZEKER?]" : "[WEG]"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {stickers.length > 0 && (
                    <div>
                        <p className={LABEL}>GEBRUIKEN</p>
                        <div className="flex flex-wrap items-center gap-x-[1ch] -ml-[1ch]">
                            <button type="button" onClick={onStick} className={BTN_PRIMARY}>
                                <span>[<span className="cell">★</span> STICKERS PLAKKEN]</span>
                            </button>
                            <span className="text-neutral-500 px-[1ch]">sleep ze op een dag of afspraak</span>
                        </div>
                        <p className="text-neutral-500">
                            Als logo: open een afspraak, tik op [BEWERKEN] en kies bij LOGO een plaatje. Of geef er meer tegelijk een met [KIES].
                        </p>
                    </div>
                )}

                {error && <p role="alert" className="text-[#ff4d4d] uppercase">{error}</p>}
            </div>
        </AgendaSheet>
    );
}
