import { useState, useEffect, useRef } from "react";

export default function DynamicFocusBg({
                                           imageUrl = "https://file.garden/ackh8bl_82C_S778/test.jpeg",
                                           children
                                       }) {
    const targetMousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const [currentLensPos, setCurrentLensPos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    const handleMouseMove = (e) => {
        targetMousePos.current = { x: e.clientX, y: e.clientY };
    };

    useEffect(() => {
        let animationFrameId;
        const renderLoop = () => {
            setCurrentLensPos((prevPos) => {
                const easing = 0.12; // Iets snellere easing voor een 'snappy' gevoel
                const dx = targetMousePos.current.x - prevPos.x;
                const dy = targetMousePos.current.y - prevPos.y;
                if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return targetMousePos.current;
                return { x: prevPos.x + dx * easing, y: prevPos.y + dy * easing };
            });
            animationFrameId = requestAnimationFrame(renderLoop);
        };
        renderLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    return (
        <div onMouseMove={handleMouseMove} className="relative w-full min-h-screen bg-black">

            {/* CHROMATIC ABERRATION SVG IS VERWIJDERD */}
            <svg className="fixed w-0 h-0 pointer-events-none" aria-hidden="true">
                <filter id="noise">
                    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
                </filter>
            </svg>

            {/* LAAG 1: Achtergrond Blur + Noise */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div
                    className="absolute -inset-10 bg-cover bg-center scale-110"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        // OPTIMALISATIE: Blur verlaagd van 20px naar 8px (veel lichter voor GPU)
                        filter: 'blur(8px) brightness(0.5)',
                        willChange: 'filter' // Hint aan browser voor optimalisatie
                    }}
                />

                <svg className="absolute inset-0 w-full h-full opacity-20 mix-blend-overlay pointer-events-none animate-grain">
                    <rect width="100%" height="100%" filter="url(#noise)" />
                </svg>
            </div>

            {/* LAAG 2: De Lens */}
            <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden">
                <div
                    className="absolute -inset-10 bg-cover bg-center scale-110"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        // OPTIMALISATIE: url(#aberration) verwijderd. Blur op 0 of heel laag.
                        filter: 'brightness(0.7)',
                        WebkitMaskImage: `radial-gradient(circle 200px at ${currentLensPos.x}px ${currentLensPos.y}px, black 20%, rgba(0,0,0,0.4) 60%, transparent 100%)`,
                        maskImage: `radial-gradient(circle 200px at ${currentLensPos.x}px ${currentLensPos.y}px, black 20%, rgba(0,0,0,0.4) 60%, transparent 100%)`,
                        willChange: 'mask-image, -webkit-mask-image'
                    }}
                />
            </div>

            {/* LAAG 3: Website Content */}
            <div className="relative z-20 pointer-events-auto">
                {children}
            </div>
        </div>
    );
}