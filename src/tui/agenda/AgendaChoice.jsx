// src/tui/agenda/AgendaChoice.jsx
import { BTN } from "./ui";

// A row of [OPTION] buttons; the chosen one is filled in, with the option's own
// color when `colorOf` gives one (people), white otherwise.
export default function AgendaChoice({ options, value, onChange, colorOf }) {
    return (
        <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
            {options.map(({ id, label }) => {
                const active = value === id;
                const color = colorOf?.(id);
                const look = active
                    ? `text-black font-bold ${color ? "" : "bg-white"}`
                    : color
                    ? "hover:bg-[#141414]"
                    : "text-neutral-300 hover:bg-white hover:text-black";
                return (
                    <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(id)}
                        className={`${BTN} ${look}`}
                        style={color ? (active ? { backgroundColor: color } : { color }) : undefined}
                    >
                        [{label}]
                    </button>
                );
            })}
        </div>
    );
}
