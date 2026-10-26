// src/components/AsciiMedia.jsx
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { ASCII_RAMP } from "../utils/ascii";
import { useA11y } from "../context/A11yContext";
import { useTermCell, rowBaseline } from "../hooks/useTermCell";

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

// Renders an image as ASCII on the page's terminal grid: every glyph occupies exactly
// one 1ch x 1lh cell in the page font, and the box is a whole number of rows tall.
// `aspect` is width / height; the height is rounded to the nearest row.
export default function AsciiMedia({
    src,
    alt = "media",
    aspect = 3 / 2,
    className = "",
}) {
    const { reducedMotion, lowPowerMode, asciiAltMode } = useA11y();
    const cell = useTermCell();
    const cellRef = useRef(cell);
    useLayoutEffect(() => {
        cellRef.current = cell;
    }, [cell]);
    const [boxWidth, setBoxWidth] = useState(0);
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const offscreenRef = useRef(null);
    const [isHovered, setIsHovered] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    const stateRef = useRef({
        img: null,
        rows: 0,
        cols: 0,
        width: 0,
        height: 0,
        rampIndices: null,
        thresholds: null,
        crop: { cropX: 0, cropY: 0, cropW: 0, cropH: 0 },
        progress: 0,
        targetProgress: 0,
    });

    // 1. Sample image into ASCII matrix with cover-crop logic using persistent offscreen canvas & typed arrays
    const recomputeMatrix = useCallback((img, width) => {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        if (!srcW || !srcH || !width) return;

        // One sample per grid cell: whole columns that fit, rows from the requested aspect
        const { w: cellW, h: cellH } = cellRef.current;
        const activeCols = Math.max(1, Math.floor(width / cellW));
        const rows = Math.max(4, Math.round(width / aspect / cellH));
        const destW = activeCols * cellW;
        const destH = rows * cellH;
        stateRef.current.width = destW;
        stateRef.current.height = destH;

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
    }, [aspect]);

    // Render frame with zero per-frame object allocations
    const renderFrame = useCallback(() => {
        const canvas = canvasRef.current;
        const state = stateRef.current;
        if (!canvas || !state.img || !state.rampIndices) return;

        const dpr = window.devicePixelRatio || 1;
        const width = state.width;
        const height = state.height;
        if (width <= 0 || height <= 0) return;

        const numCols = state.cols;
        const numRows = state.rows;
        if (!numCols || !numRows || numCols <= 0 || numRows <= 0) return;
        if (!isFinite(numCols) || !isFinite(numRows)) return;

        const targetCanvasW = Math.round(width * dpr);
        const targetCanvasH = Math.round(height * dpr);
        if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
            canvas.width = targetCanvasW;
            canvas.height = targetCanvasH;
            // CSS size = exactly the drawn cells, so the canvas never stretches off-grid
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        try {
            ctx.save();
            ctx.scale(dpr, dpr);

            const progress = state.progress;
            const img = state.img;
            const srcW = img.naturalWidth || img.width;
            const srcH = img.naturalHeight || img.height;
            if (!srcW || !srcH) {
                ctx.restore();
                return;
            }

            setCoverCrop(srcW, srcH, width, height, state.crop);
            const { cropX, cropY, cropW, cropH } = state.crop;
            if (cropW <= 0 || cropH <= 0) {
                ctx.restore();
                return;
            }

            // When fully revealed: Draw full image with object-fit: cover
            if (progress >= 0.999) {
                ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, width, height);
                ctx.restore();
                return;
            }

            const cellW = width / numCols;
            const cellH = height / numRows;

            ctx.fillStyle = "#050505";
            ctx.fillRect(0, 0, width, height);

            // Same font, size and baseline as the surrounding DOM text
            const termCell = cellRef.current;
            ctx.font = termCell.font;
            ctx.textBaseline = "alphabetic";
            ctx.textAlign = "left";

            const ramp = ASCII_RAMP;
            const rampIndices = state.rampIndices;
            const thresholds = state.thresholds;
            if (!rampIndices || !thresholds) {
                ctx.restore();
                return;
            }

            // Source slice dimensions per cell (based on cropped area)
            const srcCellW = cropW / numCols;
            const srcCellH = cropH / numRows;
            if (srcCellW <= 0 || srcCellH <= 0) {
                ctx.restore();
                return;
            }
            const dw = Math.ceil(cellW);
            const dh = Math.ceil(cellH);

            let activeColor = "";

            for (let y = 0; y < numRows; y++) {
                const rowY = rowBaseline(termCell, y * cellH);
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
                        const cellX = x * cellW;

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
        } catch (err) {
            console.warn("AsciiMedia renderFrame failed gracefully:", err);
            try {
                ctx.restore();
            } catch { /* best-effort: ignore */ }
        }
    }, []);

    // Reset the loading state during render whenever the image source or density changes
    const [loadDeps, setLoadDeps] = useState({ src });
    if (loadDeps.src !== src) {
        setLoadDeps({ src });
        if (src) setImageLoaded(false);
    }

    // Load image
    useEffect(() => {
        if (!src) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;

        img.onload = () => {
            stateRef.current.img = img;
            const container = containerRef.current;
            recomputeMatrix(img, container ? container.clientWidth : 600);
            setImageLoaded(true);
            renderFrame();
        };

        img.onerror = () => {
            console.warn("Image load failed:", src);
        };
    }, [src, recomputeMatrix, renderFrame]);

    const startAnimationRef = useRef(null);

    // Animate progress on hover with FPS throttling, visibility sleep, and reduced-motion bypass
    useEffect(() => {
        const target = isHovered ? 1 : 0;
        stateRef.current.targetProgress = target;

        // WCAG Reduced Motion: bypass continuous frame loop completely
        if (reducedMotion) {
            stateRef.current.progress = target;
            renderFrame();
            return;
        }

        let frameId;
        let lastFrameTime = performance.now();
        // Throttle to 30 FPS on mobile (<768px) or low-power mode, 60 FPS otherwise
        const isMobileDevice = typeof window !== "undefined" && (window.innerWidth < 768 || (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)));
        const fpsInterval = (lowPowerMode || isMobileDevice) ? (1000 / 30) : (1000 / 60);

        const animate = (timestamp) => {
            // Immediate pause when tab is backgrounded / screen is locked (0.0% CPU)
            if (typeof document !== "undefined" && document.hidden) {
                return;
            }

            const elapsed = timestamp - lastFrameTime;
            if (elapsed < fpsInterval) {
                frameId = requestAnimationFrame(animate);
                return;
            }
            lastFrameTime = timestamp - (elapsed % fpsInterval);

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

        const startAnimation = () => {
            if (frameId) cancelAnimationFrame(frameId);
            lastFrameTime = performance.now();
            frameId = requestAnimationFrame(animate);
        };

        startAnimationRef.current = startAnimation;
        startAnimation();

        return () => {
            startAnimationRef.current = null;
            if (frameId) cancelAnimationFrame(frameId);
        };
    }, [isHovered, renderFrame, reducedMotion, lowPowerMode, asciiAltMode]);

    // Visibility change listener: wake up and resume animation or repaint when tab regains focus
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (typeof document === "undefined" || document.hidden) return;

            if (stateRef.current.img) {
                const diff = Math.abs(stateRef.current.targetProgress - stateRef.current.progress);
                if (diff >= 0.01 && !reducedMotion && startAnimationRef.current) {
                    startAnimationRef.current();
                } else {
                    renderFrame();
                }
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [renderFrame, reducedMotion]);

    // Resize listener to adapt matrix and dimensions without layout thrashing
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry ? entry.contentRect.width : container.clientWidth;
            setBoxWidth(width);

            if (stateRef.current.img) {
                recomputeMatrix(stateRef.current.img, width);
            }
            if (!asciiAltMode) {
                renderFrame();
            }
        });
        ro.observe(container);

        return () => ro.disconnect();
    }, [recomputeMatrix, renderFrame, asciiAltMode]);

    // The grid cell changes at breakpoints and once the web font loads: resample and repaint
    useEffect(() => {
        const container = containerRef.current;
        if (stateRef.current.img && container) {
            recomputeMatrix(stateRef.current.img, container.clientWidth);
            if (!asciiAltMode) renderFrame();
        }
    }, [cell, recomputeMatrix, renderFrame, asciiAltMode]);

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

    // When toggling plain-media mode off, trigger immediate canvas re-render
    useEffect(() => {
        if (!asciiAltMode && stateRef.current.img && containerRef.current) {
            const width = containerRef.current.clientWidth;
            if (width > 0) {
                recomputeMatrix(stateRef.current.img, width);
                renderFrame();
            }
        }
    }, [asciiAltMode, recomputeMatrix, renderFrame]);

    // Whole rows tall once the width is known; the CSS aspect ratio only bridges first paint
    const gridRows = boxWidth ? Math.max(4, Math.round(boxWidth / aspect / cell.h)) : 0;
    const boxStyle = gridRows ? { height: gridRows * cell.h } : { aspectRatio: aspect };

    return (
        <figure
            ref={containerRef}
            style={boxStyle}
            className={`relative overflow-hidden ${asciiAltMode ? "" : "cursor-crosshair"} select-none bg-black ${className}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => setIsHovered(prev => !prev)}
        >
            {asciiAltMode && src ? (
                <>
                    <img
                        src={src}
                        alt={alt}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover block"
                    />
                    <figcaption className="sr-only">{alt}</figcaption>
                </>
            ) : (
                <>
                    <canvas ref={canvasRef} aria-hidden="true" className="block" />
                    <figcaption className="sr-only">{alt}</figcaption>
                    {!imageLoaded && (
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 flex items-center justify-center font-mono text-neutral-600 uppercase animate-pulse"
                        >
                            [loading ascii matrix...]
                        </div>
                    )}
                </>
            )}
        </figure>
    );
}
