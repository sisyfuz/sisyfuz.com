// src/components/TermScrollSnap.jsx
import { useLayoutEffect, useRef, useState } from "react";
import { useTermCell } from "../hooks/useTermCell";

// One invisible scroll-snap point per text row of the parent, so the page always
// comes to rest on a whole row and lines up with overlays fixed to viewport rows.
export default function TermScrollSnap() {
    const cell = useTermCell();
    const railRef = useRef(null);
    const [rows, setRows] = useState(0);

    useLayoutEffect(() => {
        const parent = railRef.current?.parentElement;
        if (!parent) return;
        // ResizeObserver also fires once right after observe(), which sets the first count
        const observer = new ResizeObserver(() => {
            setRows(Math.ceil(parent.offsetHeight / cell.h));
        });
        observer.observe(parent);
        return () => observer.disconnect();
    }, [cell.h]);

    return (
        <div ref={railRef} aria-hidden="true" className="term-snap-rail">
            {Array.from({ length: rows }, (_, i) => <div key={i} />)}
        </div>
    );
}
