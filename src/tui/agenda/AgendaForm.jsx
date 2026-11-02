// src/tui/agenda/AgendaForm.jsx
import { useState } from "react";
import { nextWholeHour } from "../../utils/agendaDates";
import { BUSY_REASONS } from "../../utils/agendaBusy";
import { SPECIAL_TYPES } from "../../utils/agendaSpecial";
import AgendaChoice from "./AgendaChoice";
import AgendaSheet from "./AgendaSheet";
import { BTN, BTN_PRIMARY, BTN_PLAIN, FIELD, LABEL, TEXTAREA } from "./ui";

const KINDS = [
    { id: "afspraak", label: "AFSPRAAK" },
    { id: "onbeschikbaar", label: "ONBESCHIKBAAR" },
    { id: "bijzonder", label: "★ BIJZONDERE DAG" },
    { id: "periode", label: "░ PERIODE" },
];
const SPECIAL_IDS = Object.keys(SPECIAL_TYPES);

// What the title field is called, per kind (and per kind of special day).
function titleField(v) {
    if (v.kind === "onbeschikbaar") return { label: "OMSCHRIJVING (MAG LEEG)", placeholder: "bijv. wiskunde, sessie 4" };
    if (v.kind === "periode") return { label: "NAAM", placeholder: "bijv. zomervakantie" };
    if (v.kind === "bijzonder") {
        if (v.reason === "verjaardag") return { label: "VAN WIE?", placeholder: "bijv. oma, Sam" };
        if (v.reason === "jubileum") return { label: "WAT VIEREN WE? (MAG LEEG)", placeholder: "samen" };
        return { label: "WAT?", placeholder: "bijv. Koningsdag, diploma-uitreiking" };
    }
    return { label: "WAT?", placeholder: "Wat gaan we doen?" };
}

function initialValues(event, date, kind, me) {
    if (event) {
        return {
            kind: event.kind,
            reason: event.reason,
            title: event.kind === "onbeschikbaar" && event.title === event.reason ? "" : event.title,
            forWho: event.forWho,
            allDay: event.allDay,
            startDate: event.startDate,
            multiDay: event.endDate !== event.startDate,
            endDate: event.endDate,
            startTime: event.startTime || nextWholeHour(),
            endTime: event.endTime || "",
            location: event.location,
            note: event.note,
            repeat: event.repeat === "jaarlijks",
            countYears: event.countYears,
        };
    }
    return {
        kind,
        reason: kind === "bijzonder" ? "verjaardag" : "",
        title: "",
        forWho: kind === "onbeschikbaar" ? me : "samen",
        allDay: kind === "periode",
        startDate: date,
        multiDay: kind === "periode",
        endDate: date,
        startTime: nextWholeHour(),
        endTime: "",
        location: "",
        note: "",
        repeat: true,
        countYears: true,
    };
}

// Defaults that make sense when switching to another kind.
function switchKind(v, kind, isNew, me) {
    const next = { ...v, kind };
    if (kind === "bijzonder" && !SPECIAL_IDS.includes(v.reason)) next.reason = "verjaardag";
    if (kind === "onbeschikbaar" && SPECIAL_IDS.includes(v.reason)) next.reason = "";
    if (kind === "periode") next.multiDay = true;
    if (isNew && kind === "onbeschikbaar" && v.forWho === "samen") next.forWho = me;
    return next;
}

// Same checks as the worker, so most mistakes show before anything is sent.
function check(v) {
    if (v.kind === "onbeschikbaar" && !v.reason.trim()) return "Kies of typ een reden.";
    if (v.kind === "bijzonder") {
        if (v.reason === "verjaardag" && !v.title.trim()) return "Van wie is de verjaardag?";
        if (v.reason === "anders" && !v.title.trim()) return "Wat voor dag is het?";
    } else if (v.kind !== "onbeschikbaar" && !v.title.trim()) {
        return v.kind === "periode" ? "Geef de periode een naam." : "Geef het een titel.";
    }
    if (!v.startDate) return "Kies een datum.";
    const multi = v.kind === "periode" || (v.kind !== "bijzonder" && v.multiDay);
    if (multi && (!v.endDate || v.endDate < v.startDate)) return "De einddatum ligt voor de begindatum.";
    const timed = (v.kind === "afspraak" || v.kind === "onbeschikbaar") && !v.allDay;
    if (timed && !v.startTime) return "Kies een begintijd.";
    if (timed && !multi && v.endTime && v.endTime < v.startTime) return "De eindtijd ligt voor de begintijd.";
    return "";
}

function Toggle({ checked, onChange, children }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`${BTN} -ml-[1ch] ${checked ? "text-white" : "text-neutral-400"} hover:bg-white hover:text-black`}
        >
            [<span className="cell">{checked ? "x" : " "}</span>] {children}
        </button>
    );
}

export default function AgendaForm({ event, date, kind = "afspraak", people, busy, error, onClose, onSave }) {
    const [v, setV] = useState(() => initialValues(event, date, kind, people.me));
    const [localError, setLocalError] = useState("");
    const set = (patch) => setV((prev) => ({ ...prev, ...patch }));

    const busyItem = v.kind === "onbeschikbaar";
    const special = v.kind === "bijzonder";
    const period = v.kind === "periode";
    const timedKind = v.kind === "afspraak" || busyItem;
    const multi = period || (timedKind && v.multiDay);
    const showTimes = timedKind && !v.allDay;

    const submit = (e) => {
        e.preventDefault();
        const problem = check(v);
        setLocalError(problem);
        if (problem) return;
        onSave({
            kind: v.kind,
            reason: busyItem ? v.reason.trim().toLowerCase() : special ? v.reason : "",
            title: v.title.trim(),
            forWho: v.forWho,
            allDay: !timedKind || v.allDay,
            startDate: v.startDate,
            endDate: multi ? v.endDate : v.startDate,
            startTime: showTimes ? v.startTime : null,
            endTime: showTimes && v.endTime ? v.endTime : null,
            location: timedKind ? v.location.trim() : "",
            note: v.note.trim(),
            repeat: special && v.repeat ? "jaarlijks" : "",
            countYears: special && v.countYears,
            ...(event ? { version: event.version } : {}),
        });
    };

    const forOptions = [...people.ids, "samen"].map((id) => ({ id, label: people.nameOf(id) }));
    const shownError = localError || error;
    const reasonIsPreset = BUSY_REASONS.includes(v.reason.trim().toLowerCase());
    const title = titleField(v);
    const dateLabel = period || multi ? "VAN" : special && v.repeat ? (v.reason === "verjaardag" ? "GEBOORTEDATUM" : "DATUM (EERSTE KEER)") : "DATUM";

    return (
        <AgendaSheet title={event ? "BEWERKEN" : "NIEUW IN DE AGENDA"} onClose={onClose}>
            <form onSubmit={submit} className="space-y-[1lh]" noValidate>
                <fieldset>
                    <legend className={LABEL}>SOORT</legend>
                    <AgendaChoice options={KINDS} value={v.kind} onChange={(k) => setV((prev) => switchKind(prev, k, !event, people.me))} />
                </fieldset>

                {busyItem && (
                    <fieldset>
                        <legend className={LABEL}>WAAROM?</legend>
                        <AgendaChoice
                            options={BUSY_REASONS.map((r) => ({ id: r, label: r.toUpperCase() }))}
                            value={v.reason.trim().toLowerCase()}
                            onChange={(reason) => set({ reason })}
                        />
                        <input
                            type="text"
                            aria-label="Andere reden"
                            value={reasonIsPreset ? "" : v.reason}
                            onChange={(e) => set({ reason: e.target.value })}
                            maxLength={40}
                            placeholder="of typ zelf een reden…"
                            autoComplete="off"
                            className={FIELD}
                        />
                    </fieldset>
                )}

                {special && (
                    <fieldset>
                        <legend className={LABEL}>WAT VOOR DAG?</legend>
                        <AgendaChoice
                            options={SPECIAL_IDS.map((id) => ({ id, label: `${SPECIAL_TYPES[id].glyph} ${SPECIAL_TYPES[id].label}` }))}
                            value={v.reason}
                            onChange={(reason) => set({ reason })}
                            colorOf={(id) => SPECIAL_TYPES[id].color}
                        />
                    </fieldset>
                )}

                <div>
                    <label htmlFor="agenda-title" className={LABEL}>{title.label}</label>
                    <input
                        id="agenda-title"
                        type="text"
                        value={v.title}
                        onChange={(e) => set({ title: e.target.value })}
                        maxLength={120}
                        placeholder={title.placeholder}
                        autoComplete="off"
                        enterKeyHint="next"
                        autoFocus={!event && !busyItem}
                        className={FIELD}
                    />
                </div>

                <fieldset>
                    <legend className={LABEL}>{v.kind === "afspraak" ? "VOOR WIE?" : special ? "HOORT BIJ" : "WIE?"}</legend>
                    <AgendaChoice options={forOptions} value={v.forWho} onChange={(forWho) => set({ forWho })} colorOf={people.colorOf} />
                </fieldset>

                <div>
                    <label htmlFor="agenda-date" className={LABEL}>{dateLabel}</label>
                    <input
                        id="agenda-date"
                        type="date"
                        value={v.startDate}
                        min={special ? "1900-01-01" : undefined}
                        onChange={(e) => {
                            const startDate = e.target.value;
                            set({ startDate, endDate: v.endDate < startDate ? startDate : v.endDate });
                        }}
                        required
                        className={FIELD}
                    />
                </div>

                {timedKind && (
                    <div className="flex flex-col items-start">
                        <Toggle checked={v.multiDay} onChange={(multiDay) => set({ multiDay, endDate: multiDay ? v.endDate : v.startDate })}>
                            MEERDERE DAGEN
                        </Toggle>
                        <Toggle checked={v.allDay} onChange={(allDay) => set({ allDay })}>
                            HELE DAG
                        </Toggle>
                    </div>
                )}

                {special && (
                    <div className="flex flex-col items-start">
                        <Toggle checked={v.repeat} onChange={(repeat) => set({ repeat })}>
                            ELK JAAR
                        </Toggle>
                        {v.repeat && (
                            <Toggle checked={v.countYears} onChange={(countYears) => set({ countYears })}>
                                {v.reason === "verjaardag" ? "LEEFTIJD TONEN" : "JAREN TELLEN"}
                            </Toggle>
                        )}
                        {v.repeat && v.countYears && v.reason === "verjaardag" && (
                            <p className="text-neutral-500">Geboortejaar onbekend? Zet LEEFTIJD TONEN uit.</p>
                        )}
                    </div>
                )}

                {multi && (
                    <div>
                        <label htmlFor="agenda-end-date" className={LABEL}>TOT EN MET</label>
                        <input
                            id="agenda-end-date"
                            type="date"
                            value={v.endDate}
                            min={v.startDate}
                            onChange={(e) => set({ endDate: e.target.value })}
                            className={FIELD}
                        />
                    </div>
                )}

                {showTimes && (
                    <div className="grid gap-x-[2ch]" style={{ gridTemplateColumns: "repeat(2, round(down, calc((100% - 2ch) / 2), 1ch))" }}>
                        <div>
                            <label htmlFor="agenda-start" className={LABEL}>BEGIN</label>
                            <input
                                id="agenda-start"
                                type="time"
                                value={v.startTime}
                                onChange={(e) => set({ startTime: e.target.value })}
                                required
                                className={FIELD}
                            />
                        </div>
                        <div>
                            <label htmlFor="agenda-end" className={LABEL}>EIND (MAG LEEG)</label>
                            <input
                                id="agenda-end"
                                type="time"
                                value={v.endTime}
                                onChange={(e) => set({ endTime: e.target.value })}
                                className={FIELD}
                            />
                        </div>
                    </div>
                )}

                {timedKind && (
                    <div>
                        <label htmlFor="agenda-location" className={LABEL}>WAAR? (MAG LEEG)</label>
                        <input
                            id="agenda-location"
                            type="text"
                            value={v.location}
                            onChange={(e) => set({ location: e.target.value })}
                            maxLength={120}
                            autoComplete="off"
                            className={FIELD}
                        />
                    </div>
                )}

                <div>
                    <label htmlFor="agenda-note" className={LABEL}>NOTITIE (MAG LEEG)</label>
                    <textarea
                        id="agenda-note"
                        value={v.note}
                        onChange={(e) => set({ note: e.target.value })}
                        maxLength={2000}
                        rows={4}
                        className={TEXTAREA}
                    />
                </div>

                {event && v.kind === "afspraak" && (
                    <p className="text-neutral-500">Na opslaan moet {people.nameOf(people.otherOf(people.me))} het opnieuw zien en akkoord geven.</p>
                )}

                {shownError && <p role="alert" className="text-[#ff4d4d] uppercase">{shownError}</p>}

                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                        {busy ? "[ BEZIG... ]" : "[ OPSLAAN ]"}
                    </button>
                    <button type="button" onClick={onClose} className={BTN_PLAIN}>
                        [ANNULEREN]
                    </button>
                </div>
            </form>
        </AgendaSheet>
    );
}
