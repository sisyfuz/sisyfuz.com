// src/tui/TuiLoadError.jsx
// Error line shown when a Sanity fetch fails, styled like the loading text,
// with a [RETRY] button that asks the parent to refetch.
export default function TuiLoadError({ label, onRetry, className = "py-[4lh]" }) {
    return (
        <div
            role="alert"
            className={`${className} font-mono uppercase text-neutral-500 flex flex-wrap items-center gap-x-[2ch]`}
        >
            <span>[ ERROR: {label} ]</span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="text-white font-bold hover:bg-white hover:text-black cursor-pointer transition-none"
                >
                    [RETRY]
                </button>
            )}
        </div>
    );
}
