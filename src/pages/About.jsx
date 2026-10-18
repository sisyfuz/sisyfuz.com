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
        <div className="min-h-screen bg-black text-white font-body pb-36">
            {/* Top Navigation */}
            <header className="px-6 md:px-12 lg:px-20 pt-8 pb-4 flex items-center justify-between border-b border-white/10">
                <span className="font-mono text-xs text-white/40 tracking-widest uppercase">
                    _about
                </span>
                <Link
                    to="/"
                    className="font-mono text-xs text-white/50 hover:text-pink-500 transition-colors tracking-widest uppercase"
                >
                    ← Back
                </Link>
            </header>

            <main className="max-w-7xl mx-auto px-6 md:px-12 lg:px-20 pt-10 md:pt-14">
                {/* Title Section */}
                <div className="pb-10 mb-12 border-b border-white/10">
                    <h1 className="font-title text-5xl sm:text-7xl lg:text-8xl font-black uppercase tracking-tight text-white leading-none">
                        Dorus Kleijne
                    </h1>
                </div>

                {/* 2-Column Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
                    
                    {/* Left Column: Original Texts */}
                    <div className="lg:col-span-7 flex flex-col gap-10">

                        {/* Over Mij Card */}
                        <div className="border border-white/20 bg-white/5">
                            <div className="font-mono bg-white text-black px-4 py-2 text-[10px] font-bold tracking-widest uppercase">
                                ▸ OVER MIJ
                            </div>
                            <div className="px-5 py-5 flex flex-col gap-3 text-xs">
                                <div className="flex gap-4">
                                    <span className="font-mono text-white/40 w-24 shrink-0 uppercase tracking-wider">Plekje</span>
                                    <span className="font-body text-white uppercase tracking-widest">Utrecht, NL</span>
                                </div>
                                <div className="flex gap-4">
                                    <span className="font-mono text-white/40 w-24 shrink-0 uppercase tracking-wider">Wat dan?</span>
                                    <span className="font-body text-white uppercase tracking-widest">Theater × Kunst × Tech</span>
                                </div>
                            </div>
                        </div>

                        {/* Main Statement */}
                        <div className="border-l-2 border-pink-500 pl-6 flex flex-col gap-4">
                            <div className="flex flex-col gap-4 text-base md:text-lg leading-relaxed text-neutral-200">
                                <p className="font-body">
                                    &gt; Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.
                                </p>
                                <p className="font-body text-neutral-300">
                                    &gt; Sci-fi als taal. Queer als basishouding.
                                </p>
                                <p className="font-body text-pink-500 pt-2">
                                    &gt;&nbsp;
                                    <Link to="/contact" className="hover:underline transition-colors font-medium">
                                        stuur een bericht →
                                    </Link>
                                </p>
                            </div>
                        </div>


                    </div>

                    {/* Right Column: Clean Artist Portrait */}
                    <div className="lg:col-span-5">
                        <div
                            className="relative border border-white/15 bg-neutral-950 p-3 group cursor-zoom-in transition-colors hover:border-pink-500/50"
                            onClick={() => assets?.profileImage && setIsLightboxOpen(true)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') assets?.profileImage && setIsLightboxOpen(true); }}
                            aria-label="Expand photo"
                        >
                            <div className="relative aspect-[3/4] w-full overflow-hidden bg-neutral-900 flex items-center justify-center">
                                {assets?.profileImage ? (
                                    <img
                                        src={urlFor(assets.profileImage).width(1200).format('webp').url()}
                                        alt="Dorus Kleijne"
                                        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                                    />
                                ) : (
                                    <div className="font-mono text-xs text-white/30 uppercase tracking-widest">
                                        [loading from sanity...]
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                <span>DORUS KLEIJNE</span>
                                <span className="text-pink-500/80 group-hover:text-pink-500 transition-colors">[ PRESS TO EXPAND ]</span>
                            </div>
                        </div>
                    </div>

                </div>
            </main>

            {/* Lightbox */}
            {isLightboxOpen && assets?.profileImage && (
                <div
                    className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col p-4 md:p-8 cursor-zoom-out"
                    onClick={() => setIsLightboxOpen(false)}
                >
                    <div
                        className="flex items-center justify-between pb-4 border-b border-white/10 font-mono text-xs uppercase tracking-widest text-white/50 cursor-default"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <span className="text-pink-500">[FULL_RES_VIEW] — SRC: SANITY CMS</span>
                        <button
                            onClick={() => setIsLightboxOpen(false)}
                            className="border border-white/20 px-3 py-1 text-white hover:border-pink-500 hover:text-pink-500 transition-colors uppercase cursor-pointer"
                        >
                            Close ×
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