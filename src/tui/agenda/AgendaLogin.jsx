// src/tui/agenda/AgendaLogin.jsx
import { useEffect, useRef, useState } from "react";
import { checkSetupCode, choosePassword, login } from "../../utils/agendaApi";
import { BTN, BTN_PRIMARY, BTN_PLAIN, FIELD, LABEL } from "./ui";

const MIN_PASSWORD_LENGTH = 10;

function formatWait(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) return `${Math.floor(m / 60)} UUR ${m % 60} MIN`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** Codes are 20 letters/digits shown as XXXX-XXXX-...; format while typing. */
function formatCode(raw) {
    const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
    return chars.match(/.{1,4}/g)?.join("-") ?? "";
}

// Lets password managers file the passphrase under one name.
function UsernameHint() {
    return (
        <input
            type="text"
            name="username"
            autoComplete="username"
            value="sisyfuz-agenda"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
        />
    );
}

function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, inputRef, disabled, describedBy, autoFocus }) {
    return (
        <div>
            <label htmlFor={id} className={LABEL}>{label}</label>
            <div className="flex items-stretch gap-x-[1ch]">
                <input
                    ref={inputRef}
                    id={id}
                    name={autoComplete === "new-password" ? "new-password" : "password"}
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoComplete={autoComplete}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    maxLength={256}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    autoFocus={autoFocus}
                    className={`${FIELD} flex-1 min-w-0`}
                />
                {onToggle && (
                    <button
                        type="button"
                        onClick={onToggle}
                        className={BTN_PLAIN}
                        aria-pressed={visible}
                        aria-label={visible ? "Verberg wachtwoord" : "Toon wachtwoord"}
                    >
                        [{visible ? "VERBERG" : "TOON"}]
                    </button>
                )}
            </div>
        </div>
    );
}

// Three steps on one screen, saying as little as possible to strangers:
//   login  – one field; the passphrase also says who is logging in.
//   code   – first time or forgot password: a one-time code from the admin.
//   choose – pick your own password; the worker keeps only a hash of it.
export default function AgendaLogin({ onLoggedIn, notice }) {
    const [step, setStep] = useState("login");
    const [passphrase, setPassphrase] = useState("");
    const [repeat, setRepeat] = useState("");
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(notice || "");
    const [lockedUntil, setLockedUntil] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const inputRef = useRef(null);

    const waitSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
    const locked = waitSeconds > 0;

    useEffect(() => {
        if (!lockedUntil) return undefined;
        const timer = setInterval(() => {
            const t = Date.now();
            setNow(t);
            if (t >= lockedUntil) {
                setLockedUntil(0);
                setError("");
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [lockedUntil]);

    const goTo = (next) => {
        setStep(next);
        setError("");
        setPassphrase("");
        setRepeat("");
        setVisible(false);
    };

    // Shared handling for wrong passwords, wrong codes and the lockout.
    const showError = (err, wrongText) => {
        if (err.status === 429 && err.data?.retryAfter) {
            setNow(Date.now());
            setLockedUntil(Date.now() + err.data.retryAfter * 1000);
            setError("TE VEEL VERKEERDE POGINGEN.");
        } else if (err.status === 401 && wrongText) {
            setError(wrongText);
            inputRef.current?.focus();
        } else {
            setError(err.message.toUpperCase());
        }
    };

    const run = async (e, action) => {
        e.preventDefault();
        if (busy || locked) return;
        setBusy(true);
        setError("");
        try {
            await action();
        } finally {
            setBusy(false);
        }
    };

    const submitLogin = (e) =>
        run(e, async () => {
            if (!passphrase.trim()) return;
            try {
                const data = await login(passphrase);
                setPassphrase("");
                onLoggedIn(data);
            } catch (err) {
                setPassphrase("");
                showError(err, "VERKEERD WACHTWOORD.");
            }
        });

    const submitCode = (e) =>
        run(e, async () => {
            if (code.replace(/-/g, "").length !== 20) {
                setError("EEN CODE HEEFT 20 TEKENS.");
                return;
            }
            try {
                const data = await checkSetupCode(code);
                setName(data.name);
                goTo("choose");
            } catch (err) {
                showError(err, "ONGELDIGE CODE.");
            }
        });

    const submitChoose = (e) =>
        run(e, async () => {
            if (passphrase.trim().length < MIN_PASSWORD_LENGTH) {
                setError(`KIES MINSTENS ${MIN_PASSWORD_LENGTH} TEKENS.`);
                return;
            }
            if (passphrase !== repeat) {
                setError("DE TWEE WACHTWOORDEN ZIJN NIET HETZELFDE.");
                return;
            }
            try {
                const data = await choosePassword(code, passphrase);
                setPassphrase("");
                setRepeat("");
                setCode("");
                onLoggedIn(data);
            } catch (err) {
                if (err.status === 401) {
                    goTo("code");
                    setError("ONGELDIGE CODE.");
                } else {
                    showError(err);
                }
            }
        });

    const errorBox = (
        <div id="agenda-login-error" role="alert" aria-live="assertive" className="min-h-[2lh] uppercase">
            {error && <p className={locked ? "text-[#f7e463]" : "text-[#ff4d4d]"}>{error}</p>}
            {locked && <p className="text-[#f7e463]">PROBEER HET OVER {formatWait(waitSeconds)} OPNIEUW.</p>}
        </div>
    );
    const describedBy = error ? "agenda-login-error" : undefined;

    if (step === "code") {
        return (
            <div className="max-w-[48ch] mx-auto pt-[2lh]">
                <h1 className="sr-only">Code</h1>
                <form onSubmit={submitCode} className="space-y-[1lh]" noValidate>
                    <div>
                        <label htmlFor="agenda-code" className={LABEL}>CODE</label>
                        <input
                            ref={inputRef}
                            id="agenda-code"
                            type="text"
                            value={code}
                            onChange={(e) => setCode(formatCode(e.target.value))}
                            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                            autoComplete="one-time-code"
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck="false"
                            enterKeyHint="next"
                            disabled={locked}
                            autoFocus
                            aria-describedby={describedBy}
                            className={`${FIELD} tracking-normal`}
                        />
                    </div>
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        <button type="submit" disabled={busy || locked || !code} className={BTN_PRIMARY}>
                            {busy ? "[ BEZIG... ]" : "[ VERDER → ]"}
                        </button>
                        <button type="button" onClick={() => goTo("login")} className={BTN_PLAIN}>[← TERUG]</button>
                    </div>
                    {errorBox}
                </form>
            </div>
        );
    }

    if (step === "choose") {
        const long = passphrase.trim().length >= MIN_PASSWORD_LENGTH;
        const same = repeat.length > 0 && passphrase === repeat;
        return (
            <div className="max-w-[48ch] mx-auto pt-[2lh]">
                <h1 className="font-bold uppercase text-white">HOI {name}!</h1>
                <p className="text-neutral-500 mb-[2lh]">Kies een wachtwoord. Alleen een hash wordt bewaard; niemand kan het terugzien.</p>
                <form onSubmit={submitChoose} className="space-y-[1lh]" noValidate>
                    <UsernameHint />
                    <PasswordField
                        id="agenda-new"
                        label="NIEUW WACHTWOORD"
                        value={passphrase}
                        onChange={setPassphrase}
                        visible={visible}
                        onToggle={() => setVisible((v) => !v)}
                        autoComplete="new-password"
                        inputRef={inputRef}
                        describedBy={describedBy}
                        autoFocus
                    />
                    <PasswordField
                        id="agenda-repeat"
                        label="NOG EEN KEER"
                        value={repeat}
                        onChange={setRepeat}
                        visible={visible}
                        autoComplete="new-password"
                        describedBy={describedBy}
                    />
                    <ul className="uppercase" aria-live="polite">
                        <li className={long ? "text-[#00ff66]" : "text-neutral-500"}>
                            <span className="cell">{long ? "✓" : "·"}</span> MINSTENS {MIN_PASSWORD_LENGTH} TEKENS ({passphrase.trim().length})
                        </li>
                        <li className={same ? "text-[#00ff66]" : "text-neutral-500"}>
                            <span className="cell">{same ? "✓" : "·"}</span> TWEE KEER HETZELFDE
                        </li>
                    </ul>
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        <button type="submit" disabled={busy || !long || !same} className={BTN_PRIMARY}>
                            {busy ? "[ BEZIG... ]" : "[ OPSLAAN & INLOGGEN ]"}
                        </button>
                        <button type="button" onClick={() => goTo("code")} className={BTN_PLAIN}>[← TERUG]</button>
                    </div>
                    {errorBox}
                </form>
            </div>
        );
    }

    return (
        <div className="max-w-[48ch] mx-auto pt-[2lh]">
            <h1 className="sr-only">Inloggen</h1>
            <form onSubmit={submitLogin} className="space-y-[1lh]" noValidate>
                <UsernameHint />
                <PasswordField
                    id="agenda-pass"
                    label="WACHTWOORD"
                    value={passphrase}
                    onChange={setPassphrase}
                    visible={visible}
                    onToggle={() => setVisible((v) => !v)}
                    autoComplete="current-password"
                    inputRef={inputRef}
                    disabled={locked}
                    autoFocus
                    describedBy={describedBy}
                />
                <button type="submit" disabled={busy || locked || !passphrase.trim()} className={`${BTN_PRIMARY} -ml-[1ch]`}>
                    {busy ? "[ BEZIG... ]" : "[ INLOGGEN → ]"}
                </button>
                {errorBox}
            </form>

            <button type="button" onClick={() => goTo("code")} className={`${BTN} -ml-[1ch] text-neutral-500 hover:bg-white hover:text-black`}>
                [CODE]
            </button>
        </div>
    );
}
