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
                const easing = 0.12;
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

            {/* LAAG 1: Achtergrond Blur + Noise */}
            <div className="fixed top-[-10vh] left-[-10vw] w-[120vw] h-[120vh] z-0 pointer-events-none overflow-hidden">
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
            <div className="fixed top-[-10vh] left-[-10vw] w-[120vw] h-[120vh] z-10 pointer-events-none overflow-hidden">
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${imageUrl})`,
                        filter: 'brightness(0.7)',
                        WebkitMaskImage: `radial-gradient(circle 220px at calc(${currentLensPos.x}px + 10vw) calc(${currentLensPos.y}px + 10vh), black 15%, rgba(0,0,0,0.5) 55%, transparent 100%)`,
                        maskImage: `radial-gradient(circle 220px at calc(${currentLensPos.x}px + 10vw) calc(${currentLensPos.y}px + 10vh), black 15%, rgba(0,0,0,0.5) 55%, transparent 100%)`,
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