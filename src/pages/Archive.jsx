export default function Archive() {
    const archiveItems = [
        { year: "2026", title: "We are a people's company!", type: "Interactive performance/experience" },
        { year: "2025", title: "Midnight New Years Eve Show", type: "Onrails experience" },
        { year: "2025", title: "Lieve Buren", type: "Performance" }
    ];

    return (
        // pb-32 is toegevoegd zodat je roze marquee menu er niet overheen valt!
        <div className="min-h-screen w-full bg-black text-white p-6 md:p-10 pb-32 font-mono uppercase">
            <h1 className="text-pink-500 text-2xl mb-10 tracking-widest">_system_archive</h1>

            {/* Optioneel: De kolom-titels (verdwijnen op hele kleine mobiele schermen voor de rust) */}
            <div className="hidden md:flex justify-between border-b border-pink-500/30 pb-2 text-[10px] text-pink-500/70 mb-2 tracking-widest px-4">
                <span className="w-24">Year</span>
                <span className="flex-1">Title</span>
                <span className="w-1/3 text-right">Format</span>
            </div>

            <div className="space-y-0">
                {archiveItems.map((item, i) => (
                    <div
                        key={i}
                        className="group border-b border-white/10 py-6 flex flex-col md:flex-row md:items-center justify-between hover:bg-white/5 transition-all cursor-crosshair px-4 -mx-4"
                    >
                        {/* Jaartal */}
                        <span className="w-24 opacity-50 text-xs md:text-base mb-2 md:mb-0">
                            {item.year}
                        </span>

                        {/* Titel (Neemt alle overgebleven ruimte in via flex-1) */}
                        <span className="flex-1 text-sm md:text-lg group-hover:text-pink-500 transition-colors">
                            {item.title}
                        </span>

                        {/* Type (Lijnt rechts uit op desktop) */}
                        <span className="md:w-1/3 text-left md:text-right text-slate-400 text-[10px] md:text-xs italic tracking-widest group-hover:text-pink-400 mt-2 md:mt-0">
                            {item.type}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

