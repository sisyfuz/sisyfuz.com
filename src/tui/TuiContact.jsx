// src/tui/TuiContact.jsx
import { ASCII_DIVIDER } from "../utils/ascii";

export default function TuiContact() {
    return (
        <div className="space-y-6 max-w-3xl animate-fadeIn text-xs sm:text-[13px] leading-relaxed">
            <div className="space-y-2">
                <span className="font-bold uppercase text-white block">
                    CONTACT // INQUIRIES
                </span>
                <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>
                <p className="text-neutral-400">
                    Voor vragen, samenwerkingen, residenties of dramaturgie:
                </p>
            </div>

            <div className="space-y-4 pt-2">
                <div>
                    <span className="text-neutral-500 uppercase block mb-1">EMAIL DIRECT:</span>
                    <a
                        href="mailto:info@sisyfuz.com"
                        className="text-white hover:bg-white hover:text-black font-bold uppercase px-1 -mx-1"
                    >
                        [INFO@SISYFUZ.COM]
                    </a>
                </div>

                <div>
                    <span className="text-neutral-500 uppercase block mb-1">SOCIAL:</span>
                    <a
                        href="https://instagram.com/sisyfuz"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white hover:bg-white hover:text-black font-bold uppercase px-1 -mx-1"
                    >
                        [INSTAGRAM.COM/SISYFUZ]
                    </a>
                </div>
            </div>
        </div>
    );
}
