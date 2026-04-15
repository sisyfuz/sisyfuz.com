import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { client } from "../sanityClient"; // IMPORT DE SANITY CLIENT

export default function Archive() {
    const [archiveItems, setArchiveItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const query = `*[_type == "project" && category != "draft"] | order(year desc) {
            "id": slug.current,
            title,
            year,
            "type": tags[0], // Pakt automatisch de eerste tag als "Format/Type"
            category,
            externalLink
        }`;

        client.fetch(query)
            .then((data) => {
                setArchiveItems(data);
                setIsLoading(false);
            })
            .catch((err) => {
                console.error("Error fetching archive:", err);
                setIsLoading(false);
            });
    }, []);

    return (
        <div className="min-h-screen w-full bg-black text-white p-6 md:p-10 pb-32 font-mono uppercase">
            <h1 className="text-pink-500 text-2xl mb-10 tracking-widest">_system_archive</h1>

            <div className="hidden md:flex justify-between border-b border-pink-500/30 pb-2 text-[10px] text-pink-500/70 mb-2 tracking-widest px-4">
                <span className="w-24">Year</span>
                <span className="flex-1">Title</span>
                <span className="w-1/3 text-right">Format</span>
            </div>

            {isLoading ? (
                <div className="text-sm text-slate-400 mt-8 uppercase tracking-widest animate-pulse px-4">
                    fetching_archive_data...
                </div>
            ) : (
                <div className="space-y-0">
                    {archiveItems.map((item, i) => {
                        // Bepaal de link: 
                        // 1. Heeft het een externe link? Gebruik die.
                        // 2. Is het een "work" project? Link naar de Work pagina + ID.
                        // 3. Anders geen link (gewoon tekst).
                        const itemLink = item.externalLink ? item.externalLink : (item.category === 'work' ? `/work#${item.id}` : null);

                        const rowClasses = `group border-b border-white/10 py-6 flex flex-col md:flex-row md:items-center justify-between hover:bg-white/5 transition-all px-4 -mx-4 ${itemLink ? 'cursor-crosshair' : 'cursor-default'}`;

                        const RowContent = () => (
                            <>
                                <span className="w-24 opacity-50 text-xs md:text-base mb-2 md:mb-0">
                                    {item.year}
                                </span>
                                <span className="flex-1 text-sm md:text-lg group-hover:text-pink-500 transition-colors">
                                    {item.title}
                                    {itemLink && (
                                        <span className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity text-pink-500">
                                            ↗
                                        </span>
                                    )}
                                </span>
                                <span className="md:w-1/3 text-left md:text-right text-slate-400 text-[10px] md:text-xs italic tracking-widest group-hover:text-pink-400 mt-2 md:mt-0">
                                    {item.type || 'Project'}
                                </span>
                            </>
                        );

                        if (itemLink && itemLink.startsWith("http")) {
                            return (
                                <a key={i} href={itemLink} target="_blank" rel="noopener noreferrer" className={rowClasses}>
                                    <RowContent />
                                </a>
                            );
                        }
                        else if (itemLink) {
                            return (
                                <Link key={i} to={itemLink} className={rowClasses}>
                                    <RowContent />
                                </Link>
                            );
                        }
                        else {
                            return (
                                <div key={i} className={rowClasses}>
                                    <RowContent />
                                </div>
                            );
                        }
                    })}
                </div>
            )}
        </div>
    );
}