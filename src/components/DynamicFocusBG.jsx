import { useState, useEffect, useRef } from "react";

export default function DynamicFocusBg({
                                           imageUrl = "https://file.garden/ackh8bl_82C_S778/test.jpeg",
                                           children
                                       }) {
    const targetMousePos = useRef({ x: 0, y: 0 });
    const currentPos = useRef({ x: 0, y: 0 });
    const lensRef = useRef(null);
    const [imageLoaded, setImageLoaded] = useState(false);

    // Initialise positions once we know the window size (safe for SSR)
    useEffect(() => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        targetMousePos.current = { x: cx, y: cy };
        currentPos.current = { x: cx, y: cy };
    }, []);

    const handleMouseMove = (e) => {
        targetMousePos.current = { x: e.clientX, y: e.clientY };
    };

    // Preload the background image
    useEffect(() => {
        const img = new Image();
        img.onload = () => setImageLoaded(true);
        img.onerror = () => setImageLoaded(true); // show content anyway on error
        img.src = imageUrl;
    }, [imageUrl]);

    // Pure rAF loop – updates the DOM directly via ref, no React re-renders
    useEffect(() => {
        let animationFrameId;
        const renderLoop = () => {
            const easing = 0.12;
            const prev = currentPos.current;
            const target = targetMousePos.current;
            const dx = target.x - prev.x;
            const dy = target.y - prev.y;

            if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
                const nx = prev.x + dx * easing;
                const ny = prev.y + dy * easing;
                currentPos.current = { x: nx, y: ny };

                if (lensRef.current) {
                    const mask = `radial-gradient(circle 220px at calc(${nx}px + 10vw) calc(${ny}px + 10vh), black 15%, rgba(0,0,0,0.5) 55%, transparent 100%)`;
                    lensRef.current.style.WebkitMaskImage = mask;
                    lensRef.current.style.maskImage = mask;
                }
            }
            animationFrameId = requestAnimationFrame(renderLoop);
        };
        renderLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    const gpuStyles = {
        transform: 'translate3d(0,0,0)',
        backfaceVisibility: 'hidden',
        willChange: 'transform, filter'
    };

    return (
        <div onMouseMove={handleMouseMove} className="relative w-full min-h-screen bg-black">

            <svg className="fixed w-0 h-0 pointer-events-none" aria-hidden="true">
                <filter id="noise">
                    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
                </filter>
            </svg>

            {/* Loading state */}
            {!imageLoaded && (
                <div className="fixed inset-0 z-0 flex items-center justify-center pointer-events-none">
                    <span className="font-mono text-[10px] text-white/30 tracking-widest uppercase animate-pulse">
                        loading_visual_data...
                    </span>
                </div>
            )}

            {/* LAAG 1: Achtergrond Blur + Noise */}
            <div
                className="fixed top-[-10vh] left-[-10vw] w-[120vw] h-[120vh] z-0 pointer-events-none overflow-hidden transition-opacity duration-700"
                style={{ opacity: imageLoaded ? 1 : 0 }}
            >
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        filter: 'blur(10px) brightness(0.5)',
                        ...gpuStyles
                    }}
                />
                <svg className="absolute inset-0 w-full h-full opacity-20 mix-blend-overlay pointer-events-none animate-grain">
                    <rect width="100%" height="100%" filter="url(#noise)" />
                </svg>
            </div>

            {/* LAAG 2: De Lens */}
            <div
                className="fixed top-[-10vh] left-[-10vw] w-[120vw] h-[120vh] z-10 pointer-events-none overflow-hidden transition-opacity duration-700"
                style={{ opacity: imageLoaded ? 1 : 0 }}
            >
                <div
                    ref={lensRef}
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        filter: 'brightness(0.7)',
                        ...gpuStyles
                    }}
                />
            </div>

            <div className="relative z-20 pointer-events-auto">
                {children}
            </div>
        </div>
    );
}