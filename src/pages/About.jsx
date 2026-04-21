// src/pages/About.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { client } from '../sanityClient';
import { urlFor } from '../components/sanityImage';

export default function About() {
    const [assets, setAssets] = useState(null);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);

    useEffect(() => {
        const fetchAssets = async () => {
            const data = await client.fetch(`*[_type == "aboutAssets"][0]`);
            setAssets(data);
        };
        fetchAssets();
    }, []);

    useEffect(() => {
        if (isLightboxOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isLightboxOpen]);

    return (
        <main className="min-h-screen bg-[#050505]/80 text-gray-300 font-sans p-6 md:p-12 lg:p-24 overflow-x-hidden selection:bg-pink-500 selection:text-black">

            {/* =========================================
                HEADER (Strakke layout, gecontroleerde glitch)
            ========================================= */}
            <header className="mb-16 lg:mb-32 flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/10 pb-8 relative z-20">

                {/* De Glitch Titel */}
                <div className="relative group cursor-default w-fit">
                    {/* Zichtbare hoofdtekst */}
                    <h1 className="relative text-5xl md:text-6xl lg:text-7xl font-black text-white tracking-tight">
                        Dorus Kleijne
                    </h1>
                </div>

                {/* Meta data (Strak rechts uitgelijnd op desktop) */}
                <div className="font-mono text-xs tracking-[0.2em] uppercase flex items-center lg:justify-end gap-3 text-gray-500">
                    <span>[big_bloop]</span>
                    <span className="text-pink-500 animate-pulse">•</span>
                    <span className="text-white">BOUWJAAR 2006</span>
                </div>
            </header>

            {/* =========================================
                GRID LAYOUT (Beter gebalanceerd, 12 kolommen)
            ========================================= */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 items-center relative z-10">

                {/* KOLOM LINKS: Verhaal (5 kolommen breed) */}
                <div className="lg:col-span-5 flex flex-col gap-12">

                    {/* Bio sectie: Gebruikt nu een strakke border-l in plaats van een absolute positie */}
                    <section className="border-l-2 border-pink-500/50 pl-6 lg:pl-8 py-2">
                        <h2 className="text-2xl font-bold text-white mb-6 tracking-tight">
                            bloep bliep
                        </h2>
                        <div className="flex flex-col gap-6 text-base lg:text-lg leading-relaxed text-gray-400">
                            <p>
                                bliep bloep bingo
                            </p>
                            <p>
                                bliep bliep bliep
                            </p>
                        </div>
                    </section>

                    {/* Details (Strak uitgelijnd in een sub-grid) */}
                    <section className="grid grid-cols-2 gap-4 font-mono text-xs tracking-widest text-gray-500 border-t border-white/5 pt-8 mt-4">
                        <div className="flex flex-col gap-1 hover:text-pink-400 transition-colors cursor-crosshair">
                            <span className="text-white/40 mb-1">LOCATIE</span>
                            <span>UTRECHT, NL</span>
                        </div>
                        <div className="flex flex-col gap-1 hover:text-cyan-400 transition-colors cursor-crosshair">
                            <span className="text-white/40 mb-1">DISCIPLINE</span>
                            <span>INTERDISCIPLINAIR</span>
                        </div>
                    </section>

                    {/* Back Link */}
                    <div className="mt-8">
                        <Link to="/" className="group inline-flex items-center gap-4 font-mono text-xs tracking-widest uppercase text-white hover:text-pink-400 transition-colors">
                            <span className="text-pink-500 group-hover:-translate-x-2 transition-transform duration-300">←</span>
                            <span>Terug_naar_basis</span>
                        </Link>
                    </div>
                </div>

                {/* KOLOM RECHTS: Afbeelding (5 kolommen breed, start in kolom 8 voor lege ruimte in het midden) */}
                <div className="lg:col-span-5 lg:col-start-8 relative group cursor-zoom-in">

                    {/* Glitch Achtergrond Blokken (Nu netjes weggewerkt achter de foto) */}
                    <div className="absolute inset-0 bg-cyan-500 opacity-0 group-hover:opacity-30 group-hover:-translate-x-3 group-hover:translate-y-3 transition-all duration-500 mix-blend-screen z-0"></div>
                    <div className="absolute inset-0 bg-pink-500 opacity-0 group-hover:opacity-30 group-hover:translate-x-3 group-hover:-translate-y-3 transition-all duration-500 mix-blend-screen z-0"></div>

                    {/* De Afbeelding Container */}
                    <div className="relative z-10 bg-white/5 p-1 backdrop-blur-sm border border-white/10" onClick={() => setIsLightboxOpen(true)}>
                        {assets?.profileImage ? (
                            <img
                                src={urlFor(assets.profileImage).width(800).format('webp').url()}
                                alt="Dorus Kleijne"
                                className="w-full aspect-[3/4] object-cover contrast-110 saturate-105"
                            />
                        ) : (
                            <div className="w-full aspect-[3/4] flex items-center justify-center font-mono text-xs text-gray-600 bg-black">
                                [AFBEELDING_LADEN...]
                            </div>
                        )}

                        {/* Scanning line */}
                        <div className="absolute inset-0 overflow-hidden pointer-events-none">
                            <div className="w-full h-[1px] bg-white/30 absolute top-0 animate-[scan_4s_ease-in-out_infinite] shadow-[0_0_8px_rgba(255,255,255,0.5)]"></div>
                        </div>
                    </div>
                </div>

            </div>

            {/* =========================================
                LIGHTBOX
            ========================================= */}
            {isLightboxOpen && assets?.profileImage && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 md:p-8 cursor-zoom-out transition-all duration-300" onClick={() => setIsLightboxOpen(false)}>
                    <div
                        className="relative w-full max-w-5xl shadow-[0_0_60px_rgba(236,72,153,0.1)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={urlFor(assets.profileImage).width(1600).format('webp').url()}
                            alt="Dorus Kleijne High Resolution"
                            className="w-full h-auto max-h-[90vh] object-contain"
                        />
                        <button
                            onClick={() => setIsLightboxOpen(false)}
                            className="absolute top-4 right-4 bg-black/60 text-white hover:text-pink-500 font-mono text-xs px-4 py-2 backdrop-blur-md border border-white/20 transition-colors uppercase tracking-widest"
                        >
                            Sluiten [X]
                        </button>
                    </div>
                </div>
            )}
        </main>
    );
}