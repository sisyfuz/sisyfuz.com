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
                        className="text-white hover:bg-white hover:text-black font-bold uppercase py-1 px-2 -ml-2 inline-block transition-colors"
                    >
                        [INFO@SISYFUZ.COM]
                    </a>
                </div>


            </div>
        </div>
    );
}
