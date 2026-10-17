// src/tui/TuiAbout.jsx
import { useState, useEffect } from "react";
import { client } from "../sanityClient";
import AsciiMedia from "../components/AsciiMedia";
import { ASCII_DIVIDER } from "../utils/ascii";

export default function TuiAbout({ onNavigate }) {
    const [assets, setAssets] = useState(null);

    useEffect(() => {
        client.fetch(`*[_type == "aboutAssets"][0]`).then(setAssets);
    }, []);

    const imageUrl = assets?.profileImage?.asset?.url || (typeof assets?.profileImage === "string" ? assets.profileImage : null);

    return (
        <div className="space-y-8 animate-fadeIn max-w-4xl text-xs sm:text-[13px] leading-relaxed">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
                {/* Left Column: Authentic Statements */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="space-y-3">
                        <span className="font-bold uppercase text-white block">
                            DORUS KLEIJNE (2006)
                        </span>
                        <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                            {ASCII_DIVIDER}
                        </div>
                        <div className="space-y-3 text-neutral-300">
                            <p>
                                Dorus Kleijne maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.
                            </p>
                            <p className="text-neutral-400">
                                Sci-fi als taal. Queer als basishouding.
                            </p>
                            <p className="text-neutral-400 italic">
                                &gt; "Ik noem mezelf sisyfuz, omdat ik blijf proberen als Sisyphos."
                            </p>
                        </div>
                    </div>

                    {/* Metadata Specs */}
                    <div className="space-y-1.5 text-neutral-400 pt-2 uppercase">
                        <div>
                            <span className="text-neutral-500">PLEKJE:</span> <span className="text-white">UTRECHT, NL</span>
                        </div>
                        <div>
                            <span className="text-neutral-500">WAT DAN?:</span> <span className="text-white">THEATER × KUNST × TECH</span>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={() => onNavigate && onNavigate("contact")}
                            className="text-white hover:bg-white hover:text-black font-bold uppercase px-1 -mx-1 cursor-pointer"
                        >
                            [STUUR_EEN_BERICHT →]
                        </button>
                    </div>

                    <div className="pt-4">
                        <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap mb-2">
                            {ASCII_DIVIDER}
                        </div>
                        <p className="text-[11px] text-neutral-500 uppercase leading-relaxed font-mono">
                            [badabum! fonts by: Sligoil by Ariel Martín Pérez, with the contribution of Đông Trúc Nguyễn. Distributed by velvetyne.fr.]
                        </p>
                    </div>
                </div>

                {/* Right Column: ASCII Portrait with Cellular Wipe */}
                <div className="lg:col-span-5 space-y-2">
                    {imageUrl ? (
                        <AsciiMedia
                            src={imageUrl}
                            alt="Dorus Kleijne Portrait"
                            cols={50}
                            aspectRatio="aspect-[3/4]"
                        />
                    ) : (
                        <div className="p-16 text-center text-neutral-600 uppercase">
                            [LOADING_PORTRAIT...]
                        </div>
                    )}
                    <div className="text-[11px] text-neutral-500 uppercase">
                        // DORUS KLEIJNE (STUDIO PORTRAIT)
                    </div>
                </div>
            </div>
        </div>
    );
}
