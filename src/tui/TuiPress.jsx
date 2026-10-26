// src/tui/TuiPress.jsx
import { useEffect, useState } from "react";
import { client } from "../sanityClient";
import { ASCII_DIVIDER } from "../utils/ascii";
import TuiLoadError from "./TuiLoadError";

const STORAGE_KEY = "sisyfuz_pressed";
const COUNTER_ID = "site-button-counter";
const WORKER_URL = "https://sisyfuz-counter.sisyfuz.workers.dev";

export default function TuiPress() {
    const [count, setCount] = useState(null);
    const [hasPressed, setHasPressed] = useState(false);
    const [pressing, setPressing] = useState(false);
    const [error, setError] = useState(null);
    const [countError, setCountError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        setHasPressed(!!localStorage.getItem(STORAGE_KEY));
    }, []);

    useEffect(() => {
        let cancelled = false;
        setCountError(false);
        client
            .fetch(`*[_id == "${COUNTER_ID}"][0].count`)
            .then((c) => {
                if (!cancelled) setCount(c ?? 0);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Error fetching attempt counter:", err);
                setCountError(true);
            });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const handlePress = async () => {
        if (hasPressed || pressing) return;
        setPressing(true);
        setError(null);

        try {
            const res = await fetch(WORKER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            if (!res.ok) throw new Error("Worker error");
            const data = await res.json();
            setCount(data.count);
            setCountError(false);
            localStorage.setItem(STORAGE_KEY, "1");
            setHasPressed(true);
        } catch (err) {
            console.error(err);
            setError("ERR: COULD NOT REGISTER ATTEMPT. TRY AGAIN.");
        } finally {
            setPressing(false);
        }
    };

    const displayCount = count === null ? "..." : count;

    return (
        <div className="space-y-6 max-w-3xl animate-fadeIn text-xs sm:text-[13px] leading-relaxed">
            <div className="space-y-2">
                <span className="font-bold uppercase text-white block">
                    ATTEMPT_COUNTER // METRIC
                </span>
                <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>
                {countError ? (
                    <TuiLoadError
                        label="COULD_NOT_LOAD_COUNTER"
                        onRetry={() => setReloadKey(k => k + 1)}
                        className=""
                    />
                ) : (
                    <p className="text-neutral-400 uppercase">
                        TOTAL_RECORDED_ATTEMPTS: <span className="text-white font-bold">[{displayCount}]</span>
                    </p>
                )}
            </div>

            <div>
                <button
                    onClick={handlePress}
                    disabled={hasPressed || pressing}
                    className={`uppercase font-bold transition-none py-1.5 px-3 -ml-3 cursor-pointer ${
                        hasPressed || pressing
                            ? "text-neutral-600 cursor-not-allowed"
                            : "text-white hover:bg-white hover:text-black"
                    }`}
                >
                    {pressing ? "[REGISTERING_ATTEMPT...]" : hasPressed ? "[ATTEMPT_REGISTERED]" : "[EXECUTE_ATTEMPT →]"}
                </button>
            </div>

            {error && (
                <p className="text-pink-500 uppercase">{error}</p>
            )}
        </div>
    );
}
