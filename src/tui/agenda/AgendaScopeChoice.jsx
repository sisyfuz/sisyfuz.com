// src/tui/agenda/AgendaScopeChoice.jsx
import { BTN_PLAIN, BTN_PRIMARY, BTN_RED } from "./ui";

// Which occurrences of a repeating item a change or delete is for. "Only this
// one" is left out when the repeat itself changed (`only` false), "this and
// following" on the first occurrence (`first`), where it means all of them.
export default function AgendaScopeChoice({ question, first = false, only = true, danger = false, busy, onPick, onCancel }) {
    const look = danger ? BTN_RED : BTN_PRIMARY;
    const choices = [
        only && { id: "deze", label: "ALLEEN DEZE" },
        !first && { id: "volgende", label: "DEZE EN VOLGENDE" },
        { id: "alle", label: "ALLEMAAL" },
    ].filter(Boolean);
    return (
        <div role="group" aria-label={question}>
            <p className="text-neutral-500 uppercase">{question}</p>
            <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                {choices.map((c) => (
                    <button key={c.id} type="button" disabled={busy} onClick={() => onPick(c.id)} className={look}>
                        {busy ? "[ BEZIG... ]" : `[${c.label}]`}
                    </button>
                ))}
                <button type="button" disabled={busy} onClick={onCancel} className={BTN_PLAIN}>
                    [ANNULEREN]
                </button>
            </div>
        </div>
    );
}
