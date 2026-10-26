// src/tui/TuiLoadError.jsx
// Error line shown when a Sanity fetch fails, styled like the loading text,
// with a [RETRY] button that asks the parent to refetch.
export default function TuiLoadError({ label, onRetry, className = "py-20" }) {
    return (
        <div
            role="alert"
            className={`${className} font-mono text-xs uppercase tracking-widest text-neutral-500 flex flex-wrap items-center gap-x-4 gap-y-2`}
        >
            <span>[ ERROR: {label} ]</span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="text-white font-bold hover:bg-white hover:text-black px-1 -mx-1 cursor-pointer transition-none"
                >
                    [RETRY]
                </button>
            )}
        </div>
    );
}
