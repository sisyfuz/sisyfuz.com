// src/tui/TuiContact.jsx
import { ASCII_DIVIDER } from "../utils/ascii";

export default function TuiContact() {
    return (
        <div className="space-y-[1lh] max-w-[96ch] animate-fadeIn">
            <div className="">
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

            <div className="space-y-[1lh]">
                <div>
                    <span className="text-neutral-500 uppercase block">EMAIL DIRECT:</span>
                    <a
                        href="mailto:info@sisyfuz.com"
                        className="text-white hover:bg-white hover:text-black font-bold uppercase px-[1ch] -ml-[1ch] inline-block transition-colors"
                    >
                        [INFO@SISYFUZ.COM]
                    </a>
                </div>


            </div>
        </div>
    );
}
