// src/tui/agenda/PixelEditor.jsx
import { useEffect, useRef, useState } from "react";
import { clonePixels, createPixels, isBlank, MAX_NAME_LENGTH, shrinkPixels, SMALL_SIZE, STICKER_SIZE } from "../../utils/agendaPixelFormat";
import {
    brushPoints,
    BRUSH_SIZES,
    canRedo,
    canUndo,
    commitHistory,
    createHistory,
    drawLine,
    floodFill,
    flipHorizontal,
    getPixel,
    hexToRgba,
    inBounds,
    mirrorX,
    redoHistory,
    rgbaToHex,
    samePixels,
    stamp,
    TRANSPARENT,
    undoHistory,
} from "../../utils/agendaPixels";
import AgendaChoice from "./AgendaChoice";
import AgendaSheet from "./AgendaSheet";
import { BTN_ACTIVE, BTN_PLAIN, BTN_PRIMARY, FIELD, LABEL } from "./ui";

// Both person colours, the agenda green, white to black, then colours that stay
// readable on the black page and the dark cards.
const PALETTE = [
    "#ff6fae", "#ff9f43", "#00ff66", "#ffffff", "#b3b3b3", "#737373", "#3d3d3d", "#000000",
    "#ff4d4d", "#a3172e", "#f7e463", "#b8ff3d", "#1f8a4c", "#1fbfa3", "#3de0ff", "#4d7cff",
    "#2a3d8f", "#b26bff", "#ff3df0", "#ffcf9e", "#a8673a",
];
const TOOLS = [
    { id: "pen", label: "✎ PEN" },
    { id: "gum", label: "░ GUM" },
    { id: "vul", label: "▚ VUL" },
    { id: "pipet", label: "◉ PIPET" },
];
// Empty pixels: a dark checkerboard, one square per art pixel, so you can count
// pixels without grid lines.
const CHECKER = [[0x14, 0x14, 0x14], [0x1c, 0x1c, 0x1c]];
const ERASE_PREVIEW = [0x44, 0x44, 0x44, 255];
// A swatch is a 3 rows tall touch target: the colour fills the top two, the
// bottom row lights up on hover and focus.
const SWATCH =
    "cursor-pointer select-none shrink-0 h-[3lh] flex items-start hover:bg-[#262626] focus-visible:outline-none focus-visible:bg-white has-[:focus-visible]:bg-white has-[:focus-visible]:text-black";
const MAX_ZOOM = 8;
const MIN_ZOOM = 2;

function startDoc(initial) {
    const big = initial?.pixels ? clonePixels(initial.pixels) : createPixels(STICKER_SIZE);
    const auto = shrinkPixels(big, SMALL_SIZE);
    const small = initial?.smallPixels ? clonePixels(initial.smallPixels) : auto;
    // A small version that differs from the shrunk big one was drawn by hand.
    return { big, small, smallOwn: !samePixels(small, auto) };
}

// The big picture changed: the small one follows unless it was drawn by hand.
function withBig(doc, big) {
    return { big, small: doc.smallOwn ? doc.small : shrinkPixels(big, SMALL_SIZE), smallOwn: doc.smallOwn };
}

function render(canvas, pixels, preview) {
    if (!canvas) return;
    const { size, data } = pixels;
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const out = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            if (data[i + 3]) {
                out[i] = data[i];
                out[i + 1] = data[i + 1];
                out[i + 2] = data[i + 2];
            } else {
                const c = CHECKER[(x + y) & 1];
                out[i] = c[0];
                out[i + 1] = c[1];
                out[i + 2] = c[2];
            }
            out[i + 3] = 255;
        }
    }
    if (preview) {
        const { points, rgba, mix } = preview;
        for (const [x, y] of points) {
            const i = (y * size + x) * 4;
            for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] * (1 - mix) + rgba[c] * mix);
        }
    }
    ctx.putImageData(img, 0, 0);
}

// Black or white, whichever reads on top of `hex`.
function inkOn(hex) {
    const [r, g, b] = hexToRgba(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
}

// The "STICKER MAKEN" sheet: draw a 64x64 picture and, if you like, its 16x16
// small version by hand. The canvas is scaled up by a whole zoom, as large as the
// column allows, inside a block of whole cells.
export default function PixelEditor({ initial, busy, error, onSave, onClose }) {
    const [history, setHistory] = useState(() => createHistory(startDoc(initial)));
    const [name, setName] = useState(initial?.name ?? "");
    const [mode, setMode] = useState("groot");
    const [tool, setTool] = useState("pen");
    const [brush, setBrush] = useState(1);
    const [mirror, setMirror] = useState(false);
    const [color, setColor] = useState(PALETTE[0]);
    const [custom, setCustom] = useState("#8a5cff");
    const [zoom, setZoom] = useState(5);
    const [localError, setLocalError] = useState("");
    const boxRef = useRef(null);
    const canvasRef = useRef(null);
    // The stroke in progress ({ id, tool, last, work }) and the hovered pixel live
    // outside state: they change on every pointer move and only touch the canvas.
    const stroke = useRef(null);
    const hover = useRef(null);

    const doc = history.present;
    const small = mode === "klein";
    const target = small ? doc.small : doc.big;
    const size = target.size;
    // The small picture is shown 4x bigger, so both fill the same block.
    const scale = small ? zoom * (STICKER_SIZE / SMALL_SIZE) : zoom;
    const px = size * scale;
    const paintColor = tool === "gum" ? TRANSPARENT : hexToRgba(color);

    const previewAt = (point, drawing) => {
        if (!point || !inBounds(target, point[0], point[1])) return null;
        const [x, y] = point;
        if (tool === "pen" || tool === "gum") {
            return { points: brushPoints(size, x, y, brush, mirror), rgba: tool === "gum" ? ERASE_PREVIEW : paintColor, mix: drawing ? 1 : 0.5 };
        }
        const points = tool === "vul" && mirror && mirrorX(size, x) !== x ? [[x, y], [mirrorX(size, x), y]] : [[x, y]];
        return { points, rgba: tool === "pipet" ? [255, 255, 255, 255] : hexToRgba(color), mix: drawing ? 0.75 : 0.5 };
    };

    const redraw = () => {
        const s = stroke.current;
        render(canvasRef.current, s?.work ?? target, previewAt(s ? s.last : hover.current, Boolean(s)));
    };

    useEffect(() => redraw());

    // Largest whole zoom at which the 64 pixels fit the column.
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            const fit = Math.floor(entry.contentRect.width / STICKER_SIZE);
            setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const commit = (pixels) =>
        setHistory((h) =>
            commitHistory(h, small ? { ...h.present, small: pixels, smallOwn: true } : withBig(h.present, pixels)),
        );

    const undo = () => !stroke.current && setHistory(undoHistory);
    const redo = () => !stroke.current && setHistory(redoHistory);

    useEffect(() => {
        const onKey = (e) => {
            if (!(e.metaKey || e.ctrlKey) || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
            const key = e.key.toLowerCase();
            if (key === "z" || key === "y") {
                e.preventDefault();
                if (stroke.current) return;
                setHistory(key === "y" || e.shiftKey ? redoHistory : undoHistory);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const pixelOf = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return [Math.floor(((e.clientX - rect.left) * size) / rect.width), Math.floor(((e.clientY - rect.top) * size) / rect.height)];
    };

    const onPointerDown = (e) => {
        if (stroke.current || e.button > 0) return;
        const point = pixelOf(e);
        if (!inBounds(target, point[0], point[1])) return;
        e.preventDefault();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // the pointer is already gone
        }
        setLocalError("");
        const s = { id: e.pointerId, tool, last: point, work: null };
        if (tool === "pen" || tool === "gum") {
            s.work = clonePixels(target);
            stamp(s.work, point[0], point[1], paintColor, brush, mirror);
        }
        stroke.current = s;
        hover.current = point;
        redraw();
    };

    const onPointerMove = (e) => {
        const s = stroke.current;
        if (s && s.id !== e.pointerId) return;
        // Coalesced events keep curves round on fast moves; the line between them
        // closes any gap that is left.
        const events = s?.work ? (e.nativeEvent.getCoalescedEvents?.() ?? []) : [];
        for (const ev of events.length ? events : [e]) {
            const point = pixelOf(ev);
            if (s?.work) drawLine(s.work, s.last[0], s.last[1], point[0], point[1], paintColor, brush, mirror);
            if (s) s.last = point;
            hover.current = point;
        }
        redraw();
    };

    const endStroke = (e, cancelled) => {
        const s = stroke.current;
        if (!s || s.id !== e.pointerId) return;
        stroke.current = null;
        if (e.pointerType !== "mouse") hover.current = null;
        const [x, y] = s.last;
        if (s.work) {
            commit(s.work);
        } else if (!cancelled && inBounds(target, x, y)) {
            if (s.tool === "vul") {
                commit(floodFill(clonePixels(target), x, y, paintColor, mirror));
            } else {
                const picked = getPixel(target, x, y);
                if (picked[3]) {
                    setColor(rgbaToHex(picked));
                    setTool("pen");
                } else {
                    setTool("gum");
                }
            }
        }
        redraw();
    };

    const onPointerLeave = () => {
        hover.current = null;
        if (!stroke.current) redraw();
    };

    const pickColor = (hex) => {
        setColor(hex);
        if (tool === "gum" || tool === "pipet") setTool("pen");
    };

    const clearAll = () => commit(createPixels(size));
    const flip = () => commit(flipHorizontal(target));
    const remake = () => setHistory((h) => commitHistory(h, { ...h.present, small: shrinkPixels(h.present.big, SMALL_SIZE), smallOwn: false }));

    const save = () => {
        if (isBlank(doc.big)) {
            setLocalError("TEKEN EERST IETS.");
            return;
        }
        onSave({ name: name.trim().slice(0, MAX_NAME_LENGTH), pixels: doc.big, smallPixels: doc.small });
    };

    const shownError = localError || error;
    const smallNote = !small
        ? null
        : doc.smallOwn
        ? "ZELF GETEKEND: VOLGT GROOT NIET MEER."
        : isBlank(doc.small) && !isBlank(doc.big)
        ? "TE DUN VOOR KLEIN: TEKEN HEM HIER ZELF."
        : "VOLGT GROOT VANZELF.";
    const toolBtn = (active) => (active ? BTN_ACTIVE : BTN_PLAIN);

    return (
        <AgendaSheet title={initial ? "STICKER BEWERKEN" : "STICKER MAKEN"} onClose={onClose} wide>
            <div className="space-y-[1lh]">
                <div>
                    <div className="flex flex-wrap gap-x-[1ch]">
                        <AgendaChoice
                            options={[
                                { id: "groot", label: `GROOT ${STICKER_SIZE}` },
                                { id: "klein", label: `KLEIN ${SMALL_SIZE}` },
                            ]}
                            value={mode}
                            onChange={setMode}
                        />
                        {small && doc.smallOwn && (
                            <button type="button" onClick={remake} className={BTN_PLAIN}>
                                [OPNIEUW MAKEN]
                            </button>
                        )}
                    </div>
                    {smallNote && <p className="text-neutral-500">{smallNote}</p>}
                </div>

                <div ref={boxRef} className="w-full">
                    <div
                        className="overflow-hidden"
                        style={{ width: `round(up, ${px}px, 1ch)`, height: `round(up, ${px}px, 1lh)` }}
                    >
                        <canvas
                            ref={canvasRef}
                            width={size}
                            height={size}
                            role="img"
                            aria-label={small ? "Tekenvlak, klein 16 bij 16" : "Tekenvlak, groot 64 bij 64"}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={(e) => endStroke(e, false)}
                            onPointerCancel={(e) => endStroke(e, true)}
                            onPointerLeave={onPointerLeave}
                            onContextMenu={(e) => e.preventDefault()}
                            className="block cursor-crosshair touch-none select-none [image-rendering:pixelated] [-webkit-touch-callout:none]"
                            style={{ width: px, height: px }}
                        />
                    </div>
                </div>

                <div>
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        {TOOLS.map((t) => (
                            <button key={t.id} type="button" aria-pressed={tool === t.id} onClick={() => setTool(t.id)} className={toolBtn(tool === t.id)}>
                                [{t.label}]
                            </button>
                        ))}
                        <button type="button" aria-pressed={mirror} onClick={() => setMirror((m) => !m)} className={toolBtn(mirror)}>
                            [<span className="cell">⇋</span> SPIEGEL]
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                        <button
                            type="button"
                            onClick={() => setBrush((b) => BRUSH_SIZES[(BRUSH_SIZES.indexOf(b) + 1) % BRUSH_SIZES.length])}
                            aria-label={`Penmaat ${brush}, tik voor de volgende`}
                            className={BTN_PLAIN}
                        >
                            [MAAT {brush}]
                        </button>
                        <button type="button" onClick={undo} disabled={!canUndo(history)} aria-label="Ongedaan maken" className={BTN_PLAIN}>
                            [↶]
                        </button>
                        <button type="button" onClick={redo} disabled={!canRedo(history)} aria-label="Opnieuw doen" className={BTN_PLAIN}>
                            [↷]
                        </button>
                        <button type="button" onClick={flip} disabled={isBlank(target)} className={BTN_PLAIN}>
                            [<span className="cell">⇄</span> OMKLAPPEN]
                        </button>
                        <button type="button" onClick={clearAll} disabled={isBlank(target)} className={BTN_PLAIN}>
                            [WIS ALLES]
                        </button>
                    </div>
                </div>

                <fieldset>
                    <legend className={LABEL}>KLEUR <span className="text-neutral-300">{color.toUpperCase()}</span></legend>
                    <div className="flex flex-wrap gap-x-[1ch]">
                        {PALETTE.map((hex) => {
                            const active = tool !== "gum" && color === hex;
                            return (
                                <button
                                    key={hex}
                                    type="button"
                                    aria-label={`Kleur ${hex}`}
                                    aria-pressed={active}
                                    onClick={() => pickColor(hex)}
                                    className={`${SWATCH} w-[3ch]`}
                                >
                                    <span className="block w-[3ch] h-[2lh] pl-[1ch]" style={{ backgroundColor: hex, color: inkOn(hex) }}>
                                        {active && <span className="cell">◆</span>}
                                    </span>
                                </button>
                            );
                        })}
                        <label className={`${SWATCH} gap-x-[1ch] text-neutral-300`}>
                            <input
                                type="color"
                                value={custom}
                                onChange={(e) => {
                                    setCustom(e.target.value);
                                    pickColor(e.target.value);
                                }}
                                aria-label="Eigen kleur"
                                className="block w-[3ch] h-[2lh] p-0 border-0 bg-transparent cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-none [&::-moz-color-swatch]:border-0"
                            />
                            <span>[+ KLEUR]</span>
                        </label>
                    </div>
                </fieldset>

                <div>
                    <label htmlFor="pixel-name" className={LABEL}>NAAM (MAG LEEG)</label>
                    <input
                        id="pixel-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={MAX_NAME_LENGTH}
                        placeholder="bijv. hartje, taart"
                        autoComplete="off"
                        className={FIELD}
                    />
                </div>

                {shownError && <p role="alert" className="text-[#ff4d4d] uppercase">{shownError}</p>}

                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                    <button type="button" onClick={save} disabled={busy} className={BTN_PRIMARY}>
                        {busy ? "[ BEZIG... ]" : "[ OPSLAAN ]"}
                    </button>
                    <button type="button" onClick={onClose} className={BTN_PLAIN}>
                        [ANNULEREN]
                    </button>
                </div>
            </div>
        </AgendaSheet>
    );
}
