import { useEffect, useState } from "react";

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
        const handleScroll = () => setProgress(Math.min(window.scrollY / CONFIG.scrollRange, 1));
        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const titleColor = getInterpolatedColor(progress, CONFIG.colors);
    const titleTranslateY = progress * -360;

    return (
        <div className="relative min-h-[250vh] bg-white text-slate-900 font-sans">
            <div className="fixed inset-0 z-0">
                <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${CONFIG.bgImage})`, opacity: 1 - progress }} />
                <div className="absolute inset-0 bg-white" style={{ opacity: progress }} />
            </div>

            <header className="sticky top-0 z-20 flex h-screen items-center justify-center px-6 pointer-events-none">
                <div className="text-center transition-transform duration-75 ease-out pointer-events-auto" style={{ transform: `translateY(${titleTranslateY}px)`, color: titleColor }}>
                    <h1 className="text-7xl font-black tracking-tighter" style={{ textShadow: "0 8px 24px rgba(0, 0, 0, 0.35)" }}>sisyfuzZz</h1>
                    <p className="mt-3 text-lg font-medium opacity-80" style={{ textShadow: "0 4px 14px rgba(0, 0, 0, 0.28)" }}>a.k.a. Dorus Kleijne</p>
                </div>
            </header>

            <main className="relative z-10 mx-auto max-w-2xl px-6 pb-60">
                <section className="mt-12 text-black">
                    <h2 className="text-3xl font-semibold tracking-tight uppercase">artist_statement</h2>
                    <div className="mt-8 space-y-8 text-lg leading-relaxed text-justify indent-2">
                        <p className="italic text-gray-600 font-light">"Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."</p>
                        <p>Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.</p>
                    </div>
                </section>
            </main>
        </div>
    );
}