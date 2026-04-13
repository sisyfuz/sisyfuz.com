import { useEffect, useState } from "react";

// --- CONFIGURATIE ---
const CONFIG = {
    scrollRange: 700,
    bgImage: "https://file.garden/ackh8bl_82C_S778/test.jpeg",
    colors: {
        white: { r: 255, g: 255, b: 255 },
        pink: { r: 255, g: 105, b: 180 },
        black: { r: 0, g: 0, b: 0 },
    }
};

// --- HELPERS ---
const mix = (start, end, t) => Math.round(start + (end - start) * t);

const getInterpolatedColor = (progress, colors) => {
    const { white, pink, black } = colors;
    const isFirstHalf = progress < 0.5;
    const factor = isFirstHalf ? progress * 2 : (progress - 0.5) * 2;
    const from = isFirstHalf ? white : pink;
    const to = isFirstHalf ? pink : black;

    return `rgb(${mix(from.r, to.r, factor)}, ${mix(from.g, to.g, factor)}, ${mix(from.b, to.b, factor)})`;
};

// --- CUSTOM HOOK ---
function useScrollProgress(range) {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const handleScroll = () => {
            const p = Math.min(window.scrollY / range, 1);
            setProgress(p);
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener("scroll", handleScroll);
    }, [range]);

    return progress;
}

// --- MAIN COMPONENT ---
function App() {
    const progress = useScrollProgress(CONFIG.scrollRange);

    const titleColor = getInterpolatedColor(progress, CONFIG.colors);
    const titleTranslateY = progress * -360;

    return (
        <div className="relative min-h-[250vh] bg-white text-slate-900 font-sans">

            {/* Background Layer */}
            <div className="fixed inset-0 z-0">
                <div
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                    style={{
                        backgroundImage: `url(${CONFIG.bgImage})`,
                        opacity: 1 - progress
                    }}
                />
                <div
                    className="absolute inset-0 bg-white"
                    style={{ opacity: progress }}
                />
            </div>

            {/* Hero Header */}
            <header className="sticky top-0 z-20 flex h-screen items-center justify-center px-6 pointer-events-none">
                <div
                    className="text-center transition-transform duration-75 ease-out pointer-events-auto"
                    style={{
                        transform: `translateY(${titleTranslateY}px)`,
                        color: titleColor,
                    }}
                >
                    <h1 className="text-7xl font-black tracking-tighter selection:bg-indigo-500 selection:text-white">
                        sisyfuzZz
                    </h1>
                    <p className="mt-3 text-lg font-medium opacity-80">
                        a.k.a. Dorus Kleijne
                    </p>
                </div>
            </header>

            {/* Content Layer */}
            <main className="relative z-10 mx-auto max-w-2xl px-6 pb-40">
                <section className="mt-12">
                    <h2 className="text-3xl font-semibold tracking-tight text-black">
                        artist_statement
                    </h2>

                    {/* De 'space-y-6' regelt de afstand tussen de alinea's. 
          De rest van de styling (uitvullen, indent) staat hieronder op de 'div'.
        */}
                    <div className="mt-8 space-y-8 text-lg leading-relaxed text-black text-justify indent-2 hyphens-auto">

                        {/* HIER GEBEURT HET: We voegen 'italic' toe aan de quote. */}
                        <p className="italic text-gray-600 font-light">
                            "Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."
                        </p>

                        {/* Deze tekst blijft gewoon rechtstreeks staan. */}
                        <p>
                            Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk.
                            Doormiddel van sci-fi onstaan ruizige ervaringen, die inherent queer zijn. De ervaringen
                            hebben een nadruk op beeld en geluid en wordt tekst een ritmisch instrument in plaats
                            van inhoudelijk.
                        </p>
                    </div>
                </section>
            </main>

        </div>
    );
}

export default App;