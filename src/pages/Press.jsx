import { useEffect, useState } from "react";
import { client } from "../sanityClient";

const STORAGE_KEY = "sisyfuz_pressed";
const COUNTER_ID = "site-button-counter";

// The Cloudflare Worker URL — update this after deploying the worker
const WORKER_URL = "https://sisyfuz-counter.sisyfuz.workers.dev";

export default function Press() {
    const [count, setCount] = useState(null);
    const [hasPressed, setHasPressed] = useState(false);
    const [pressing, setPressing] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        setHasPressed(!!localStorage.getItem(STORAGE_KEY));

        // Read the count from Sanity CDN (public, no token needed)
        client
            .fetch(`*[_id == "${COUNTER_ID}"][0].count`)
            .then((c) => setCount(c ?? 0))
            .catch(() => setCount(0));
    }, []);

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
            localStorage.setItem(STORAGE_KEY, "1");
            setHasPressed(true);
        } catch (err) {
            console.error(err);
            setError("Failed. Try again.");
        } finally {
            setPressing(false);
        }
    };

    const displayCount = count === null ? "—" : count;

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 font-mono">
            <div className="text-center space-y-10">
                <p className="text-white/25 text-[10px] tracking-[0.5em] uppercase">
                    {displayCount} {displayCount === 1 ? "person has" : "people have"} pressed this
                </p>

                <button
                    onClick={handlePress}
                    disabled={hasPressed || pressing}
                    className={[
                        "border px-14 py-5 text-xs tracking-[0.5em] uppercase transition-all duration-300",
                        hasPressed || pressing
                            ? "border-white/10 text-white/20 cursor-not-allowed"
                            : "border-white hover:border-pink-500 hover:text-pink-500 cursor-pointer",
                    ].join(" ")}
                >
                    {pressing ? "..." : hasPressed ? "pressed" : "press"}
                </button>

                {error && (
                    <p className="text-red-500/60 text-[10px] tracking-[0.3em] uppercase">
                        {error}
                    </p>
                )}

                {hasPressed && (
                    <p className="text-white/20 text-[10px] tracking-[0.4em] uppercase">
                        you already pressed this
                    </p>
                )}
            </div>
        </div>
    );
}
