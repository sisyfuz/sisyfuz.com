// src/tui/agenda/AgendaForm.jsx
import { useRef, useState } from "react";
import { WEEKDAYS_SHORT, nextWholeHour, weekdayIndex } from "../../utils/agendaDates";
import { BUSY_REASONS } from "../../utils/agendaBusy";
import { SPECIAL_TYPES } from "../../utils/agendaSpecial";
import { MAX_COUNT, PATTERNS, checkRule, firstOccurrence, moveDays, patternOf, ruleFrom } from "../../utils/agendaRepeat";
import AgendaChoice from "./AgendaChoice";
import AgendaScopeChoice from "./AgendaScopeChoice";
import AgendaSheet from "./AgendaSheet";
import AgendaStylePicker from "./AgendaStylePicker";
import { BTN, BTN_PRIMARY, BTN_PLAIN, FIELD, LABEL, TEXTAREA } from "./ui";

const KINDS = [
    { id: "afspraak", label: "AFSPRAAK" },
    { id: "onbeschikbaar", label: "ONBESCHIKBAAR" },
    { id: "bijzonder", label: "★ BIJZONDERE DAG" },
    { id: "periode", label: "░ PERIODE" },
];
const SPECIAL_IDS = Object.keys(SPECIAL_TYPES);
const ENDS = [
    { id: "nooit", label: "NOOIT" },
    { id: "datum", label: "TOT EN MET" },
    { id: "keer", label: "AANTAL KEER" },
];
const DEFAULT_COUNT = "10";

// The repeat part of the form's values, from a stored rule (or none).
function repeatValues(rule, startDate) {
    return {
        pattern: patternOf(rule),
        days: rule?.days ?? [weekdayIndex(startDate)],
        end: rule?.until ? "datum" : rule?.count ? "keer" : "nooit",
        until: rule?.until ?? "",
        count: rule?.count ? String(rule.count) : DEFAULT_COUNT,
    };
}

const ruleOf = (v) => ruleFrom(v.pattern, v.days, { end: v.end, until: v.until, count: Number(v.count) });

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
            ...repeatValues(event.rule, event.startDate),
            style: { color: event.color || "", logoId: event.logoId || null, logoSize: event.logoSize || "" },
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
        ...repeatValues(null, date),
        style: { color: "", logoId: null, logoSize: "" },
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
    if ((v.kind === "afspraak" || v.kind === "onbeschikbaar") && v.pattern !== "niet") {
        if (v.end === "datum" && !v.until) return "Kies tot wanneer het herhaalt.";
        if (v.end === "keer" && !/^\d+$/.test(v.count)) return `Herhaal 1 tot ${MAX_COUNT} keer.`;
        const rule = checkRule(ruleOf(v), v.startDate, multi ? v.endDate : v.startDate);
        if (rule.error) return rule.error;
    }
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

export default function AgendaForm({ event, date, kind = "afspraak", people, stickers, busy, error, onClose, onSave, onStudio }) {
    const [v, setV] = useState(() => initialValues(event, date, kind, people.me));
    // What the item looked like when the form opened, minus colour and logo: only a
    // change there asks for akkoord again.
    const contentOf = ({ style, ...content }) => JSON.stringify(content); // eslint-disable-line no-unused-vars
    const startContent = useRef(contentOf(v));
    const [localError, setLocalError] = useState("");
    // A changed occurrence of a series asks which ones it is for before saving.
    const [askScope, setAskScope] = useState(null);
    const set = (patch) => {
        setAskScope(null);
        setV((prev) => ({ ...prev, ...patch }));
    };

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
        const rule = timedKind ? ruleOf(v) : null;
        const payload = {
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
            color: v.style.color,
            logoId: v.style.logoId,
            logoSize: v.style.logoId ? v.style.logoSize || "klein" : "",
            rule,
            ...(event ? { version: event.version, contentChanged: contentOf(v) !== startContent.current } : {}),
        };
        if (!event?.rule || !payload.contentChanged) {
            onSave(payload);
            return;
        }
        // "Only this one" can keep its own times and text, not its own repeat;
        // from the first occurrence on, "this and following" is all of them.
        const scope = {
            only: JSON.stringify(rule) === JSON.stringify(event.rule),
            first: event.occurrenceDate <= firstOccurrence({ ...event, startDate: event.seriesStart }),
        };
        if (!scope.only && scope.first) onSave({ ...payload, scope: "alle" });
        else setAskScope({ payload, ...scope });
    };

    const forOptions = [...people.ids, "samen"].map((id) => ({ id, label: people.nameOf(id) }));
    const shownError = localError || error;
    // A picture made from here becomes the logo right away.
    const newLogo = (sticker) => setV((prev) => ({ ...prev, style: { ...prev.style, logoId: sticker.id, logoSize: prev.style.logoSize || "klein" } }));
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
                            // A weekly repeat on the old date's weekday moves to the new one.
                            const days = startDate && v.startDate ? moveDays(v.days, v.startDate, startDate) : v.days;
                            set({ startDate, endDate: v.endDate < startDate ? startDate : v.endDate, days });
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
                    <fieldset>
                        <legend className={LABEL}>HERHALEN</legend>
                        <AgendaChoice options={PATTERNS} value={v.pattern} onChange={(pattern) => set({ pattern })} />
                        {(v.pattern === "week" || v.pattern === "2weken") && <p className={LABEL}>OP WELKE DAGEN?</p>}
                        {(v.pattern === "week" || v.pattern === "2weken") && (
                            <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]" role="group" aria-label="Op welke dagen">
                                {WEEKDAYS_SHORT.map((label, d) => {
                                    const on = v.days.includes(d);
                                    return (
                                        <button
                                            key={label}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() => set({ days: on ? v.days.filter((x) => x !== d) : [...v.days, d].sort((a, b) => a - b) })}
                                            className={`${BTN} ${on ? "bg-white text-black font-bold" : "text-neutral-400 hover:bg-white hover:text-black"}`}
                                        >
                                            [{label}]
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {v.pattern !== "niet" && (
                            <>
                                <p className={LABEL}>STOPT</p>
                                <AgendaChoice options={ENDS} value={v.end} onChange={(end) => set({ end, until: end === "datum" && !v.until ? v.startDate : v.until })} />
                                {v.end === "datum" && (
                                    <input
                                        type="date"
                                        aria-label="Laatste keer op of voor"
                                        value={v.until}
                                        min={v.startDate}
                                        onChange={(e) => set({ until: e.target.value })}
                                        className={FIELD}
                                    />
                                )}
                                {v.end === "keer" && (
                                    <div className="flex items-center gap-x-[1ch]">
                                        <div className="w-[7ch] shrink-0">
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                aria-label="Hoe vaak"
                                                value={v.count}
                                                onChange={(e) => set({ count: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                                                className={FIELD}
                                            />
                                        </div>
                                        <span className="text-neutral-400 uppercase">KEER (MAX. {MAX_COUNT})</span>
                                    </div>
                                )}
                            </>
                        )}
                    </fieldset>
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

                <AgendaStylePicker
                    value={v.style}
                    onChange={(style) => set({ style })}
                    stickers={stickers}
                    onDraw={() => onStudio("editor", newLogo)}
                    onImport={() => onStudio("import", newLogo)}
                />

                {event && v.kind === "afspraak" && (
                    <p className="text-neutral-500">Na opslaan moet {people.nameOf(people.otherOf(people.me))} het opnieuw zien en akkoord geven (niet als je alleen kleur of logo verandert).</p>
                )}

                {shownError && <p role="alert" className="text-[#ff4d4d] uppercase">{shownError}</p>}

                {askScope ? (
                    <AgendaScopeChoice
                        question="WELKE WIL JE AANPASSEN?"
                        only={askScope.only}
                        first={askScope.first}
                        busy={busy}
                        onPick={(scope) => onSave({ ...askScope.payload, scope })}
                        onCancel={() => setAskScope(null)}
                    />
                ) : (
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                            {busy ? "[ BEZIG... ]" : "[ OPSLAAN ]"}
                        </button>
                        <button type="button" onClick={onClose} className={BTN_PLAIN}>
                            [ANNULEREN]
                        </button>
                    </div>
                )}
            </form>
        </AgendaSheet>
    );
}
