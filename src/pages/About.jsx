import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { client } from '../sanityClient';
import { urlFor } from '../components/sanityImage';
import { useTypography } from '../hooks/useTypography';

export default function About() {
    useTypography();

    const [assets, setAssets] = useState(null);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);

    useEffect(() => {
        client.fetch(`*[_type == "aboutAssets"][0]`).then(setAssets);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setIsLightboxOpen(false);
        };
        if (isLightboxOpen) {
            window.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'unset';
        };
    }, [isLightboxOpen]);

    return (
        <div className="min-h-screen bg-black text-white font-body selection:bg-pink-500 selection:text-white pb-36">
            {/* Top Navigation & Dossier Stamp */}
            <header className="border-b border-white/10 px-6 md:px-12 py-6 flex items-center justify-between text-xs font-mono uppercase tracking-[0.25em]">
                <div className="flex items-center gap-3 text-white/50">
                    <span className="w-1.5 h-1.5 bg-pink-500 inline-block animate-pulse"></span>
                    <span>DOSSIER // REF. 2006-DK</span>
                </div>
                <Link
                    to="/"
                    className="text-white/50 hover:text-pink-500 transition-colors duration-200"
                >
                    [ RETURN_INDEX ]
                </Link>
            </header>

            <main className="max-w-7xl mx-auto px-6 md:px-12 pt-12 md:pt-20">
                {/* Header Title Section */}
                <div className="border-b border-white/10 pb-12 mb-16">
                    <div className="font-mono text-xs uppercase tracking-[0.35em] text-pink-500 mb-4">
                        _ARTIST_PROFILE & METHODOLOGY
                    </div>
                    <h1 className="font-title text-5xl sm:text-7xl lg:text-9xl font-black uppercase tracking-tighter leading-none mb-6">
                        Dorus Kleijne
                    </h1>
                    <p className="font-mono text-xs sm:text-sm text-neutral-400 uppercase tracking-[0.2em] max-w-3xl leading-relaxed">
                        Interdisciplinary Artist & Scenographer // Operating within queer ontology, speculative sci-fi & algorithmic friction.
                    </p>
                </div>

                {/* Main 2-Column Editorial Spread */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
                    
                    {/* Left Column: Pretentious Theory & Statement */}
                    <div className="lg:col-span-7 space-y-16">
                        
                        {/* Statement / Manifesto */}
                        <section className="space-y-6">
                            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
                                01 // ARTISTIC_STATEMENT
                            </div>
                            
                            <blockquote className="border-l-2 border-pink-500 pl-6 py-1 italic font-light text-xl sm:text-2xl text-neutral-200 leading-snug">
                                "Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."
                            </blockquote>

                            <div className="space-y-6 text-sm sm:text-base leading-relaxed text-neutral-300">
                                <p>
                                    Dorus Kleijne (b. 2006, Netherlands) is an interdisciplinary artist whose practice operates at the intersection of queer ontology, sci-fi worldbuilding, and abrasive noise. Rooted in the myth of Sisyphus, the work treats perpetual recurrence and systemic friction not as failure, but as a fertile ground for critical resistance.
                                </p>
                                <p className="text-neutral-400">
                                    Dorus Kleijne maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn. Door conventionele theatercodes te ontregelen met synthetische systemen en materiële frictie, nodigen de installaties en performances uit tot een herijking van het menselijk lichaam binnen technologische ecologieën.
                                </p>
                            </div>
                        </section>

                        {/* Specification Matrix */}
                        <section className="space-y-4 pt-4 border-t border-white/10">
                            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40 mb-6">
                                02 // PRACTICE_SPECIFICATIONS
                            </div>

                            <div className="border border-white/10 divide-y divide-white/10 font-mono text-xs">
                                <div className="grid grid-cols-1 sm:grid-cols-3 p-4 gap-2">
                                    <span className="text-white/40 uppercase tracking-widest">Base / Location</span>
                                    <span className="sm:col-span-2 text-white uppercase tracking-wider">Utrecht, The Netherlands</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 p-4 gap-2">
                                    <span className="text-white/40 uppercase tracking-widest">Disciplines</span>
                                    <span className="sm:col-span-2 text-neutral-200 uppercase tracking-wider">Scenography × Theater × Creative Tech × Noise</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 p-4 gap-2">
                                    <span className="text-white/40 uppercase tracking-widest">Conceptual Axes</span>
                                    <span className="sm:col-span-2 text-neutral-200 uppercase tracking-wider">Queer Cybernetics, Speculative Futures, Absurdist Form</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 p-4 gap-2">
                                    <span className="text-white/40 uppercase tracking-widest">Status</span>
                                    <span className="sm:col-span-2 text-pink-400 uppercase tracking-wider">Active Practice / Inquiries Open</span>
                                </div>
                            </div>
                        </section>

                        {/* Methodological Pillars */}
                        <section className="space-y-8 pt-4 border-t border-white/10">
                            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
                                03 // THEORETICAL_FRAMEWORKS
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <div className="space-y-2 border-t border-white/20 pt-4">
                                    <span className="font-mono text-[11px] text-pink-500 uppercase tracking-widest block">§ 01</span>
                                    <h2 className="font-title text-sm uppercase font-bold tracking-tight text-white">Speculative Sci-Fi</h2>
                                    <p className="text-xs text-neutral-400 leading-relaxed">
                                        Science fiction not as escapism, but as a diagnostic apparatus for dissecting queer identity, bodily estrangement, and digital acceleration.
                                    </p>
                                </div>

                                <div className="space-y-2 border-t border-white/20 pt-4">
                                    <span className="font-mono text-[11px] text-pink-500 uppercase tracking-widest block">§ 02</span>
                                    <h2 className="font-title text-sm uppercase font-bold tracking-tight text-white">The Sisyphean Ethic</h2>
                                    <p className="text-xs text-neutral-400 leading-relaxed">
                                        Subverting capitalist teleology through perpetual attempts. Friction and labor treated as aesthetic matter rather than obstacles.
                                    </p>
                                </div>

                                <div className="space-y-2 border-t border-white/20 pt-4">
                                    <span className="font-mono text-[11px] text-pink-500 uppercase tracking-widest block">§ 03</span>
                                    <h2 className="font-title text-sm uppercase font-bold tracking-tight text-white">Poetic Noise</h2>
                                    <p className="text-xs text-neutral-400 leading-relaxed">
                                        Tactile feedback, sensory distortion, and computational glitch coalescing into uncanny theatrical environments.
                                    </p>
                                </div>
                            </div>
                        </section>

                        {/* Navigation Outposts */}
                        <section className="pt-6 border-t border-white/10 flex flex-wrap gap-4 font-mono text-xs uppercase tracking-widest">
                            <Link
                                to="/work"
                                className="px-5 py-3 bg-white text-black font-bold hover:bg-pink-500 hover:text-white transition-colors duration-200"
                            >
                                View Selected Works →
                            </Link>
                            <Link
                                to="/contact"
                                className="px-5 py-3 border border-white/20 text-neutral-300 hover:border-pink-500 hover:text-pink-500 transition-colors duration-200"
                            >
                                Initiate Contact →
                            </Link>
                            <a
                                href="https://instagram.com/sisyfuz"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-5 py-3 border border-white/20 text-neutral-300 hover:border-pink-500 hover:text-pink-500 transition-colors duration-200"
                            >
                                Instagram ↗
                            </a>
                        </section>
                    </div>

                    {/* Right Column: Institutional Artist Portrait */}
                    <div className="lg:col-span-5">
                        <div className="lg:sticky lg:top-12 space-y-4">
                            <div
                                className="relative border border-white/15 bg-neutral-950 p-3 group cursor-zoom-in overflow-hidden transition-colors hover:border-pink-500/50"
                                onClick={() => assets?.profileImage && setIsLightboxOpen(true)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter') assets?.profileImage && setIsLightboxOpen(true); }}
                                aria-label="Expand artist portrait"
                            >
                                <div className="relative aspect-[3/4] w-full overflow-hidden bg-neutral-900 flex items-center justify-center">
                                    {assets?.profileImage ? (
                                        <img
                                            src={urlFor(assets.profileImage).width(1200).format('webp').url()}
                                            alt="Dorus Kleijne"
                                            className="w-full h-full object-cover grayscale contrast-125 transition-transform duration-700 ease-out group-hover:scale-105 group-hover:grayscale-0"
                                        />
                                    ) : (
                                        <div className="font-mono text-xs text-white/30 uppercase tracking-widest animate-pulse">
                                            [ ARCHIVE_ASSET_LOADING ]
                                        </div>
                                    )}

                                    {/* Subtle Corner Registration Marks */}
                                    <div className="absolute top-2 left-2 text-[9px] font-mono text-white/40 pointer-events-none">+</div>
                                    <div className="absolute top-2 right-2 text-[9px] font-mono text-white/40 pointer-events-none">+</div>
                                    <div className="absolute bottom-2 left-2 text-[9px] font-mono text-white/40 pointer-events-none">+</div>
                                    <div className="absolute bottom-2 right-2 text-[9px] font-mono text-white/40 pointer-events-none">+</div>
                                </div>

                                <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                    <span>FIG. 01 — ARCHIVAL PORTRAIT</span>
                                    <span className="text-pink-500/80 group-hover:text-pink-500 transition-colors">[ ENLARGE + ]</span>
                                </div>
                            </div>

                            {/* Museum Colophon Underneath */}
                            <div className="p-4 border border-white/5 bg-white/[0.02] text-[10px] font-mono text-white/30 uppercase tracking-[0.2em] space-y-2">
                                <p>
                                    Typography dynamically modulated via custom font engine.
                                </p>
                                <p className="text-white/20">
                                    Sisyfuz © 2026 — All rights reserved.
                                </p>
                            </div>
                        </div>
                    </div>

                </div>
            </main>

            {/* Gallery Lightbox */}
            {isLightboxOpen && assets?.profileImage && (
                <div
                    className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col p-4 md:p-8 cursor-zoom-out"
                    onClick={() => setIsLightboxOpen(false)}
                >
                    <div
                        className="flex items-center justify-between pb-4 border-b border-white/10 font-mono text-xs uppercase tracking-widest text-white/50 cursor-default"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <span className="text-pink-500">FIG 01 // DORUS KLEIJNE — FULL_RES_ARCHIVE</span>
                        <button
                            onClick={() => setIsLightboxOpen(false)}
                            className="border border-white/20 px-3 py-1 text-white hover:border-pink-500 hover:text-pink-500 transition-colors uppercase cursor-pointer"
                        >
                            CLOSE [ESC]
                        </button>
                    </div>

                    <div
                        className="flex-1 flex items-center justify-center p-4 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={urlFor(assets.profileImage).width(1800).format('webp').url()}
                            alt="Dorus Kleijne"
                            className="max-h-[85vh] max-w-full object-contain shadow-2xl border border-white/10"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}