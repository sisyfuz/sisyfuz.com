// src/tui/agenda/AgendaStickerTray.jsx
import { useState } from "react";
import StickerImage from "./StickerImage";
import { BTN_PLAIN, BTN_PRIMARY } from "./ui";

// The sticker tray in the bottom bar: drag a sticker out of it and drop it anywhere
// in the agenda (an item, a day in the month or in the list). The dragging itself
// is useStickerDrag's (`onStart`); `draggingId` dims the sticker being dragged.
// [✎ MAKEN] opens the library to draw, load or edit them (`onManage`).
export default function AgendaStickerTray({ stickers, busy, draggingId, onStart, onDraw, onImport, onManage, onClose }) {
    const [hint, setHint] = useState("");

    return (
        <div className="w-full min-w-0 px-[1ch]">
            <div className="flex items-center gap-x-[1ch]">
                <span className="text-neutral-400 uppercase min-w-0 truncate">{hint || "SLEEP EEN STICKER WAAR JE WILT"}</span>
                <button type="button" onClick={onManage} className={`${BTN_PLAIN} ml-auto`}>
                    <span>[<span className="cell">✎</span> MAKEN]</span>
                </button>
                <button type="button" onClick={onClose} className={`${BTN_PRIMARY} -mr-[1ch]`}>
                    [KLAAR]
                </button>
            </div>
            {stickers.length ? (
                <div className="flex gap-x-[1ch] overflow-x-auto no-scrollbar h-[5lh]">
                    {stickers.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            aria-label={`Sticker ${s.name || ""}`.trim()}
                            disabled={busy}
                            onPointerDown={(e) => {
                                setHint("");
                                onStart(e, s, { onTap: () => setHint("SLEEP HEM NAAR EEN DAG OF AFSPRAAK") });
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`shrink-0 cursor-grab select-none touch-pan-x ${draggingId === s.id ? "opacity-30" : ""}`}
                            style={{ WebkitTouchCallout: "none" }}
                        >
                            <StickerImage sticker={s} />
                        </button>
                    ))}
                </div>
            ) : (
                <div className="flex gap-x-[1ch] -ml-[1ch] h-[5lh]">
                    <button type="button" onClick={onDraw} className={BTN_PLAIN}>
                        [✎ TEKENEN]
                    </button>
                    <button type="button" onClick={onImport} className={BTN_PLAIN}>
                        [+ IMPORTEREN]
                    </button>
                </div>
            )}
        </div>
    );
}
