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
                const easing = 0.08;
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

            <svg className="fixed w-0 h-0 pointer-events-none" aria-hidden="true">
                <filter id="aberration" colorInterpolationFilters="sRGB">
                    <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" in="SourceGraphic" result="red"/>
                    <feOffset dx="-4" dy="0" in="red" result="red_shifted"/>
                    <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" in="SourceGraphic" result="green"/>
                    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" in="SourceGraphic" result="blue"/>
                    <feOffset dx="4" dy="0" in="blue" result="blue_shifted"/>
                    <feBlend mode="screen" in="red_shifted" in2="green" result="rg_blend"/>
                    <feBlend mode="screen" in="rg_blend" in2="blue_shifted" result="final_blend"/>
                </filter>
            </svg>

            {/* LAAG 1: Achtergrond Blur + Noise */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div
                    className="absolute -inset-10 bg-cover bg-center scale-125"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        filter: 'blur(20px) brightness(0.55)'
                    }}
                />
                <svg className="absolute inset-0 w-full h-full opacity-30 mix-blend-overlay pointer-events-none animate-grain scale-110">
                    <filter id="noise">
                        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
                    </filter>
                    <rect width="100%" height="100%" filter="url(#noise)" />
                </svg>
            </div>

            {/* LAAG 2: De Lens */}
            <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden">
                <div
                    className="absolute -inset-10 bg-cover bg-center scale-125"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        filter: 'blur(2px) brightness(0.7) url(#aberration)',
                        /* AANPASSING: Straal naar 250px. 
                           De percentages bepalen hoe 'zacht' de rand van de cirkel is. 
                        */
                        WebkitMaskImage: `radial-gradient(circle 250px at ${currentLensPos.x}px ${currentLensPos.y}px, black 10%, rgba(0,0,0,0.6) 50%, transparent 80%)`,
                        maskImage: `radial-gradient(circle 250px at ${currentLensPos.x}px ${currentLensPos.y}px, black 10%, rgba(0,0,0,0.6) 50%, transparent 80%)`
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