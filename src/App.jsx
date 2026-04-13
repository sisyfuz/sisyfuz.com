import { useEffect, useState } from "react";

// --- GLOBAL STYLES INJECTIE ---
// Dit zorgt ervoor dat de animatie ALTIJD werkt, ook op je live domein.
const GlobalStyles = () => (
    <style dangerouslySetInnerHTML={{ __html: `
    @keyframes marqueeScroll {
      0% { transform: translateX(0%); }
      100% { transform: translateX(-50%); }
    }
    .marquee-active {
      display: flex !important;
      width: max-content !important;
      animation: marqueeScroll 25s linear infinite !important;
    }
  `}} />
);

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

// --- CUSTOM HOOK VOOR SCROLL ---
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

// --- MARQUEE COMPONENT ---
const MarqueeMenu = ({ isVisible }) => {
    const menuItems = ["_work", "_archive", "_contact", "_about", "_home"];

    return (
        <div
            className={`fixed bottom-0 left-0 w-full z-50 bg-black py-4 border-t border-white/10 overflow-hidden whitespace-nowrap transition-transform duration-700 ease-in-out 
            ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}
        >
            {/* Let op: class is nu 'marquee-active' ipv 'animate-marquee' */}
            <div className="flex marquee-active hover:[animation-play-state:paused] cursor-crosshair w-max">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex shrink-0">
                        {menuItems.map((item, index) => (
                            <span
                                key={index}
                                className="text-white text-[10px] font-mono uppercase tracking-[0.3em] px-12 hover:text-pink-500 transition-colors duration-300"
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---
function App() {
    const progress = useScrollProgress(CONFIG.scrollRange);

    const titleColor = getInterpolatedColor(progress, CONFIG.colors);
    const titleTranslateY = progress * -360;
    const showMenu = progress > 0.1;

    return (
        <div className="relative min-h-[250vh] bg-white text-slate-900 font-sans">
            {/* Injecteer de stijlen hier */}
            <GlobalStyles />

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
                    <h1
                        className="text-7xl font-black tracking-tighter"
                        style={{ textShadow: "0 8px 24px rgba(0, 0, 0, 0.35)" }}
                    >
                        sisyfuzZz
                    </h1>
                    <p
                        className="mt-3 text-lg font-medium opacity-80"
                        style={{ textShadow: "0 4px 14px rgba(0, 0, 0, 0.28)" }}
                    >
                        a.k.a. Dorus Kleijne
                    </p>
                </div>
            </header>

            {/* Content Layer */}
            <main className="relative z-10 mx-auto max-w-2xl px-6 pb-60">
                <section className="mt-12">
                    <h2 className="text-3xl font-semibold tracking-tight text-black">
                        artist_statement
                    </h2>

                    <div className="mt-8 space-y-8 text-lg leading-relaxed text-black text-justify indent-2 hyphens-auto">
                        <p className="italic text-gray-600 font-light">
                            "Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."
                        </p>
                        <p>
                            Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk.
                            Doormiddel van sci-fi onstaan ruizige ervaringen, die inherent queer zijn. De ervaringen
                            hebben een nadruk op beeld en geluid en wordt tekst een ritmisch instrument in plaats
                            van inhoudelijk.
                        </p>
                    </div>
                </section>
            </main>

            <MarqueeMenu isVisible={showMenu} />
        </div>
    );
}

export default App;