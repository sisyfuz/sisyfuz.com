// src/tui/TuiArchive.jsx
import { useState, useEffect } from "react";
import { client } from "../sanityClient";
import { ASCII_DIVIDER } from "../utils/ascii";

export default function TuiArchive({ onSelectWork }) {
    const [items, setItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const query = `*[_type == "project" && category != "draft"] | order(year desc) {
            "id": coalesce(slug.current, _id),
            title,
            year,
            "type": tags[0],
            category,
            externalLink
        }`;

        client.fetch(query)
            .then((data) => {
                setItems(data);
                setIsLoading(false);
            })
            .catch((err) => {
                console.error("Error fetching archive:", err);
                setIsLoading(false);
            });
    }, []);

    if (isLoading) {
        return (
            <div className="py-20 font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse">
                [ LOADING_ARCHIVE_DATA... ]
            </div>
        );
    }

    return (
        <div className="space-y-4 max-w-4xl text-xs sm:text-[13px] leading-relaxed">
            <div className="overflow-x-auto">
                <table className="w-full text-left font-mono border-collapse">
                    <thead>
                        <tr className="text-neutral-500 uppercase">
                            <th className="py-2 pr-2 sm:pr-4 w-14 sm:w-24 font-normal">YEAR</th>
                            <th className="py-2 px-2 sm:px-4 font-normal">TITLE</th>
                            <th className="py-2 px-4 w-40 font-normal hidden sm:table-cell">MEDIUM</th>
                            <th className="py-2 pl-2 sm:pl-4 w-20 sm:w-28 text-right font-normal">ACCESS</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td colSpan="4" className="text-neutral-600 select-none overflow-hidden whitespace-nowrap py-1">
                                {ASCII_DIVIDER}
                            </td>
                        </tr>
                        {items.map((item, idx) => {
                            const isExternal = Boolean(item.externalLink && (item.externalLink.startsWith("https://") || item.externalLink.startsWith("http://")));
                            const isWork = item.category === "work";

                            const handleClick = () => {
                                if (isExternal) {
                                    window.open(item.externalLink, "_blank", "noopener,noreferrer");
                                } else if (isWork && onSelectWork) {
                                    onSelectWork(item.id);
                                }
                            };

                            return (
                                <tr
                                    key={idx}
                                    onClick={handleClick}
                                    className={`cursor-pointer group hover:bg-white hover:text-black transition-none`}
                                >
                                    <td className="py-2 sm:py-2.5 pr-2 sm:pr-4 text-neutral-500 group-hover:text-black">{item.year}</td>
                                    <td className="py-2 sm:py-2.5 px-2 sm:px-4 font-bold uppercase text-white group-hover:text-black">
                                        {item.title}
                                    </td>
                                    <td className="py-2.5 px-4 text-neutral-400 group-hover:text-black hidden sm:table-cell uppercase">
                                        [{item.type || "project"}]
                                    </td>
                                    <td className="py-2 sm:py-2.5 pl-2 sm:pl-4 text-right">
                                        {isExternal ? (
                                            <span className="text-pink-500 group-hover:text-black font-bold uppercase">
                                                [EXT ↗]
                                            </span>
                                        ) : isWork ? (
                                            <span className="text-white group-hover:text-black font-bold uppercase">
                                                [VIEW →]
                                            </span>
                                        ) : (
                                            <span className="text-neutral-600 group-hover:text-black">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
