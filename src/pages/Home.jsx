import { useEffect, useState } from "react";
import DynamicFocusBg from "../components/DynamicFocusBG";
import GlitchTitle from "../components/GlitchTitle";

const CONFIG = {
    scrollRange: 700,
    bgImage: "https://file.garden/ackh8bl_82C_S778/backdrop_home.jpg",
    colors: {
        white: { r: 255, g: 255, b: 255 },
        pink: { r: 255, g: 105, b: 180 },
        black: { r: 0, g: 0, b: 0 },
    }
};

const mix = (start, end, t) => Math.round(start + (end - start) * t);
const getInterpolatedColor = (progress, colors) => {
    const { white, pink, black } = colors;
    const isFirstHalf = progress < 0.5;
    const factor = isFirstHalf ? progress * 2 : (progress - 0.5) * 2;
    const from = isFirstHalf ? white : pink;
    const to = isFirstHalf ? pink : black;
    return `rgb(${mix(from.r, to.r, factor)}, ${mix(from.g, to.g, factor)}, ${mix(from.b, to.b, factor)})`;
};

export default function Home() {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const handleScroll = () => {
            const currentScroll = window.scrollY;
            setProgress(Math.min(currentScroll / CONFIG.scrollRange, 1));
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const titleColor = getInterpolatedColor(progress, CONFIG.colors);
    const titleTranslateY = progress * -42;
    const dynamicGap = 36 + (progress * -18);
    return (
        <DynamicFocusBg imageUrl={CONFIG.bgImage}>
            {/* Als je hier ergens een losse {inputBuffer} ziet staan, 
                moet die weg! De onderstaande structuur is 100% clean.
            */}
            <div className="relative min-h-[250vh] font-sans">

                <div
                    className="fixed inset-0 z-0 pointer-events-none bg-white transition-opacity duration-75"
                    style={{ opacity: progress }}
                />

                <header className="sticky top-0 z-20 flex h-screen items-center justify-center px-6 pointer-events-none">
                    <div
                        className="flex flex-col items-center text-center transition-transform duration-75 ease-out pointer-events-auto"
                        style={{
                            transform: `translateY(${titleTranslateY}vh)`,
                            color: titleColor
                        }}
                    >
                        <GlitchTitle progress={progress} />

                        <p
                            className="text-lg font-medium opacity-80 transition-all duration-75 ease-out"
                            style={{ marginTop: `${dynamicGap}px` }}
                        >
                            a.k.a. Dorus Kleijne
                        </p>
                    </div>
                </header>
                
                <main className="relative z-10 mx-auto max-w-2xl px-6 pb-60">
                    <section className="mt-12 text-black">
                        <h2 className="text-3xl font-semibold tracking-tight uppercase">
                            artist_statement
                        </h2>
                        <div className="mt-8 space-y-8 text-lg leading-relaxed text-justify indent-2">
                            <p className="italic text-gray-600 font-light">
                                "Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."
                            </p>
                            <p>
                                Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk.
                                Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.
                            </p>
                            <p className="text-sm font-mono text-gray-400">
                                [WELCOME ABOARD MAITEY!]
                            </p>
                        </div>
                    </section>
                </main>
            </div>
        </DynamicFocusBg>
    );
}