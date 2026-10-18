// src/tui/TuiPrivacy.jsx
import { useState } from "react";
import { ASCII_DIVIDER } from "../utils/ascii";

export default function TuiPrivacy({ onNavigate }) {
    const [lang, setLang] = useState("nl"); // "nl" or "en"

    return (
        <div className="space-y-8 animate-fadeIn max-w-4xl text-xs sm:text-[13px] leading-relaxed">
            {/* Header with Language Selector & Back Button */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="font-bold uppercase text-white">
                        {lang === "nl" ? "JURIDISCH // PRIVACYVERKLARING & COLOFON" : "LEGAL // PRIVACY STATEMENT & COLOPHON"}
                    </span>
                </div>

                <div className="flex items-center gap-2 uppercase">
                    <span className="text-neutral-500 text-[11px]">TAAL / LANG:</span>
                    <button
                        onClick={() => setLang("nl")}
                        className={`px-1.5 py-0.5 cursor-pointer font-bold ${
                            lang === "nl" ? "bg-white text-black" : "text-neutral-400 hover:text-white"
                        }`}
                    >
                        [NL]
                    </button>
                    <button
                        onClick={() => setLang("en")}
                        className={`px-1.5 py-0.5 cursor-pointer font-bold ${
                            lang === "en" ? "bg-white text-black" : "text-neutral-400 hover:text-white"
                        }`}
                    >
                        [EN]
                    </button>
                    <button
                        onClick={() => onNavigate && onNavigate("home")}
                        className="ml-2 text-neutral-400 hover:bg-white hover:text-black px-1.5 py-0.5 font-bold cursor-pointer transition-none"
                    >
                        {lang === "nl" ? "[← SLUITEN]" : "[← CLOSE]"}
                    </button>
                </div>
            </div>

            <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                {ASCII_DIVIDER}
            </div>

            {/* Content: Nederlands */}
            {lang === "nl" && (
                <div className="space-y-8 text-neutral-300">
                    {/* 1. Wie ben ik */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            1. VERWERKINGSVERANTWOORDELIJKE (WIE BEN IK?)
                        </h2>
                        <p>
                            Deze website (<span className="text-white">sisyfuz.com</span>) is het persoonlijke portfolio en onderzoeksplatform van:
                        </p>
                        <div className="bg-neutral-950 border border-neutral-800 p-3 space-y-1 font-mono text-[12px] text-neutral-300">
                            <div><span className="text-neutral-500">NAAM:</span> Dorus Kleijne (artiestennaam: sisyfuz)</div>
                            <div><span className="text-neutral-500">HOEDANIGHEID:</span> Zelfstandig kunstenaar / student theater &amp; performance</div>
                            <div><span className="text-neutral-500">LOCATIE:</span> Utrecht, Nederland</div>
                            <div><span className="text-neutral-500">CONTACT DIRECT:</span> <a href="mailto:info@sisyfuz.com" className="text-white underline hover:text-[#ff0080]">info@sisyfuz.com</a></div>
                            <div><span className="text-neutral-500">KVK:</span> Niet-commercieel artistiek/educatief studentenportfolio</div>
                        </div>
                        <p className="text-neutral-400 text-[12px]">
                            Ik hecht grote waarde aan digitale privacy, soevereiniteit en dataminimalisatie. Ik verzamel uitsluitend het absolute minimum aan technische data dat noodzakelijk is om de website en interactieve livestream te laten functioneren.
                        </p>
                    </section>

                    {/* 2. Gegevensverwerking */}
                    <section className="space-y-3">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            2. WELKE PERSOONSGEGEVENS WORDEN VERWERKT?
                        </h2>
                        
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">A. Webserver- en CDN-logs (Hosting)</span>
                                <p className="text-neutral-400">
                                    Wanneer je deze website bezoekt, verwerken onze netwerk- en hostingproviders (GitHub Pages en Cloudflare) automatisch technische verbindingsgegevens: je IP-adres, tijdstip van opvraging, browser user-agent en opgevraagde bestanden.
                                </p>
                                <p className="text-neutral-500 text-[11px]">
                                    Grondslag: Gerechtvaardigd belang (AVG art. 6 lid 1 sub f) ter beveiliging tegen DDoS-aanvallen en veilige contentlevering. Deze logs worden niet door mij geprofileerd of gekoppeld aan identiteiten.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">B. Contact via e-mail</span>
                                <p className="text-neutral-400">
                                    Als je een e-mail stuurt naar <span className="text-white">info@sisyfuz.com</span>, ontvang ik je naam, e-mailadres en de inhoud van je bericht. Ik bewaar deze gegevens uitsluitend om je bericht te beantwoorden en samenwerkingen te onderhouden.
                                </p>
                                <p className="text-neutral-500 text-[11px]">
                                    Grondslag: Uitvoering van een overeenkomst of toestemming (AVG art. 6 lid 1 sub a/b). Bewaartermijn: zolang relevant voor het contact, daarna gewist.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">C. Live Chat &amp; Telemetrie (Livestream /live)</span>
                                <p className="text-neutral-400">
                                    Op de interactieve livestream (<span className="text-white">sisyfuz.com/live</span>) kun je optioneel chatten en beweegt je cursor mee in de TouchDesigner visualisaties:
                                </p>
                                <ul className="list-disc list-inside text-neutral-400 space-y-1 pl-2 text-[12px]">
                                    <li><b className="text-neutral-200">Chatberichten &amp; Schuilnaam:</b> Vluchtig (ephemeral). Er worden maximaal 50 recente berichten in het vluchtige werkgeheugen (RAM) bewaard. Zodra de stream stopt of herstart, worden alle berichten permanent vernietigd.</li>
                                    <li><b className="text-neutral-200">Cursor-telemetrie:</b> Muiscoördinaten (X/Y) worden uitsluitend als anonieme getallen over een WebSocket gestreamd naar mijn TouchDesigner-installatie. Deze coördinaten worden NOOIT opgeslagen, gelogd of gekoppeld aan personen.</li>
                                </ul>
                            </div>

                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">D. Pogingenteller (Metric Counter)</span>
                                <p className="text-neutral-400">
                                    De knop op de tellerpagina verhoogt een anoniem globaal getal in de database. Je IP-adres wordt uitsluitend gedurende een venster van 10 seconden in het werkgeheugen vergeleken ter bescherming tegen geautomatiseerde spamfloods (rate limiting) en wordt daarna gewist.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 3. Cookies & LocalStorage */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            3. COOKIES &amp; LOKALE OPSLAG (GEEN COOKIEBANNER NODIG)
                        </h2>
                        <div className="border border-pink-500/40 bg-pink-500/5 p-3 space-y-2">
                            <p className="text-white font-bold text-[12px]">
                                [!] DEZE WEBSITE GEBRUIKT GEEN TRACKING- OF ADVERTENTIECOOKIES.
                            </p>
                            <p className="text-neutral-300 text-[12px]">
                                Ik gebruik géén Google Analytics, géén Meta/Facebook Pixel, géén advertentie-trackers en géén cookies van derden om je over het internet te volgen.
                            </p>
                            <p className="text-neutral-400 text-[12px]">
                                Wel gebruikt de website browser-<span className="text-white font-mono">localStorage</span> voor strikt functionele instellingen:
                            </p>
                            <ul className="list-disc list-inside text-neutral-400 text-[11px] space-y-0.5 pl-2">
                                <li><code className="text-white">sisyfuz_theme</code>: Onthoudt je gekozen terminalkleur.</li>
                                <li><code className="text-white">sisyfuz_live_muted</code>: Onthoudt of audio in de livestream gedempt staat.</li>
                                <li><code className="text-white">sisyfuz_chat_user</code>: Onthoudt je zelfgekozen schuilnaam in de livechat.</li>
                                <li><code className="text-white">sisyfuz_pressed</code>: Voorkomt per ongeluk dubbel klikken op de tellerknop.</li>
                            </ul>
                            <p className="text-neutral-400 text-[11px] italic">
                                Op grond van artikel 11.7a lid 3 van de Nederlandse Telecommunicatiewet (Cookie-wetgeving) is voor zuiver functionele opslag die geen of geringe gevolgen heeft voor de persoonlijke levenssfeer GEEN cookiemelding of toestemmingsbanner vereist.
                            </p>
                        </div>
                    </section>

                    {/* 4. Subverwerkers */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            4. DERDE PARTIJEN &amp; SUBVERWERKERS
                        </h2>
                        <p className="text-neutral-400">
                            Voor de technische werking werk ik samen met betrouwbare infrastructuurpartners:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] font-mono">
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">CLOUDFLARE, INC. (VS/EU)</b>
                                <div className="text-neutral-500 text-[11px]">DNS, DDoS-mitigatie, Edge Workers (Standard Contractual Clauses).</div>
                            </div>
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">GITHUB, INC. (VS)</b>
                                <div className="text-neutral-500 text-[11px]">Statische hosting via GitHub Pages (Standard Contractual Clauses).</div>
                            </div>
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">SANITY AS (NOORWEGEN/EER)</b>
                                <div className="text-neutral-500 text-[11px]">Headless CMS voor openbare artwork-metadata (EER-databescherming).</div>
                            </div>
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">METERED NETWORKS INC.</b>
                                <div className="text-neutral-500 text-[11px]">STUN/TURN netwerkrelay voor WebRTC lage-latentie videoverbindingen.</div>
                            </div>
                        </div>
                    </section>

                    {/* 5. Jouw Rechten (AVG) */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            5. JOUW RECHTEN ONDER DE AVG
                        </h2>
                        <p className="text-neutral-400">
                            Op grond van de Algemene Verordening Gegevensbescherming (AVG) heb je te allen tijde de volgende rechten:
                        </p>
                        <ul className="list-disc list-inside text-neutral-400 space-y-1 text-[12px] pl-2">
                            <li><b className="text-white">Recht op inzage:</b> Je mag opvragen welke persoonsgegevens ik van je heb.</li>
                            <li><b className="text-white">Recht op rectificatie &amp; wissing:</b> Je mag verzoeken om correctie of verwijdering van je e-mails of berichten.</li>
                            <li><b className="text-white">Recht van bezwaar &amp; beperking:</b> Je kunt bezwaar maken tegen specifieke verwerkingen.</li>
                        </ul>
                        <p className="text-neutral-400 text-[12px] pt-1">
                            Wil je gebruik maken van een van deze rechten? Stuur simpelweg een mailtje naar <a href="mailto:info@sisyfuz.com" className="text-white underline">info@sisyfuz.com</a>. Ik reageer binnen 30 dagen.
                        </p>
                        <p className="text-neutral-500 text-[11px]">
                            Mocht je onverhoopt een geschil hebben over privacy, dan heb je tevens het wettelijke recht om een klacht in te dienen bij de toezichthouder: de <b className="text-neutral-300">Autoriteit Persoonsgegevens</b> (<a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">autoriteitpersoonsgegevens.nl</a>).
                        </p>
                    </section>

                    {/* 6. Colofon & Auteursrecht */}
                    <section className="space-y-2 border-t border-neutral-800 pt-6">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            6. COLOFON &amp; INTELLECTUEEL EIGENDOM
                        </h2>
                        <div className="space-y-2 text-neutral-400 text-[12px]">
                            <p>
                                © {new Date().getFullYear()} Dorus Kleijne (sisyfuz). Alle rechten voorbehouden op het artistieke werk, concepten, geschreven teksten, videobeelden, TouchDesigner composities en visuele ASCII-ontwerpen, tenzij uitdrukkelijk anders vermeld.
                            </p>
                            <p>
                                <span className="text-neutral-500 uppercase">TYPOGRAFIE CREDITS:</span><br />
                                Sligoil font ontworpen door Ariel Martín Pérez, met bijdragen van Đông Trúc Nguyễn. Uitgegeven door Velvetyne Type Foundry (<a href="https://velvetyne.fr" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">velvetyne.fr</a>) onder open-source licentie. Webfonts geleverd via Google Fonts.
                            </p>
                        </div>
                    </section>
                </div>
            )}

            {/* Content: English */}
            {lang === "en" && (
                <div className="space-y-8 text-neutral-300">
                    {/* 1. Controller */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            1. DATA CONTROLLER (WHO I AM)
                        </h2>
                        <p>
                            This website (<span className="text-white">sisyfuz.com</span>) is the personal portfolio and experimental research platform of:
                        </p>
                        <div className="bg-neutral-950 border border-neutral-800 p-3 space-y-1 font-mono text-[12px] text-neutral-300">
                            <div><span className="text-neutral-500">NAME:</span> Dorus Kleijne (artist moniker: sisyfuz)</div>
                            <div><span className="text-neutral-500">CAPACITY:</span> Independent artist / theatre &amp; performance student</div>
                            <div><span className="text-neutral-500">LOCATION:</span> Utrecht, The Netherlands</div>
                            <div><span className="text-neutral-500">DIRECT INQUIRIES:</span> <a href="mailto:info@sisyfuz.com" className="text-white underline hover:text-[#ff0080]">info@sisyfuz.com</a></div>
                            <div><span className="text-neutral-500">STATUS:</span> Non-commercial artistic/educational portfolio</div>
                        </div>
                        <p className="text-neutral-400 text-[12px]">
                            I hold digital privacy, sovereignty, and data minimization in the highest regard. I collect strictly the minimum technical data necessary to deliver the site and interactive live stream reliably.
                        </p>
                    </section>

                    {/* 2. Data Processing */}
                    <section className="space-y-3">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            2. WHAT DATA IS PROCESSED &amp; WHY?
                        </h2>
                        
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">A. Web Server &amp; CDN Logs (Hosting)</span>
                                <p className="text-neutral-400">
                                    When you visit this website, infrastructure providers (GitHub Pages and Cloudflare) automatically process transient connection metadata: your IP address, timestamp, browser user-agent, and requested file paths.
                                </p>
                                <p className="text-neutral-500 text-[11px]">
                                    Legal Basis: Legitimate interest (GDPR Art. 6(1)(f)) for DDoS protection and secure content distribution. Logs are never profiled or linked to your personal identity.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">B. Email Communications</span>
                                <p className="text-neutral-400">
                                    If you send an inquiry to <span className="text-white">info@sisyfuz.com</span>, I receive your sender name, email address, and message contents. I retain this information strictly to correspond and coordinate collaborations.
                                </p>
                                <p className="text-neutral-500 text-[11px]">
                                    Legal Basis: Performance of a contract or consent (GDPR Art. 6(1)(a/b)). Retention: retained as long as relevant, then permanently deleted.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">C. Live Stream Interaction &amp; Telemetry (/live)</span>
                                <p className="text-neutral-400">
                                    On the interactive stream page (<span className="text-white">sisyfuz.com/live</span>), you can optionally chat and share real-time cursor movement with the visual synthesizer:
                                </p>
                                <ul className="list-disc list-inside text-neutral-400 space-y-1 pl-2 text-[12px]">
                                    <li><b className="text-neutral-200">Chat Messages &amp; Handle:</b> Strictly ephemeral. A maximum of 50 recent messages are stored in temporary RAM. When the stream stops or resets, all messages are permanently erased.</li>
                                    <li><b className="text-neutral-200">Cursor Telemetry:</b> Normalized mouse coordinates (X/Y) are streamed in real time over WebSockets to my TouchDesigner engine. Coordinates are NEVER logged, recorded, or linked to individual identities.</li>
                                </ul>
                            </div>

                            <div className="space-y-1">
                                <span className="text-white font-bold block uppercase text-[12px]">D. Metric Counter (Attempt Tracker)</span>
                                <p className="text-neutral-400">
                                    Clicking the attempt counter increments an anonymous global count in the database. Client IP is checked in-memory strictly within a 10-second sliding window to prevent automated spam floods, and is never written to disk or permanent databases.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 3. Cookies & Storage */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            3. COOKIES &amp; LOCAL STORAGE (NO COOKIE BANNER NEEDED)
                        </h2>
                        <div className="border border-pink-500/40 bg-pink-500/5 p-3 space-y-2">
                            <p className="text-white font-bold text-[12px]">
                                [!] THIS WEBSITE DOES NOT USE ANY TRACKING OR ADVERTISING COOKIES.
                            </p>
                            <p className="text-neutral-300 text-[12px]">
                                I do not use Google Analytics, Meta/Facebook Pixel, third-party marketing cookies, or tracking beacons.
                            </p>
                            <p className="text-neutral-400 text-[12px]">
                                The website stores only purely functional preferences in browser <span className="text-white font-mono">localStorage</span>:
                            </p>
                            <ul className="list-disc list-inside text-neutral-400 text-[11px] space-y-0.5 pl-2">
                                <li><code className="text-white">sisyfuz_theme</code>: Saves your chosen terminal theme color.</li>
                                <li><code className="text-white">sisyfuz_live_muted</code>: Remembers your audio mute preference.</li>
                                <li><code className="text-white">sisyfuz_chat_user</code>: Remembers your chosen chat pseudonym.</li>
                                <li><code className="text-white">sisyfuz_pressed</code>: Prevents accidental duplicate counter submissions.</li>
                            </ul>
                            <p className="text-neutral-400 text-[11px] italic">
                                Under Dutch Telecommunications Act (Art. 11.7a) and EU ePrivacy rules, purely functional storage with negligible privacy impact is explicitly exempt from requiring a cookie consent banner.
                            </p>
                        </div>
                    </section>

                    {/* 4. Subprocessors */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            4. THIRD-PARTY INFRASTRUCTURE &amp; SUBPROCESSORS
                        </h2>
                        <p className="text-neutral-400">
                            I rely on trusted technical infrastructure partners:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] font-mono">
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">CLOUDFLARE, INC. (US/EU)</b>
                                <div className="text-neutral-500 text-[11px]">DNS routing, DDoS mitigation, Edge Workers (Standard Contractual Clauses).</div>
                            </div>
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">GITHUB, INC. (US)</b>
                                <div className="text-neutral-500 text-[11px]">Static website hosting via GitHub Pages (Standard Contractual Clauses).</div>
                            </div>
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">SANITY AS (NORWAY/EEA)</b>
                                <div className="text-neutral-500 text-[11px]">Headless CMS hosting public portfolio metadata (EEA Data Protection).</div>
                            </div>
                            <div className="border border-neutral-800 p-2 bg-neutral-950">
                                <b className="text-white">METERED NETWORKS INC.</b>
                                <div className="text-neutral-500 text-[11px]">WebRTC STUN/TURN low-latency video relay service.</div>
                            </div>
                        </div>
                    </section>

                    {/* 5. Rights under GDPR */}
                    <section className="space-y-2">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            5. YOUR RIGHTS UNDER THE GDPR
                        </h2>
                        <p className="text-neutral-400">
                            Under European data protection law, you hold the following rights:
                        </p>
                        <ul className="list-disc list-inside text-neutral-400 space-y-1 text-[12px] pl-2">
                            <li><b className="text-white">Right of access:</b> Request details regarding any personal data held.</li>
                            <li><b className="text-white">Right to rectification &amp; erasure:</b> Request correction or deletion of correspondence.</li>
                            <li><b className="text-white">Right to object &amp; restrict:</b> Object to specific data processing activities.</li>
                        </ul>
                        <p className="text-neutral-400 text-[12px] pt-1">
                            To exercise any of these rights, contact me directly at <a href="mailto:info@sisyfuz.com" className="text-white underline">info@sisyfuz.com</a>. I will respond within 30 days.
                        </p>
                        <p className="text-neutral-500 text-[11px]">
                            You also have the right to lodge a complaint with your national data protection authority or the Dutch supervisory authority: the <b className="text-neutral-300">Autoriteit Persoonsgegevens</b> (<a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">autoriteitpersoonsgegevens.nl</a>).
                        </p>
                    </section>

                    {/* 6. Colophon */}
                    <section className="space-y-2 border-t border-neutral-800 pt-6">
                        <h2 className="text-white font-bold uppercase tracking-wider">
                            6. COLOPHON &amp; INTELLECTUAL PROPERTY
                        </h2>
                        <div className="space-y-2 text-neutral-400 text-[12px]">
                            <p>
                                © {new Date().getFullYear()} Dorus Kleijne (sisyfuz). All rights reserved across artistic creations, concepts, texts, video recordings, TouchDesigner setups, and custom ASCII design, unless explicitly stated otherwise.
                            </p>
                            <p>
                                <span className="text-neutral-500 uppercase">TYPOGRAPHY ATTRIBUTION:</span><br />
                                Sligoil typeface designed by Ariel Martín Pérez, with contributions from Đông Trúc Nguyễn. Released through Velvetyne Type Foundry (<a href="https://velvetyne.fr" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">velvetyne.fr</a>) under an open-source license. Web fonts served via Google Fonts.
                            </p>
                        </div>
                    </section>
                </div>
            )}

            {/* Bottom Footer Back Button */}
            <div className="pt-4 border-t border-neutral-800 flex justify-between items-center text-xs">
                <button
                    onClick={() => onNavigate && onNavigate("home")}
                    className="text-white hover:bg-white hover:text-black font-bold uppercase py-1 px-2 -ml-2 cursor-pointer transition-none"
                >
                    {lang === "nl" ? "[← TERUG NAAR HOME]" : "[← BACK TO HOME]"}
                </button>
                <span className="text-neutral-500 text-[11px] uppercase">
                    SISYFUZ // UTRECHT, NL
                </span>
            </div>
        </div>
    );
}
