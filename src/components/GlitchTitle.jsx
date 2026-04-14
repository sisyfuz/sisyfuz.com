import { useState, useEffect, useRef } from "react";
import { useDisco } from "../context/DiscoContext";

export default function GlitchTitle({ progress }) {
    const { discoMode } = useDisco();
    const word = "sisyfuzZz";
    const originalChars = word.split("");

    const charMap = {
        's': ['$', '5', 'š', '§', 'ș'],
        'i': ['1', '!', 'ï', '|', 'í', 'î'],
        'y': ['¥', 'ý', 'ÿ', 'γ'],
        'f': ['ƒ', '₣', 'φ', '⨍'],
        'u': ['ü', 'µ', 'υ', 'ú', 'ù'],
        'z': ['2', 'ž', 'ź', 'ż', 'ⱬ'],
        'Z': ['7', 'Ž', 'Ź', 'ℤ', 'Ɀ']
    };

    const [charData, setCharData] = useState(originalChars.map(char => ({
        style: {},
        displayChar: char
    })));

    const progressRef = useRef(progress);
    const titleRef = useRef(null);
    const mousePosRef = useRef({ x: -1000, y: -1000 });

    useEffect(() => { progressRef.current = progress; }, [progress]);

    useEffect(() => {
        const handleMouseMove = (e) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; };
        window.addEventListener("mousemove", handleMouseMove, { passive: true });
        return () => window.removeEventListener("mousemove", handleMouseMove);
    }, []);

    useEffect(() => {
        let frameId;
        let lastGlitchTimes = originalChars.map(() => 0);

        const animate = (time) => {
            const currentProgress = progressRef.current;
            const baseScrollDelay = 40 + (Math.pow(currentProgress, 2) * 1160);

            if (titleRef.current) {
                const spans = titleRef.current.children;
                const mouseX = mousePosRef.current.x;
                const mouseY = mousePosRef.current.y;

                setCharData(prevData => {
                    let nextData = [...prevData];
                    let hasChanges = false;

                    for (let i = 0; i < originalChars.length; i++) {
                        const span = spans[i];
                        if (!span) continue;

                        const rect = span.getBoundingClientRect();
                        const charX = rect.left + rect.width / 2;
                        const charY = rect.top + rect.height / 2;

                        const dx = mouseX - charX;
                        const dy = mouseY - charY;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        const influenceRadius = 350;
                        let proximityWeight = 0;
                        if (distance < influenceRadius) {
                            proximityWeight = Math.pow(1 - (distance / influenceRadius), 2);
                        }

                        const currentDelay = baseScrollDelay - ((baseScrollDelay - 30) * proximityWeight);

                        if (time - lastGlitchTimes[i] > currentDelay) {
                            const weights = [100, 300, 400, 700, 700, 900, 900, 900];
                            const sizeBias = Math.sqrt(Math.random());
                            const baseScale = 0.95 + (sizeBias * 0.15);
                            const extraScale = proximityWeight * (0.2 + (sizeBias * 0.6));
                            const finalScale = baseScale + extraScale;

                            const weirdChance = 0.05 + (proximityWeight * 0.75);
                            const showRealLetter = Math.random() > weirdChance;

                            const lookalikes = charMap[originalChars[i]] || [];
                            let finalChar = originalChars[i];
                            if (!showRealLetter && lookalikes.length > 0) {
                                finalChar = lookalikes[Math.floor(Math.random() * lookalikes.length)];
                            }

                            nextData[i] = {
                                style: {
                                    fontWeight: weights[Math.floor(Math.random() * weights.length)],
                                    fontStyle: Math.random() > 0.5 ? 'italic' : 'normal',
                                    transform: `scale(${finalScale})`,
                                },
                                displayChar: finalChar
                            };

                            lastGlitchTimes[i] = time;
                            hasChanges = true;
                        }
                    }
                    return hasChanges ? nextData : prevData;
                });
            }
            frameId = requestAnimationFrame(animate);
        };

        frameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frameId);
    }, []);

    return (
        <h1
            ref={titleRef}
            className="text-6xl md:text-7xl font-black tracking-tighter leading-none flex justify-center space-x-1 md:space-x-2"
            style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.45))' }}
        >
            {charData.map((data, i) => (
                <span
                    key={i}
                    className={discoMode ? "animate-disco" : ""}
                    style={{
                        ...data.style,
                        transition: 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), font-weight 0.05s',
                        display: 'inline-block',
                        transformOrigin: 'center center',
                        minWidth: '0.6em',
                        textAlign: 'center'
                    }}
                >
                    {data.displayChar}
                </span>
            ))}
        </h1>
    );
}