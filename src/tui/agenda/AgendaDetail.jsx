// src/tui/agenda/AgendaDetail.jsx
import { useEffect, useState } from "react";
import { daysBetween, formatDayLong, formatStamp, formatWhen } from "../../utils/agendaDates";
import { itemState } from "../../utils/agendaStatus";
import { isBusy } from "../../utils/agendaBusy";
import { isAppointment, isPeriod, isSpecial, specialType } from "../../utils/agendaSpecial";
import { firstOccurrence, repeatText } from "../../utils/agendaRepeat";
import AgendaScopeChoice from "./AgendaScopeChoice";
import AgendaSheet from "./AgendaSheet";
import StickerImage from "./StickerImage";
import { BTN_GREEN, BTN_GREEN_ON, BTN_PLAIN, BTN_RED, BTN_RED_ON } from "./ui";

// "elk jaar op 14 maart · sinds 2005" for yearly special days.
function whenText(event) {
    if (isSpecial(event) && event.repeat === "jaarlijks") {
        const [, day, month, year] = formatDayLong(event.startDate).split(" ");
        return `elk jaar op ${day} ${month} · sinds ${year}`;
    }
    if (isPeriod(event)) {
        const days = daysBetween(event.startDate, event.endDate) + 1;
        return `${formatWhen(event)} · ${days} ${days === 1 ? "dag" : "dagen"}`;
    }
    return formatWhen(event);
}

// Highest step reached: answered, read (opened / hovered / held), seen, or nothing yet.
function personLine(status, isLastEditor, isNew) {
    if (isLastEditor) {
        return { glyph: "✓", text: `AKKOORD (HEEFT HET ${isNew ? "TOEGEVOEGD" : "AANGEPAST"})`, tone: "text-[#00ff66]" };
    }
    if (status.response === "akkoord") return { glyph: "✓", text: `AKKOORD · ${formatStamp(status.respondedAt)}`, tone: "text-[#00ff66]" };
    if (status.response === "niet") return { glyph: "✗", text: `NIET AKKOORD · ${formatStamp(status.respondedAt)}`, tone: "text-[#ff4d4d]" };
    if (status.readAt) return { glyph: "◉", text: `GELEZEN · ${formatStamp(status.readAt)} · NOG GEEN ANTWOORD`, tone: "text-neutral-200" };
    if (status.seenAt) return { glyph: "◐", text: `GEZIEN · ${formatStamp(status.seenAt)} · NOG NIET GELEZEN`, tone: "text-neutral-300" };
    return { glyph: "○", text: "NOG NIET GEZIEN", tone: "text-neutral-500" };
}

export default function AgendaDetail({ event, people, busy, error, onClose, onEdit, onRespond, onDelete, stickersById = {}, onAddSticker, onRemoveSticker }) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const state = itemState(event, people.me, people.ids);
    const forColor = people.colorOf(event.forWho);

    const series = Boolean(event.rule);
    // The delete button asks once more; the question goes away after a few seconds.
    // For a repeating item it asks which ones instead, and waits for the answer.
    useEffect(() => {
        if (!confirmDelete || series) return undefined;
        const timer = setTimeout(() => setConfirmDelete(false), 4000);
        return () => clearTimeout(timer);
    }, [confirmDelete, series]);

    const myResponse = event.status?.[people.me]?.response ?? null;
    const busyItem = isBusy(event);
    const specialItem = isSpecial(event);
    const type = specialItem ? specialType(event) : null;
    const title = busyItem
        ? `ONBESCHIKBAAR · ${event.reason}`
        : specialItem
        ? `${type.glyph} ${type.label} · ${event.title}`
        : isPeriod(event)
        ? `░ ${event.title}`
        : event.title;

    return (
        <AgendaSheet title={title} onClose={onClose}>
            <div className="space-y-[1lh]">
                <dl className="space-y-[1lh]">
                    {busyItem && event.title.toLowerCase() !== event.reason.toLowerCase() && (
                        <div>
                            <dt className="text-neutral-500 uppercase">WAT</dt>
                            <dd className="text-white break-words">{event.title}</dd>
                        </div>
                    )}
                    <div>
                        <dt className="text-neutral-500 uppercase">WANNEER</dt>
                        <dd className="text-white">{whenText(event)}</dd>
                    </div>
                    {series && (
                        <div>
                            <dt className="text-neutral-500 uppercase">HERHAALT</dt>
                            <dd className="text-white">
                                <span className="cell">↻</span> {repeatText(event.rule, event.seriesStart)}
                            </dd>
                        </div>
                    )}
                    <div>
                        <dt className="text-neutral-500 uppercase">{isAppointment(event) ? "VOOR WIE" : specialItem ? "HOORT BIJ" : "WIE"}</dt>
                        <dd className="uppercase font-bold" style={{ color: forColor }}>
                            <span className="cell">●</span> {people.nameOf(event.forWho)}
                        </dd>
                    </div>
                    {event.location && (
                        <div>
                            <dt className="text-neutral-500 uppercase">WAAR</dt>
                            <dd className="text-white break-words">{event.location}</dd>
                        </div>
                    )}
                    {event.note && (
                        <div>
                            <dt className="text-neutral-500 uppercase">NOTITIE</dt>
                            <dd className="text-neutral-200 whitespace-pre-wrap break-words">{event.note}</dd>
                        </div>
                    )}
                </dl>

                <div aria-hidden="true" className="text-neutral-700 overflow-hidden whitespace-nowrap">{"-".repeat(80)}</div>

                <div className="uppercase">
                    <p className="text-neutral-400">
                        TOEGEVOEGD DOOR <span className="text-white">{people.nameOf(event.createdBy)}</span> · {formatStamp(event.createdAt)}
                    </p>
                    {event.version > 1 && (
                        <p className="text-neutral-400">
                            GEWIJZIGD DOOR <span className="text-white">{people.nameOf(event.updatedBy)}</span> · {formatStamp(event.updatedAt)}
                        </p>
                    )}
                    {event.imported && <p className="text-neutral-600">GEÏMPORTEERD UIT EEN AGENDABESTAND</p>}
                </div>

                {isAppointment(event) && (
                    <>
                        <div className="uppercase" aria-label="Gezien, gelezen en akkoord">
                            {people.ids.map((id) => {
                                const line = personLine(event.status?.[id] ?? {}, event.updatedBy === id, event.version === 1);
                                return (
                                    <p key={id} className={line.tone}>
                                        <span style={{ color: people.colorOf(id) }}>{people.nameOf(id)}</span>
                                        {id === people.me && " (JIJ)"}: <span className="cell">{line.glyph}</span> {line.text}
                                    </p>
                                );
                            })}
                        </div>

                        <p className="text-neutral-600 uppercase">
                            <span className="cell">○</span> NIET GEZIEN <span className="cell">◐</span> GEZIEN{" "}
                            <span className="cell">◉</span> GELEZEN <span className="cell">✓</span> AKKOORD
                        </p>

                        {!state.byMe && (
                            <div>
                                <p className="text-neutral-500 uppercase">BEN JIJ AKKOORD?</p>
                                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                                    <button
                                        type="button"
                                        disabled={busy}
                                        aria-pressed={myResponse === "akkoord"}
                                        onClick={() => onRespond(event.id, myResponse === "akkoord" ? null : "akkoord")}
                                        className={myResponse === "akkoord" ? BTN_GREEN_ON : BTN_GREEN}
                                    >
                                        [✓ AKKOORD]
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        aria-pressed={myResponse === "niet"}
                                        onClick={() => onRespond(event.id, myResponse === "niet" ? null : "niet")}
                                        className={myResponse === "niet" ? BTN_RED_ON : BTN_RED}
                                    >
                                        [✗ NIET AKKOORD]
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {isAppointment(event) && (
                    <div>
                        <p className="text-neutral-500 uppercase">STICKERS</p>
                        {event.placements?.length > 0 && (
                            <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                                {event.placements.map((p) => (
                                    <span key={p.id} className="inline-flex flex-col items-start px-[1ch]">
                                        <StickerImage sticker={stickersById[p.stickerId]} />
                                        <span className="uppercase text-neutral-500" style={{ color: people.colorOf(p.placedBy) }}>
                                            {people.nameOf(p.placedBy)}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onRemoveSticker(event.id, p.id)}
                                            className={`${BTN_PLAIN} -ml-[1ch]`}
                                        >
                                            [ER AF]
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                            <button type="button" disabled={busy} onClick={() => onAddSticker(event.id, event.occurrenceDate ?? null)} className={BTN_PLAIN}>
                                [+ STICKER]
                            </button>
                        </div>
                    </div>
                )}

                {error && <p role="alert" className="text-[#ff4d4d] uppercase">{error}</p>}

                {series && confirmDelete ? (
                    <div className="pt-[1lh]">
                        <AgendaScopeChoice
                            question="WELKE WIL JE VERWIJDEREN?"
                            first={event.occurrenceDate <= firstOccurrence({ ...event, startDate: event.seriesStart })}
                            danger
                            busy={busy}
                            onPick={(scope) => (scope === "alle" ? onDelete(event.id) : onDelete(event.id, scope, event.occurrenceDate))}
                            onCancel={() => setConfirmDelete(false)}
                        />
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch] pt-[1lh]">
                        <button type="button" disabled={busy} onClick={() => onEdit(event)} className={BTN_PLAIN}>
                            [BEWERKEN]
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => (confirmDelete ? onDelete(event.id) : setConfirmDelete(true))}
                            className={confirmDelete ? BTN_RED_ON : BTN_RED}
                        >
                            {confirmDelete ? "[ZEKER? TIK NOG EEN KEER]" : "[VERWIJDEREN]"}
                        </button>
                    </div>
                )}
            </div>
        </AgendaSheet>
    );
}
