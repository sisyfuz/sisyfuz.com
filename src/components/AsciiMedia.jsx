// src/components/AsciiMedia.jsx
import { useEffect, useState, useRef, useCallback } from "react";
import { ASCII_RAMP } from "../utils/ascii";

function setCoverCrop(srcW, srcH, destW, destH, out) {
    if (!srcW || !srcH || !destW || !destH) {
        out.cropX = 0;
        out.cropY = 0;
        out.cropW = srcW || 1;
        out.cropH = srcH || 1;
        return;
    }
    const srcRatio = srcW / srcH;
    const destRatio = destW / destH;

    if (srcRatio > destRatio) {
        // Source is wider than destination -> crop sides
        out.cropW = srcH * destRatio;
        out.cropH = srcH;
        out.cropX = (srcW - out.cropW) / 2;
        out.cropY = 0;
    } else {
        // Source is taller than destination -> crop top/bottom
        out.cropW = srcW;
        out.cropH = srcW / destRatio;
        out.cropX = 0;
        out.cropY = (srcH - out.cropH) / 2;
    }
}

export default function AsciiMedia({
    src,
    alt = "media",
    cols = 52,
    aspectRatio = "aspect-[3/2]",
    className = "",
}) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const offscreenRef = useRef(null);
    const [isHovered, setIsHovered] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    const stateRef = useRef({
        img: null,
        rows: 28,
        cols: cols,
        width: 0,
        height: 0,
        rampIndices: null,
        thresholds: null,
        crop: { cropX: 0, cropY: 0, cropW: 0, cropH: 0 },
        progress: 0,
        targetProgress: 0,
    });

    // 1. Sample image into ASCII matrix with cover-crop logic using persistent offscreen canvas & typed arrays
    const recomputeMatrix = useCallback((img, width, height) => {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        if (!srcW || !srcH) return;

        const destW = width || 600;
        const destH = height || 400;
        stateRef.current.width = destW;
        stateRef.current.height = destH;

        // Auto-adapt column count for small mobile viewports to prevent squished characters
        const activeCols = destW < 420 ? Math.min(cols, 38) : (destW < 600 ? Math.min(cols, 46) : cols);

        // Character font aspect ratio ~ 0.52 (width/height)
        const charAspect = 0.52;
        const rows = Math.max(14, Math.floor(activeCols * (destH / destW) * charAspect));

        stateRef.current.rows = rows;
        stateRef.current.cols = activeCols;

        if (!offscreenRef.current) {
            offscreenRef.current = document.createElement("canvas");
        }
        const offscreen = offscreenRef.current;
        if (offscreen.width !== activeCols || offscreen.height !== rows) {
            offscreen.width = activeCols;
            offscreen.height = rows;
        }

        const ctx = offscreen.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        setCoverCrop(srcW, srcH, destW, destH, stateRef.current.crop);
        const { cropX, cropY, cropW, cropH } = stateRef.current.crop;

        // Draw cropped source into activeCols x rows without stretching
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, activeCols, rows);
        const { data } = ctx.getImageData(0, 0, activeCols, rows);

        const totalCells = activeCols * rows;
        let rampIndices = stateRef.current.rampIndices;
        if (!rampIndices || rampIndices.length !== totalCells) {
            rampIndices = new Uint8Array(totalCells);
            stateRef.current.rampIndices = rampIndices;
        }
        let thresholds = stateRef.current.thresholds;
        if (!thresholds || thresholds.length !== totalCells) {
            thresholds = new Float32Array(totalCells);
            stateRef.current.thresholds = thresholds;
        }

        const rampLength = ASCII_RAMP.length;

        for (let y = 0; y < rows; y++) {
            const rowOffset = y * activeCols;
            const stagger = ((y * 7) % 5) * 0.015;
            for (let x = 0; x < activeCols; x++) {
                const cellIdx = rowOffset + x;
                thresholds[cellIdx] = (x / activeCols) + stagger;

                const idx = cellIdx * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const a = data[idx + 3];

                if (a < 30) {
                    rampIndices[cellIdx] = rampLength - 1; // whitespace/dim
                    continue;
                }

                const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                const charIdx = Math.floor((1 - brightness) * (rampLength - 1));
                rampIndices[cellIdx] = Math.max(0, Math.min(rampLength - 1, charIdx));
            }
        }
    }, [cols]);

    // Render frame with zero per-frame object allocations
    const renderFrame = useCallback(() => {
        const canvas = canvasRef.current;
        const state = stateRef.current;
        if (!canvas || !state.img || !state.rampIndices) return;

        const dpr = window.devicePixelRatio || 1;
        let width = state.width;
        let height = state.height;

        if (width === 0 || height === 0) {
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            width = Math.floor(rect.width);
            height = Math.floor(rect.height);
            state.width = width;
            state.height = height;
        }

        if (width === 0 || height === 0) return;

        const targetCanvasW = Math.round(width * dpr);
        const targetCanvasH = Math.round(height * dpr);
        if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
            canvas.width = targetCanvasW;
            canvas.height = targetCanvasH;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);

        const progress = state.progress;
        const img = state.img;
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;

        setCoverCrop(srcW, srcH, width, height, state.crop);
        const { cropX, cropY, cropW, cropH } = state.crop;

        // When fully revealed: Draw full image with object-fit: cover
        if (progress >= 0.999) {
            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, width, height);
            ctx.restore();
            return;
        }

        const numCols = state.cols;
        const numRows = state.rows;
        const cellW = width / numCols;
        const cellH = height / numRows;

        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, width, height);

        const fontSize = Math.max(8, Math.floor(cellH * 0.95));
        ctx.font = `${fontSize}px "Space Mono", "Courier New", monospace`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        const ramp = ASCII_RAMP;
        const rampIndices = state.rampIndices;
        const thresholds = state.thresholds;

        // Source slice dimensions per cell (based on cropped area)
        const srcCellW = cropW / numCols;
        const srcCellH = cropH / numRows;
        const dw = Math.ceil(cellW);
        const dh = Math.ceil(cellH);

        let activeColor = "";

        for (let y = 0; y < numRows; y++) {
            const rowY = y * cellH + cellH / 2;
            const rowOffset = y * numCols;
            const sy = cropY + y * srcCellH;
            const dy = Math.floor(y * cellH);

            for (let x = 0; x < numCols; x++) {
                const cellIdx = rowOffset + x;
                const delta = progress - thresholds[cellIdx];

                if (delta > 0.04) {
                    // CELL REVEALED: Draw exact unstretched slice from cropped source
                    const sx = cropX + x * srcCellW;
                    const dx = Math.floor(x * cellW);
                    ctx.drawImage(img, sx, sy, srcCellW, srcCellH, dx, dy, dw, dh);
                } else {
                    const char = ramp[rampIndices[cellIdx]];
                    const cellX = x * cellW + cellW / 2;

                    if (delta >= -0.02 && delta <= 0.04) {
                        // ACTIVE TRANSITION FLASH: Hot pink
                        if (activeColor !== "#ff0080") {
                            ctx.fillStyle = "#ff0080";
                            activeColor = "#ff0080";
                        }
                    } else {
                        // STILL ASCII
                        if (activeColor !== "#f0f0f0") {
                            ctx.fillStyle = "#f0f0f0";
                            activeColor = "#f0f0f0";
                        }
                    }
                    ctx.fillText(char, cellX, rowY);
                }
            }
        }

        ctx.restore();
    }, []);

    // Load image
    useEffect(() => {
        if (!src) return;

        setImageLoaded(false);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;

        img.onload = () => {
            stateRef.current.img = img;
            const container = containerRef.current;
            const rect = container ? container.getBoundingClientRect() : { width: 600, height: 400 };
            recomputeMatrix(img, rect.width, rect.height);
            setImageLoaded(true);
            renderFrame();
        };

        img.onerror = () => {
            console.warn("Image load failed:", src);
        };
    }, [src, cols, recomputeMatrix, renderFrame]);

    // Animate progress on hover
    useEffect(() => {
        const target = isHovered ? 1 : 0;
        stateRef.current.targetProgress = target;

        let frameId;
        const animate = () => {
            const current = stateRef.current.progress;
            const diff = target - current;

            if (Math.abs(diff) < 0.01) {
                stateRef.current.progress = target;
                renderFrame();
                return;
            }

            stateRef.current.progress = current + diff * 0.16;
            renderFrame();
            frameId = requestAnimationFrame(animate);
        };

        frameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frameId);
    }, [isHovered, renderFrame]);

    // Resize listener to adapt matrix and dimensions without layout thrashing
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry ? Math.floor(entry.contentRect.width) : Math.floor(container.clientWidth);
            const height = entry ? Math.floor(entry.contentRect.height) : Math.floor(container.clientHeight);
            stateRef.current.width = width;
            stateRef.current.height = height;

            if (stateRef.current.img) {
                recomputeMatrix(stateRef.current.img, width, height);
            }
            renderFrame();
        });
        ro.observe(container);

        return () => ro.disconnect();
    }, [cols, recomputeMatrix, renderFrame]);

    // Canvas buffer memory cleanup on unmount
    useEffect(() => {
        return () => {
            if (canvasRef.current) {
                canvasRef.current.width = 0;
                canvasRef.current.height = 0;
            }
            if (offscreenRef.current) {
                offscreenRef.current.width = 0;
                offscreenRef.current.height = 0;
                offscreenRef.current = null;
            }
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className={`relative overflow-hidden cursor-crosshair select-none bg-black ${aspectRatio} ${className}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => setIsHovered(prev => !prev)}
            role="img"
            aria-label={alt}
        >
            <canvas ref={canvasRef} className="w-full h-full block" />
            {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-neutral-600 uppercase tracking-widest animate-pulse">
                    [loading ascii matrix...]
                </div>
            )}
        </div>
    );
}
