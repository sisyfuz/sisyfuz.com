export default function Archive() {
    const archiveItems = [
        { year: "2026", title: "We are a people's company!", type: "Interactive performance/experience" },
        { year: "2025", title: "Midnight New Years Eve Show", type: "Onrails experience" },
        { year: "2025", title: "Lieve Buren", type: "Performance" }
    ];

    return (
        <div className="min-h-screen bg-black text-white p-10 font-mono uppercase">
            <h1 className="text-pink-500 text-2xl mb-10 tracking-widest">_system_archive</h1>
            <div className="space-y-4">
                {archiveItems.map((item, i) => (
                    <div key={i} className="border-b border-white/10 py-4 flex justify-between hover:text-pink-500 transition-colors">
                        <span>{item.title}</span>
                        <span className="opacity-50">{item.year}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}