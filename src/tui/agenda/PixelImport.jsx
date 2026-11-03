// src/tui/agenda/PixelImport.jsx
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { MAX_NAME_LENGTH, SMALL_SIZE, STICKER_SIZE, isBlank, shrinkPixels } from "../../utils/agendaPixelFormat";
import {
    COLOUR_COUNTS,
    coverCrop,
    fileBaseName,
    fitCrop,
    isPixelArt,
    minCropSize,
    panCrop,
    snapCrop,
    svgRenderSize,
    toLibraryPixels,
    zoomCrop,
} from "../../utils/agendaResize";
import AgendaChoice from "./AgendaChoice";
import AgendaSheet from "./AgendaSheet";
import { BTN_PLAIN, BTN_PRIMARY, FIELD, LABEL } from "./ui";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|svg)$/i;
const isSvg = (file) => file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
// Photos are worked on at most this big: the bitmap is drawn down once, so every
// crop preview after that stays cheap. Pixel art keeps its own size (up to a
// limit) so it can shrink pixel for pixel.
const WORK_MAX = 1024;
const PIXEL_ART_MAX = 2048;
// Darkened picture around the crop square, in CSS px.
const VIEW_MARGIN = 16;
const ZOOM_STEP = 1.25;
const THRESHOLDS = [
    { id: 64, label: "25%" },
    { id: 128, label: "50%" },
    { id: 192, label: "75%" },
];

function imagesOf(list) {
    return [...(list ?? [])].filter((f) => ACCEPT.split(",").includes(f.type) || IMAGE_NAME.test(f.name));
}

function canvasOf(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

// An SVG goes through an <img> (so nothing in it runs or loads), with a fixed
// width and height set on its root first: many SVGs only have a viewBox, and
// then each browser picks its own size. It is drawn at svgRenderSize, sharp.
async function svgImage(file) {
    const doc = new window.DOMParser().parseFromString(await file.text(), "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("geen svg");
    const [width, height] = svgRenderSize({
        width: svg.getAttribute("width"),
        height: svg.getAttribute("height"),
        viewBox: svg.getAttribute("viewBox"),
    });
    if (!svg.getAttribute("viewBox")) {
        const w = Number.parseFloat(svg.getAttribute("width"));
        const h = Number.parseFloat(svg.getAttribute("height"));
        if (w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    const blob = new Blob([new window.XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image(width, height);
    img.src = url;
    try {
        await img.decode();
    } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    }
    return { img, url, width, height };
}

// Decodes once (createImageBitmap, or an <img> where that can't read the format;
// a GIF gives its first frame; an SVG is drawn big, see svgImage) and draws it
// onto a working canvas, which both the crop view and the shrinking read from.
async function decode(file) {
    let bitmap;
    let url = null;
    try {
        if (isSvg(file)) {
            const svg = await svgImage(file);
            bitmap = svg.img;
            url = svg.url;
            const canvas = canvasOf(svg.width, svg.height);
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0, svg.width, svg.height);
            const image = { width: svg.width, height: svg.height, data: ctx.getImageData(0, 0, svg.width, svg.height).data };
            return { canvas, image, pixelArt: false, width: svg.width, height: svg.height };
        }
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            url = URL.createObjectURL(file);
            bitmap = new Image();
            bitmap.src = url;
            await bitmap.decode();
        }
        const width = bitmap.naturalWidth || bitmap.width;
        const height = bitmap.naturalHeight || bitmap.height;
        if (!width || !height) throw new Error("leeg");

        const draw = (w, h) => {
            const canvas = canvasOf(w, h);
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(bitmap, 0, 0, w, h);
            return { canvas, image: { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data } };
        };
        let work = null;
        let pixelArt = false;
        if (width % STICKER_SIZE === 0 && height % STICKER_SIZE === 0 && Math.max(width, height) <= PIXEL_ART_MAX) {
            work = draw(width, height);
            pixelArt = isPixelArt(work.image);
        }
        const scale = Math.min(1, WORK_MAX / Math.max(width, height));
        if (!work || (!pixelArt && scale < 1)) {
            work = draw(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        }
        return { ...work, pixelArt, width, height };
    } finally {
        bitmap?.close?.();
        if (url) URL.revokeObjectURL(url);
    }
}

// Where the crop square sits in the view: as big as fits, in the middle.
function squareOf(view) {
    const side = Math.max(0, Math.min(view.width, view.height) - 2 * VIEW_MARGIN);
    return { x: (view.width - side) / 2, y: (view.height - side) / 2, side };
}

let checker = null;
function checkerPattern(ctx) {
    if (!checker) {
        checker = canvasOf(16, 16);
        const c = checker.getContext("2d");
        c.fillStyle = "#1e1e1e";
        c.fillRect(0, 0, 16, 16);
        c.fillStyle = "#2a2a2a";
        c.fillRect(0, 0, 8, 8);
        c.fillRect(8, 8, 8, 8);
    }
    return ctx.createPattern(checker, "repeat");
}

function paint(canvas, pixels) {
    if (!canvas || !pixels) return;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.size, pixels.size), 0, 0);
}

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Turns pictures into 64x64 library images, one at a time: pick a square crop
// (drag, pinch, wheel or [−] [+]), see it at real size, save or skip. Everything
// saved goes to `onSave` in one go at the end of the queue.
export default function PixelImport({ files, busy, error, onSave, onEdit, onClose }) {
    const [queue, setQueue] = useState(() => imagesOf(files));
    const [ignored, setIgnored] = useState(() => (files?.length ?? 0) - imagesOf(files).length);
    const [index, setIndex] = useState(0);
    const [results, setResults] = useState([]);
    // The decoded current file: { file, canvas, image, pixelArt, width, height } or { file, failed }.
    const [source, setSource] = useState(null);
    const [crop, setCrop] = useState(null);
    const [name, setName] = useState("");
    const [colours, setColours] = useState(0);
    const [threshold, setThreshold] = useState(128);
    const [view, setView] = useState(null);

    const pickerRef = useRef(null);
    const viewRef = useRef(null);
    const canvasRef = useRef(null);
    const bigRef = useRef(null);
    const smallRef = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    // What the pointer and wheel handlers need from the latest render.
    const live = useRef({});

    const file = queue[index];
    const hasFile = Boolean(file);
    const ready = source && source.file === file && !source.failed ? source : null;
    const failed = Boolean(source && source.file === file && source.failed);
    const done = queue.length > 0 && index >= queue.length;

    const shownCrop = useMemo(() => {
        if (!ready || !crop) return null;
        return ready.pixelArt ? snapCrop(crop, ready.image) : crop;
    }, [ready, crop]);
    // The preview may lag a frame behind while dragging; the crop view never does.
    const previewCrop = useDeferredValue(shownCrop);
    const options = { pixelArt: ready?.pixelArt, threshold, colours };
    const pixels = useMemo(
        () => (ready && previewCrop ? toLibraryPixels(ready.image, previewCrop, { pixelArt: ready.pixelArt, threshold, colours }) : null),
        [ready, previewCrop, threshold, colours]
    );
    const small = useMemo(() => (pixels ? shrinkPixels(pixels, SMALL_SIZE) : null), [pixels]);
    const blank = pixels ? isBlank(pixels) : false;

    useEffect(() => {
        if (!file) return;
        let cancelled = false;
        decode(file).then(
            (decoded) => {
                if (cancelled) return;
                setSource({ file, ...decoded });
                setCrop(coverCrop(decoded.image));
                setName(fileBaseName(file.name));
            },
            () => {
                if (!cancelled) setSource({ file, failed: true });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [file]);

    useEffect(() => {
        live.current = { ready, crop, view };
    });

    useEffect(() => {
        const el = viewRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setView({ width: el.clientWidth, height: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, [hasFile]);

    // The crop view: the picture with the crop square in the middle, the rest darkened.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !view) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(view.width * dpr);
        canvas.height = Math.round(view.height * dpr);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, view.width, view.height);
        if (!ready || !shownCrop) return;

        const sq = squareOf(view);
        const k = sq.side / shownCrop.size;
        ctx.fillStyle = checkerPattern(ctx);
        ctx.fillRect(sq.x, sq.y, sq.side, sq.side);
        ctx.imageSmoothingEnabled = !ready.pixelArt && k < 2;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(ready.canvas, sq.x - shownCrop.x * k, sq.y - shownCrop.y * k, ready.image.width * k, ready.image.height * k);
        ctx.fillStyle = "rgba(5, 5, 5, 0.72)";
        ctx.fillRect(0, 0, view.width, sq.y);
        ctx.fillRect(0, sq.y + sq.side, view.width, view.height - sq.y - sq.side);
        ctx.fillRect(0, sq.y, sq.x, sq.side);
        ctx.fillRect(sq.x + sq.side, sq.y, view.width - sq.x - sq.side, sq.side);
    }, [ready, shownCrop, view]);

    useEffect(() => {
        paint(bigRef.current, pixels);
        paint(smallRef.current, small);
    }, [pixels, small]);

    // Wheel zoom needs a non-passive listener to keep the sheet from scrolling.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const onWheel = (e) => {
            const { ready: r, view: v } = live.current;
            if (!r || !v) return;
            e.preventDefault();
            const sq = squareOf(v);
            const rect = canvas.getBoundingClientRect();
            const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            const factor = Math.exp(-delta * 0.002);
            setCrop((c) => {
                const k = sq.side / c.size;
                const cx = c.x + (e.clientX - rect.left - sq.x) / k;
                const cy = c.y + (e.clientY - rect.top - sq.y) / k;
                return zoomCrop(c, factor, cx, cy, r.image, minCropSize(r.image, r.pixelArt));
            });
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
    }, [hasFile]);

    const pointOf = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    // Every finger that lands or lifts restarts the gesture from the crop as it is.
    const restartGesture = () => {
        const pts = [...pointers.current.values()];
        gesture.current = pts.length ? { crop: live.current.crop, pts } : null;
    };
    const onPointerDown = (e) => {
        if (!live.current.ready) return;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // pointer already gone
        }
        pointers.current.set(e.pointerId, pointOf(e));
        restartGesture();
    };
    const onPointerMove = (e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, pointOf(e));
        const g = gesture.current;
        const { ready: r, view: v } = live.current;
        if (!g || !r || !v) return;
        const pts = [...pointers.current.values()];
        const sq = squareOf(v);
        const k = sq.side / g.crop.size;
        const min = minCropSize(r.image, r.pixelArt);
        if (pts.length === 1 || g.pts.length === 1) {
            // Dragging moves the picture under the square.
            setCrop(panCrop(g.crop, -(pts[0].x - g.pts[0].x) / k, -(pts[0].y - g.pts[0].y) / k, r.image, min));
            return;
        }
        const mid0 = midpoint(g.pts[0], g.pts[1]);
        const mid1 = midpoint(pts[0], pts[1]);
        const factor = distance(pts[0], pts[1]) / Math.max(1, distance(g.pts[0], g.pts[1]));
        const zoomed = zoomCrop(g.crop, factor, g.crop.x + (mid0.x - sq.x) / k, g.crop.y + (mid0.y - sq.y) / k, r.image, min);
        const k1 = sq.side / zoomed.size;
        setCrop(panCrop(zoomed, -(mid1.x - mid0.x) / k1, -(mid1.y - mid0.y) / k1, r.image, min));
    };
    const onPointerEnd = (e) => {
        pointers.current.delete(e.pointerId);
        restartGesture();
    };

    const zoomBy = (zoomIn) => {
        if (!ready) return;
        const { image, pixelArt } = ready;
        setCrop((c) => {
            const cx = c.x + c.size / 2;
            const cy = c.y + c.size / 2;
            if (pixelArt) {
                // One whole multiple at a time.
                const size = Math.max(STICKER_SIZE, snapCrop(c, image).size + (zoomIn ? -STICKER_SIZE : STICKER_SIZE));
                return zoomCrop(c, c.size / size, cx, cy, image, STICKER_SIZE);
            }
            return zoomCrop(c, zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP, cx, cy, image, minCropSize(image));
        });
    };

    const onKeyDown = (e) => {
        if (!ready) return;
        const step = (crop?.size ?? 0) / 16;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            const min = minCropSize(ready.image, ready.pixelArt);
            setCrop((c) => panCrop(c, moves[e.key][0], moves[e.key][1], ready.image, min));
        } else if (e.key === "+" || e.key === "=") {
            zoomBy(true);
        } else if (e.key === "-") {
            zoomBy(false);
        }
    };

    const addFiles = (list) => {
        const all = [...(list ?? [])];
        const images = imagesOf(all);
        setIgnored(all.length - images.length);
        if (!images.length) return;
        // The last batch already went to onSave; unless that failed, start a new one.
        if (done && !error) {
            setResults([]);
            setQueue(images);
            setIndex(0);
        } else {
            setQueue((q) => [...q, ...images]);
        }
    };

    const currentResult = () => ({
        name: name.trim().slice(0, MAX_NAME_LENGTH),
        pixels: toLibraryPixels(ready.image, shownCrop, options),
    });
    const advance = (nextResults) => {
        const next = index + 1;
        setIndex(next);
        if (next >= queue.length && nextResults.length) onSave(nextResults);
    };
    const save = () => {
        const next = [...results, currentResult()];
        setResults(next);
        advance(next);
    };

    const picker = (
        <>
            <input
                ref={pickerRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                }}
            />
            <button type="button" onClick={() => pickerRef.current?.click()} disabled={busy} className={BTN_PLAIN}>
                [KIES AFBEELDINGEN]
            </button>
        </>
    );

    return (
        <AgendaSheet title="PLAATJES IMPORTEREN" onClose={onClose}>
            <div className="space-y-[1lh]">
                {ignored > 0 && (
                    <p className="text-[#f7e463] uppercase">
                        {ignored} {ignored === 1 ? "BESTAND IS" : "BESTANDEN ZIJN"} GEEN PNG, JPG, WEBP, GIF OF SVG
                    </p>
                )}

                {queue.length === 0 && (
                    <>
                        <p className="text-neutral-500 uppercase">KIES EEN OF MEER AFBEELDINGEN: PNG, JPG, WEBP, GIF OF SVG.</p>
                        <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">{picker}</div>
                    </>
                )}

                {hasFile && (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-x-[2ch]">
                            <p className="uppercase text-white">
                                AFBEELDING {index + 1} VAN {queue.length}
                                {results.length > 0 && <span className="text-[#00ff66]"> · {results.length} KLAAR</span>}
                            </p>
                            <div className="flex flex-wrap gap-x-[1ch] -mr-[1ch]">{picker}</div>
                        </div>
                        <p className="text-neutral-500 truncate">{file.name}</p>

                        <div ref={viewRef} className="w-full max-w-[48ch] h-[18lh] bg-[#0a0a0a]">
                            <canvas
                                ref={canvasRef}
                                tabIndex={ready ? 0 : -1}
                                aria-label="Uitsnede: sleep om te verschuiven, knijp of scrol om te zoomen"
                                onPointerDown={onPointerDown}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerEnd}
                                onPointerCancel={onPointerEnd}
                                onKeyDown={onKeyDown}
                                className={`block w-full h-full touch-none outline-none focus-visible:bg-[#141414] ${ready ? "cursor-grab active:cursor-grabbing" : ""}`}
                            />
                        </div>

                        {!ready && !failed && <p className="text-neutral-500 uppercase">LADEN...</p>}
                        {failed && (
                            <>
                                <p role="alert" className="text-[#ff4d4d] uppercase">KAN DIT BESTAND NIET LEZEN.</p>
                                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                                    <button type="button" onClick={() => advance(results)} disabled={busy} className={BTN_PLAIN}>[OVERSLAAN]</button>
                                </div>
                            </>
                        )}

                        {ready && (
                            <>
                                <p className="text-neutral-500 uppercase">
                                    {ready.width}<span className="cell">×</span>{ready.height}
                                    {ready.pixelArt ? " · PIXELART: SCHERP VERKLEIND" : ""} · SLEEP, KNIJP OF SCROL
                                </p>
                                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                                    <button type="button" onClick={() => zoomBy(false)} className={BTN_PLAIN} aria-label="Uitzoomen">
                                        [<span className="cell">−</span>]
                                    </button>
                                    <button type="button" onClick={() => zoomBy(true)} className={BTN_PLAIN} aria-label="Inzoomen">[+]</button>
                                    <button type="button" onClick={() => setCrop(fitCrop(ready.image))} className={BTN_PLAIN}>[PAS IN]</button>
                                    <button type="button" onClick={() => setCrop(coverCrop(ready.image))} className={BTN_PLAIN}>[VULLEN]</button>
                                </div>

                                <div>
                                    <p className={LABEL}>VOORBEELD</p>
                                    <div className="flex items-start gap-x-[2ch] pt-[1lh]">
                                        <div className="w-[9ch] h-[4lh] shrink-0">
                                            <canvas ref={bigRef} width={STICKER_SIZE} height={STICKER_SIZE} aria-label="Voorbeeld groot" className="block w-[64px] h-[64px] [image-rendering:pixelated]" />
                                        </div>
                                        <div className="w-[3ch] h-[1lh] shrink-0">
                                            <canvas ref={smallRef} width={SMALL_SIZE} height={SMALL_SIZE} aria-label="Voorbeeld klein" className="block w-[16px] h-[16px] [image-rendering:pixelated]" />
                                        </div>
                                        {blank && <p className="text-[#f7e463] uppercase">LEEG: ALLES IS DOORZICHTIG</p>}
                                    </div>
                                </div>

                                <fieldset>
                                    <legend className={LABEL}>KLEUREN BEPERKEN</legend>
                                    <AgendaChoice
                                        options={[{ id: 0, label: "UIT" }, ...COLOUR_COUNTS.map((n) => ({ id: n, label: String(n) }))]}
                                        value={colours}
                                        onChange={setColours}
                                    />
                                </fieldset>

                                <fieldset>
                                    <legend className={LABEL}>DOORZICHTIG ONDER</legend>
                                    <AgendaChoice options={THRESHOLDS} value={threshold} onChange={setThreshold} />
                                </fieldset>

                                <label className="block">
                                    <span className={LABEL}>NAAM</span>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        maxLength={MAX_NAME_LENGTH}
                                        autoComplete="off"
                                        className={FIELD}
                                    />
                                </label>

                                <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                                    <button type="button" onClick={save} disabled={busy || blank || !pixels} className={BTN_PRIMARY}>[OPSLAAN]</button>
                                    <button type="button" onClick={() => onEdit(currentResult())} disabled={busy || !pixels} className={BTN_PLAIN}>[BEWERK]</button>
                                    <button type="button" onClick={() => advance(results)} disabled={busy} className={BTN_PLAIN}>[OVERSLAAN]</button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {done && (
                    <>
                        {results.length > 0 ? (
                            <>
                                <p className="uppercase text-white">
                                    {results.length} {results.length === 1 ? "PLAATJE" : "PLAATJES"}
                                </p>
                                <ResultStrip results={results} />
                                {busy && <p className="text-neutral-500 uppercase">BEZIG MET OPSLAAN...</p>}
                                {error && <p role="alert" className="text-[#ff4d4d] uppercase">{error}</p>}
                            </>
                        ) : (
                            <p className="text-neutral-500 uppercase">NIKS OPGESLAGEN.</p>
                        )}
                        <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch]">
                            {error && results.length > 0 && (
                                <button type="button" onClick={() => onSave(results)} disabled={busy} className={BTN_PRIMARY}>[OPNIEUW PROBEREN]</button>
                            )}
                            {picker}
                            <button type="button" onClick={onClose} disabled={busy} className={BTN_PLAIN}>[SLUITEN]</button>
                        </div>
                    </>
                )}
            </div>
        </AgendaSheet>
    );
}

// The saved images at real size, each in its own 9ch x 4lh block.
function ResultStrip({ results }) {
    return (
        <div className="flex flex-wrap gap-x-[1ch] gap-y-[1lh]">
            {results.map((r, i) => (
                <ResultImage key={i} pixels={r.pixels} name={r.name} />
            ))}
        </div>
    );
}

function ResultImage({ pixels, name }) {
    const ref = useRef(null);
    useEffect(() => paint(ref.current, pixels), [pixels]);
    return (
        <div className="w-[9ch] h-[4lh]">
            <canvas ref={ref} width={pixels.size} height={pixels.size} aria-label={name || "Plaatje"} className="block w-[64px] h-[64px] [image-rendering:pixelated]" />
        </div>
    );
}
