// src/tui/agenda/AgendaImport.jsx
import { useState } from "react";
import { daysBetween, formatDayShort, timeLabel } from "../../utils/agendaDates";
import { BUSY_REASONS } from "../../utils/agendaBusy";
import { SPECIAL_TYPES } from "../../utils/agendaSpecial";
import AgendaChoice from "./AgendaChoice";
import AgendaSheet from "./AgendaSheet";
import { BTN, BTN_PRIMARY, BTN_PLAIN, FIELD, LABEL } from "./ui";

const BATCH = 200;
const PREVIEW_LIMIT = 300;
const MAX_SPAN_DAYS = 366;

// Preview of a parsed .ics file: pick who it is for, how it shows up, and which
// items to bring in. Importing the same file again only updates what changed.
export default function AgendaImport({ parsed, today, people, onImport, onClose }) {
    const [kind, setKind] = useState(parsed.kind || "onbeschikbaar");
    const [specialKind, setSpecialKind] = useState(parsed.specialKind || "anders");
    const [reason, setReason] = useState(parsed.reason || "");
    const [forWho, setForWho] = useState(people.me);
    const [includePast, setIncludePast] = useState(false);
    const [excluded, setExcluded] = useState(() => new Set());
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");

    const usable = parsed.items.filter((e) => daysBetween(e.startDate, e.endDate) <= MAX_SPAN_DAYS);
    const tooLong = parsed.items.length - usable.length;
    const visible = usable.filter((e) => includePast || e.endDate >= today);
    const selected = visible.filter((e) => !excluded.has(e.uid));
    const busyKind = kind === "onbeschikbaar";
    const reasonIsPreset = BUSY_REASONS.includes(reason.trim().toLowerCase());
    const working = progress !== null && !result;

    const toggle = (uid) =>
        setExcluded((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });

    const run = async () => {
        if (busyKind && !reason.trim()) {
            setError("KIES OF TYP EEN REDEN.");
            return;
        }
        setError("");
        const payload = selected.map((e) => ({
            uid: e.uid,
            kind,
            reason: busyKind ? reason.trim().toLowerCase() : kind === "bijzonder" ? specialKind : "",
            // Repeats were already expanded per year by the parser.
            repeat: "",
            countYears: false,
            title: e.title,
            forWho,
            startDate: e.startDate,
            endDate: e.endDate,
            allDay: e.allDay,
            startTime: e.startTime,
            endTime: e.endTime,
            location: e.location,
            note: e.note,
        }));
        const total = { added: 0, updated: 0, unchanged: 0 };
        setProgress(0);
        try {
            for (let i = 0; i < payload.length; i += BATCH) {
                const r = await onImport(payload.slice(i, i + BATCH));
                total.added += r.added;
                total.updated += r.updated;
                total.unchanged += r.unchanged;
                setProgress(Math.min(payload.length, i + BATCH));
            }
            setResult(total);
        } catch (err) {
            setError(err.message.toUpperCase());
            setProgress(null);
        }
    };

    if (result) {
        return (
            <AgendaSheet title="GEÏMPORTEERD" onClose={onClose}>
                <p className="text-[#00ff66] uppercase">
                    <span className="cell">✓</span> {result.added} NIEUW · {result.updated} BIJGEWERKT · {result.unchanged} AL AANWEZIG
                </p>
                <button type="button" onClick={onClose} className={`${BTN_PLAIN} -ml-[1ch] mt-[1lh]`}>[SLUITEN]</button>
            </AgendaSheet>
        );
    }

    return (
        <AgendaSheet title="IMPORTEREN" onClose={onClose}>
            <div className="space-y-[1lh]">
                <p className="text-neutral-300">
                    <span className="text-white">{parsed.label}</span> · {usable.length} {usable.length === 1 ? "item" : "items"} gevonden
                    {parsed.cancelled > 0 && <span className="text-neutral-500"> · {parsed.cancelled} vervallen overgeslagen</span>}
                    {tooLong > 0 && <span className="text-neutral-500"> · {tooLong} langer dan een jaar overgeslagen</span>}
                    {parsed.truncated && <span className="text-[#f7e463]"> · ingekort tot de eerste 3000</span>}
                </p>

                <fieldset>
                    <legend className={LABEL}>ALS</legend>
                    <AgendaChoice
                        options={[
                            { id: "onbeschikbaar", label: "ONBESCHIKBAAR" },
                            { id: "afspraak", label: "AFSPRAKEN" },
                            { id: "periode", label: "░ PERIODES" },
                            { id: "bijzonder", label: "★ BIJZONDERE DAGEN" },
                        ]}
                        value={kind}
                        onChange={setKind}
                    />
                </fieldset>

                {kind === "periode" && (
                    <p className="text-neutral-500">Elk item wordt een zone van hele dagen, zoals een vakantie.</p>
                )}

                {kind === "bijzonder" && (
                    <fieldset>
                        <legend className={LABEL}>WAT VOOR DAGEN?</legend>
                        <AgendaChoice
                            options={Object.entries(SPECIAL_TYPES).map(([id, t]) => ({ id, label: `${t.glyph} ${t.label}` }))}
                            value={specialKind}
                            onChange={setSpecialKind}
                            colorOf={(id) => SPECIAL_TYPES[id].color}
                        />
                    </fieldset>
                )}

                {busyKind && (
                    <fieldset>
                        <legend className={LABEL}>WAAROM?</legend>
                        <AgendaChoice options={BUSY_REASONS.map((r) => ({ id: r, label: r.toUpperCase() }))} value={reason.trim().toLowerCase()} onChange={setReason} />
                        <input
                            type="text"
                            aria-label="Andere reden"
                            value={reasonIsPreset ? "" : reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={40}
                            placeholder="of typ zelf een reden…"
                            autoComplete="off"
                            className={FIELD}
                        />
                    </fieldset>
                )}

                <fieldset>
                    <legend className={LABEL}>{kind === "afspraak" ? "VOOR WIE?" : kind === "bijzonder" ? "HOORT BIJ" : "WIE?"}</legend>
                    <AgendaChoice
                        options={[...people.ids, "samen"].map((id) => ({ id, label: people.nameOf(id) }))}
                        value={forWho}
                        onChange={setForWho}
                        colorOf={people.colorOf}
                    />
                </fieldset>

                <div className="flex flex-wrap items-center gap-x-[1ch] -ml-[1ch]">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={includePast}
                        onClick={() => setIncludePast((p) => !p)}
                        className={`${BTN} ${includePast ? "text-white" : "text-neutral-400"} hover:bg-white hover:text-black`}
                    >
                        [<span className="cell">{includePast ? "x" : " "}</span>] OOK VERLEDEN ITEMS
                    </button>
                    <button type="button" onClick={() => setExcluded(new Set())} className={BTN_PLAIN}>[ALLES]</button>
                    <button type="button" onClick={() => setExcluded(new Set(visible.map((e) => e.uid)))} className={BTN_PLAIN}>[NIETS]</button>
                </div>

                <ul aria-label="Items om te importeren" className="border-y border-[#262626]">
                    {visible.slice(0, PREVIEW_LIMIT).map((e) => {
                        const on = !excluded.has(e.uid);
                        return (
                            <li key={e.uid}>
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={on}
                                    onClick={() => toggle(e.uid)}
                                    className={`flex gap-x-[1ch] w-full min-h-[2lh] items-center text-left cursor-pointer transition-none hover:bg-[#141414] ${on ? "" : "opacity-40"}`}
                                >
                                    <span className="shrink-0">[<span className="cell">{on ? "x" : " "}</span>]</span>
                                    <span className="shrink-0 uppercase text-neutral-400 w-[10ch]">{formatDayShort(e.startDate)}</span>
                                    <span className="shrink-0 text-neutral-400 w-[11ch]">{timeLabel(e, e.startDate)}</span>
                                    <span className="min-w-0 truncate text-white">{e.title}</span>
                                </button>
                            </li>
                        );
                    })}
                    {visible.length > PREVIEW_LIMIT && (
                        <li className="text-neutral-500 uppercase min-h-[2lh] flex items-center">+ {visible.length - PREVIEW_LIMIT} MEER</li>
                    )}
                    {visible.length === 0 && <li className="text-neutral-500 uppercase min-h-[2lh] flex items-center">NIKS TE IMPORTEREN</li>}
                </ul>

                {error && <p role="alert" className="text-[#ff4d4d] uppercase">{error}</p>}

                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="button" onClick={run} disabled={working || selected.length === 0} className={BTN_PRIMARY}>
                        {working ? `[ BEZIG... ${progress}/${selected.length} ]` : `[ IMPORTEER ${selected.length} ]`}
                    </button>
                    <button type="button" onClick={onClose} disabled={working} className={BTN_PLAIN}>[ANNULEREN]</button>
                </div>
            </div>
        </AgendaSheet>
    );
}
