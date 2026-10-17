// src/components/AsciiMedia.jsx
import { useEffect, useState, useRef } from "react";
import { ASCII_RAMP } from "../utils/ascii";

function getCoverCrop(srcW, srcH, destW, destH) {
    if (!srcW || !srcH || !destW || !destH) {
        return { cropX: 0, cropY: 0, cropW: srcW || 1, cropH: srcH || 1 };
    }
    const srcRatio = srcW / srcH;
    const destRatio = destW / destH;
    let cropX = 0;
    let cropY = 0;
    let cropW = srcW;
    let cropH = srcH;

    if (srcRatio > destRatio) {
        // Source is wider than destination -> crop sides
        cropW = srcH * destRatio;
        cropX = (srcW - cropW) / 2;
    } else {
        // Source is taller than destination -> crop top/bottom
        cropH = srcW / destRatio;
        cropY = (srcH - cropH) / 2;
    }

    return { cropX, cropY, cropW, cropH };
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
    const [isHovered, setIsHovered] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    const stateRef = useRef({
        img: null,
        matrix: [],
        rows: 28,
        cols: cols,
        progress: 0,
        targetProgress: 0,
    });

    // 1. Sample image into ASCII matrix with cover-crop logic
    const recomputeMatrix = (img, width, height) => {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        if (!srcW || !srcH) return;

        const destW = width || 600;
        const destH = height || 400;

        // Character font aspect ratio ~ 0.52 (width/height)
        const charAspect = 0.52;
        const rows = Math.max(14, Math.floor(cols * (destH / destW) * charAspect));

        stateRef.current.rows = rows;
        stateRef.current.cols = cols;

        const { cropX, cropY, cropW, cropH } = getCoverCrop(srcW, srcH, destW, destH);

        const offscreen = document.createElement("canvas");
        offscreen.width = cols;
        offscreen.height = rows;
        const ctx = offscreen.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        // Draw cropped source into cols x rows without stretching
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cols, rows);
        const { data } = ctx.getImageData(0, 0, cols, rows);

        const ramp = ASCII_RAMP;
        const rampLength = ramp.length;
        const matrix = [];

        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const a = data[idx + 3];

                if (a < 30) {
                    row.push({ char: " ", r: 0, g: 0, b: 0 });
                    continue;
                }

                const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                const charIdx = Math.floor((1 - brightness) * (rampLength - 1));
                const char = ramp[Math.max(0, Math.min(rampLength - 1, charIdx))];

                row.push({ char, r, g, b });
            }
            matrix.push(row);
        }

        stateRef.current.matrix = matrix;
    };

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
    }, [src, cols]);

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
    }, [isHovered]);

    // Resize listener to prevent distortion when window resizes
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ro = new ResizeObserver(() => {
            if (stateRef.current.img) {
                const rect = container.getBoundingClientRect();
                recomputeMatrix(stateRef.current.img, rect.width, rect.height);
            }
            renderFrame();
        });
        ro.observe(container);

        return () => ro.disconnect();
    }, [cols]);

    // Render frame
    const renderFrame = () => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const state = stateRef.current;
        if (!canvas || !container || !state.img) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        if (width === 0 || height === 0) return;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);

        const progress = state.progress;
        const img = state.img;
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;

        // Calculate exact object-fit: cover coordinates
        const { cropX, cropY, cropW, cropH } = getCoverCrop(srcW, srcH, width, height);

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

        const matrix = state.matrix;

        // Source slice dimensions per cell (based on cropped area)
        const srcCellW = cropW / numCols;
        const srcCellH = cropH / numRows;

        for (let y = 0; y < numRows; y++) {
            const row = matrix[y];
            if (!row) continue;

            const rowY = y * cellH + cellH / 2;

            for (let x = 0; x < numCols; x++) {
                const cell = row[x];
                if (!cell) continue;

                const cellX = x * cellW + cellW / 2;
                const stagger = ((y * 7) % 5) * 0.015;
                const cellThreshold = (x / numCols) + stagger;
                const delta = progress - cellThreshold;

                const dx = Math.floor(x * cellW);
                const dy = Math.floor(y * cellH);
                const dw = Math.ceil(cellW);
                const dh = Math.ceil(cellH);

                if (delta > 0.04) {
                    // CELL REVEALED: Draw exact unstretched slice from cropped source!
                    const sx = cropX + x * srcCellW;
                    const sy = cropY + y * srcCellH;
                    ctx.drawImage(img, sx, sy, srcCellW, srcCellH, dx, dy, dw, dh);
                } else if (delta >= -0.02 && delta <= 0.04) {
                    // ACTIVE TRANSITION FLASH: Hot pink
                    ctx.fillStyle = "#ff0080";
                    ctx.fillText(cell.char, cellX, rowY);
                } else {
                    // STILL ASCII:
                    ctx.fillStyle = "#f0f0f0";
                    ctx.fillText(cell.char, cellX, rowY);
                }
            }
        }

        ctx.restore();
    };

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
