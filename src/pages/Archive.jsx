import { Link } from "react-router-dom";

export default function Archive() {
    const archiveItems = [
        {
            year: "2026",
            title: "We are a people's company!",
            type: "Interactive performance/experience",
            link: "/work#peoples-company" // Link naar de Work pagina + ID
        },
        {
            year: "2025",
            title: "Midnight New Years Eve Show",
            type: "Onrails experience",
            link: "/work#midnight-show" // Link naar de Work pagina + ID
        },
        {
            year: "2025",
            title: "Lieve Buren",
            type: "Performance",
            link: "https://www.festivalboulevard.nl/nl/programma/lieve-buren-3270"
        }
    ];

    return (
        <div className="min-h-screen w-full bg-black text-white p-6 md:p-10 pb-32 font-mono uppercase">
            <h1 className="text-pink-500 text-2xl mb-10 tracking-widest">_system_archive</h1>

            <div className="hidden md:flex justify-between border-b border-pink-500/30 pb-2 text-[10px] text-pink-500/70 mb-2 tracking-widest px-4">
                <span className="w-24">Year</span>
                <span className="flex-1">Title</span>
                <span className="w-1/3 text-right">Format</span>
            </div>

            <div className="space-y-0">
                {archiveItems.map((item, i) => {
                    const rowClasses = `group border-b border-white/10 py-6 flex flex-col md:flex-row md:items-center justify-between hover:bg-white/5 transition-all px-4 -mx-4 ${item.link ? 'cursor-crosshair' : 'cursor-default'}`;
                    
                    const RowContent = () => (
                        <>
                            <span className="w-24 opacity-50 text-xs md:text-base mb-2 md:mb-0">
                                {item.year}
                            </span>
                            <span className="flex-1 text-sm md:text-lg group-hover:text-pink-500 transition-colors">
                                {item.title}
                                {item.link && (
                                    <span className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity text-pink-500">
                                        ↗
                                    </span>
                                )}
                            </span>
                            <span className="md:w-1/3 text-left md:text-right text-slate-400 text-[10px] md:text-xs italic tracking-widest group-hover:text-pink-400 mt-2 md:mt-0">
                                {item.type}
                            </span>
                        </>
                    );
                    
                    if (item.link && item.link.startsWith("http")) {
                        return (
                            <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" className={rowClasses}>
                                <RowContent />
                            </a>
                        );
                    }
                    else if (item.link) {
                        return (
                            <Link key={i} to={item.link} className={rowClasses}>
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
        </div>
    );
}