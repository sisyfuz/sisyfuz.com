// src/pages/NotFound.jsx
import { Link } from "react-router-dom";
import { useTypography } from "../hooks/useTypography";

export default function NotFound() {
    useTypography();

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 font-mono uppercase text-center relative overflow-hidden">

            <div className="absolute inset-0 opacity-10 pointer-events-none"
                 style={{
                     backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 4px)',
                     backgroundSize: '100% 4px'
                 }}
            />

            <div className="relative z-10 flex flex-col items-center">
                <h1 className="font-title text-8xl md:text-[12rem] font-black text-pink-500 mb-2 tracking-tighter" style={{ textShadow: "0 0 40px rgba(255, 105, 180, 0.4)" }}>
                    404
                </h1>

                <h2 className="font-title text-xl md:text-3xl mb-6 tracking-widest text-slate-300">
                    _YOU'VE_ENTERED_THE_VOID
                </h2>

                <div className="max-w-md text-slate-500 text-xs md:text-sm leading-relaxed mb-12 normal-case text-justify">
                    <p className="font-body mb-4">
                        [ERROR] Wat doe je hier? Dit is niet iets.
                    </p>
                    <p className="font-body italic font-light">
                        Rol die steen maar opnieuw naar boven. Deze pagina bestaat niet (meer).
                    </p>
                </div>

                <Link
                    to="/"
                    className="group flex items-center gap-4 border border-white/20 px-8 py-4 hover:border-pink-500/50 transition-all duration-300"
                >
                    <span className="w-2 h-2 bg-pink-500 group-hover:animate-ping" />
                    <span className="font-mono text-[10px] tracking-[0.3em] group-hover:text-pink-500 transition-colors">
                        initiate_return_sequence
                    </span>
                </Link>
            </div>
        </div>
    );
}
