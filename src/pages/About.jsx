// src/pages/About.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { client } from '../sanityClient';
import { urlFor } from '../components/sanityImage';

const GLITCH_CHARS = '!@#░▒▓█▄▀■□▪▫';

export default function About() {
    const [assets, setAssets] = useState(null);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);
    const [time, setTime] = useState('');
    const [loadPct, setLoadPct] = useState(0);
    const [glitchChar, setGlitchChar] = useState('_');

    // Sanity CMS fetch
    useEffect(() => {
        client.fetch(`*[_type == "aboutAssets"][0]`).then(setAssets);
    }, []);

    // Live clock
    useEffect(() => {
        const tick = () => {
            const now = new Date();
            setTime([now.getHours(), now.getMinutes(), now.getSeconds()]
                .map(n => String(n).padStart(2, '0')).join(':'));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    // Fake loading bar on mount
    useEffect(() => {
        let pct = 0;
        const id = setInterval(() => {
            pct += Math.floor(Math.random() * 18) + 4;
            if (pct >= 100) { setLoadPct(100); clearInterval(id); return; }
            setLoadPct(pct);
        }, 110);
        return () => clearInterval(id);
    }, []);

    // Random glitch char in system log
    useEffect(() => {
        const id = setInterval(() => {
            if (Math.random() > 0.65) {
                setGlitchChar(GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]);
                setTimeout(() => setGlitchChar('_'), 80);
            }
        }, 600);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        document.body.style.overflow = isLightboxOpen ? 'hidden' : 'unset';
        return () => { document.body.style.overflow = 'unset'; };
    }, [isLightboxOpen]);

    return (
        <>
            <style>{`
                @keyframes chromaShift {
                    0%, 100% { text-shadow: -3px 0 2px rgba(255,0,128,0.55), 3px 0 2px rgba(0,200,255,0.55); }
                    50%       { text-shadow:  3px 0 2px rgba(255,0,128,0.55),-3px 0 2px rgba(0,200,255,0.55); }
                }
                @keyframes titleGlitch {
                    0%, 88%, 93%, 100% { transform: translateX(0) skewX(0deg); }
                    89% { transform: translateX(-5px) skewX(-1.5deg); }
                    90% { transform: translateX(5px)  skewX(1.5deg);  clip-path: inset(15% 0 55% 0); }
                    91% { transform: translateX(-3px) skewX(0deg);    clip-path: inset(55% 0 15% 0); }
                    92% { transform: translateX(0);                    clip-path: none; }
                }
                @keyframes vhsFlicker {
                    0%, 93.5%, 95.5%, 100% { opacity: 1; }
                    94%  { opacity: 0.96; }
                    95%  { opacity: 0.98; }
                }
                @keyframes insertCoin {
                    0%, 45%, 100% { opacity: 1; }
                    50%, 95%      { opacity: 0; }
                }
                @keyframes screenTear {
                    0%   { top: -2%; opacity: 0; }
                    5%   { opacity: 1; }
                    95%  { opacity: 1; }
                    100% { top: 102%; opacity: 0; }
                }
                @keyframes loadBar {
                    from { width: 0%; }
                    to   { width: 100%; }
                }
                .chroma-shift  { animation: chromaShift 4s ease-in-out infinite; }
                .title-glitch  { animation: titleGlitch 14s steps(1) infinite, chromaShift 4s ease-in-out infinite; }
                .vhs-flicker   { animation: vhsFlicker 22s steps(1) infinite; }
                .insert-coin   { animation: insertCoin 2s step-end infinite; }
                .screen-tear {
                    position: absolute; left: 0; right: 0; height: 2px;
                    background: rgba(255,255,255,0.18);
                    mix-blend-mode: screen;
                    animation: screenTear 9s linear infinite;
                    pointer-events: none;
                }
                .scanlines {
                    background: repeating-linear-gradient(
                        to bottom,
                        transparent 0px, transparent 3px,
                        rgba(0,0,0,0.055) 3px, rgba(0,0,0,0.055) 4px
                    );
                    pointer-events: none;
                }
            `}</style>

            {/* Scanlines overlay */}
            <div className="fixed inset-0 z-[30] scanlines" />

            <main className="min-h-screen bg-[#f0ede6] text-black font-mono relative overflow-x-hidden vhs-flicker">

                {/* ── Top nav strip (no REC, just clock + back) ── */}
                <div className="px-5 md:px-10 lg:px-20 pt-6 flex items-center justify-between">
                    <span className="text-[10px] text-black/30 tracking-widest tabular-nums">{time}</span>
                    <Link to="/" className="text-[11px] text-black/40 hover:text-black transition-colors tracking-widest uppercase">
                        ← Back
                    </Link>
                </div>

                {/* ── Title ── */}
                <div className="px-5 md:px-10 lg:px-20 pt-8 pb-8 border-b-2 border-black/10">
                    <h1 className="text-[clamp(2rem,6vw,5rem)] font-black leading-none tracking-tight text-black title-glitch select-none whitespace-nowrap">
                        Dorus Kleijne
                    </h1>
                    <div className="mt-4 flex items-center gap-4">
                        <p className="text-[10px] tracking-[0.25em] text-black/30 uppercase">
                            // MEMORY_CARD_01 — BIG_BLOOP — 2006 //
                        </p>
                        {/* Loading bar */}
                        <div className="flex items-center gap-2 ml-auto">
                            <span className="text-[9px] text-black/25 tracking-widest uppercase shrink-0">
                                INIT {loadPct}%
                            </span>
                            <div className="w-24 h-1 bg-black/10 overflow-hidden">
                                <div
                                    className="h-full bg-pink-500 transition-all duration-100"
                                    style={{ width: `${loadPct}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Content grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2">

                    {/* Left: mixed editorial + PSX */}
                    <div className="px-5 md:px-10 lg:px-20 py-12 flex flex-col gap-10 border-r border-black/15">

                        {/* PSX stats — kept as the "game UI" anchor */}
                        <div className="border border-black/25 bg-white/60">
                            <div className="bg-black text-[#f0ede6] px-4 py-2 text-[10px] tracking-widest uppercase">
                                ▸ OVER MIJ
                            </div>
                            <div className="px-4 py-5 flex flex-col gap-3 text-xs">
                                <div className="flex gap-4">
                                    <span className="text-black/35 w-20 shrink-0 uppercase tracking-wider">Plekje</span>
                                    <span className="uppercase tracking-widest">Utrecht, NL</span>
                                </div>
                                <div className="flex gap-4">
                                    <span className="text-black/35 w-20 shrink-0 uppercase tracking-wider">Wat dan?</span>
                                    <span className="uppercase tracking-widest">Theater × Kunst × Tech</span>
                                </div>
                            </div>
                        </div>

                        {/* Bio — open editorial style, no heavy box */}
                        <div className="border-l-2 border-pink-500 pl-6 flex flex-col gap-4">
                            <div className="flex flex-col gap-3 text-sm leading-relaxed text-black/55 font-mono">
                                <p>&gt; Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.</p>
                                <p>&gt; Sci-fi als taal. Queer als basishouding.</p>
                                <p className="text-pink-500 mt-1">
                                    &gt;&nbsp;<Link to="/contact" className="hover:underline transition-colors">stuur een bericht →</Link>
                                </p>
                                <p className="text-black/20">&gt; {glitchChar}</p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="mt-auto flex items-end justify-between pt-8 border-t border-black/8">
                            <p className="text-[10px] text-black/20 tracking-widest uppercase leading-loose">
                                [badabum!]<br />
                            </p>
                            <span className="insert-coin text-[11px] text-black/40 tracking-widest uppercase">
                                INSERT COIN
                            </span>
                        </div>
                    </div>

                    {/* Right: image — taller, more dominant */}
                    <div
                        className="relative cursor-crosshair overflow-hidden"
                        style={{ minHeight: '80vh' }}
                        onClick={() => assets?.profileImage && setIsLightboxOpen(true)}
                        role="button"
                        aria-label="Expand photo"
                    >
                        {assets?.profileImage ? (
                            <>
                                <img
                                    src={urlFor(assets.profileImage).width(1000).format('webp').url()}
                                    alt="Dorus Kleijne"
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{ filter: 'contrast(1.08) saturate(0.8)' }}
                                />
                                {/* CRT vignette */}
                                <div
                                    className="absolute inset-0 pointer-events-none"
                                    style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)' }}
                                />
                                {/* Screen tear */}
                                <div className="screen-tear" />
                                {/* Corner brackets */}
                                <div className="absolute top-3 left-3  w-5 h-5 border-t-2 border-l-2 border-white/60 pointer-events-none" />
                                <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-white/60 pointer-events-none" />
                                <div className="absolute bottom-10 left-3  w-5 h-5 border-b-2 border-l-2 border-white/60 pointer-events-none" />
                                <div className="absolute bottom-10 right-3 w-5 h-5 border-b-2 border-r-2 border-white/60 pointer-events-none" />
                                <p className="absolute bottom-4 inset-x-0 text-center text-[10px] text-white/45 tracking-widest uppercase pointer-events-none">
                                    [ PRESS TO EXPAND ]
                                </p>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-black/20">
                                [loading from sanity...]
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* ── Lightbox ── */}
            {isLightboxOpen && assets?.profileImage && (
                <div
                    className="fixed inset-0 z-[60] bg-black/96 flex flex-col cursor-zoom-out"
                    onClick={() => setIsLightboxOpen(false)}
                >
                    <div
                        className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black cursor-default"
                        onClick={e => e.stopPropagation()}
                    >
                        <span className="font-mono text-[10px] text-white/30 tracking-widest uppercase">
                            [FULL_RES_VIEW] — SRC: SANITY CMS
                        </span>
                        <button
                            onClick={() => setIsLightboxOpen(false)}
                            className="font-mono text-[11px] text-white/50 hover:text-white transition-colors tracking-widest uppercase border border-white/20 hover:border-white/60 px-4 py-2"
                        >
                            Close ×
                        </button>
                    </div>
                    <div
                        className="flex-1 flex items-center justify-center p-6 overflow-auto cursor-default"
                        onClick={e => e.stopPropagation()}
                    >
                        <img
                            src={urlFor(assets.profileImage).width(1600).format('webp').url()}
                            alt="Dorus Kleijne"
                            className="max-w-full max-h-full object-contain"
                        />
                    </div>
                </div>
            )}
        </>
    );
}
