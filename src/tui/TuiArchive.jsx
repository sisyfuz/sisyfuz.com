// src/tui/TuiArchive.jsx
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { client } from "../sanityClient";
import { ASCII_DIVIDER } from "../utils/ascii";
import { workPath } from "../utils/routing";
import TuiLoadError from "./TuiLoadError";

// Each row's ACCESS cell holds a real link (keyboard focusable, middle-click /
// open-in-new-tab capable); clicking anywhere else on the row follows it too.
export default function TuiArchive() {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setLoadError(false);
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
                if (cancelled) return;
                setItems(Array.isArray(data) ? data : []);
                setIsLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Error fetching archive:", err);
                setLoadError(true);
                setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [reloadKey]);

    if (isLoading) {
        return (
            <div className="py-20 font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse">
                [ LOADING_ARCHIVE_DATA... ]
            </div>
        );
    }

    if (loadError) {
        return <TuiLoadError label="COULD_NOT_LOAD_ARCHIVE" onRetry={() => setReloadKey(k => k + 1)} />;
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

                            const handleRowClick = (e) => {
                                // Clicks on the link itself are handled by the link.
                                if (e.target.closest("a")) return;
                                if (isExternal) {
                                    window.open(item.externalLink, "_blank", "noopener,noreferrer");
                                } else if (isWork) {
                                    navigate(workPath(item.id));
                                }
                            };

                            return (
                                <tr
                                    key={idx}
                                    onClick={handleRowClick}
                                    className={`cursor-pointer group hover:bg-white hover:text-black has-[:focus-visible]:bg-white has-[:focus-visible]:text-black transition-none`}
                                >
                                    <td className="py-2 sm:py-2.5 pr-2 sm:pr-4 text-neutral-500 group-hover:text-black group-has-[:focus-visible]:text-black">{item.year}</td>
                                    <td className="py-2 sm:py-2.5 px-2 sm:px-4 font-bold uppercase text-white group-hover:text-black group-has-[:focus-visible]:text-black">
                                        {item.title}
                                    </td>
                                    <td className="py-2.5 px-4 text-neutral-400 group-hover:text-black group-has-[:focus-visible]:text-black hidden sm:table-cell uppercase">
                                        [{item.type || "project"}]
                                    </td>
                                    <td className="py-2 sm:py-2.5 pl-2 sm:pl-4 text-right">
                                        {isExternal ? (
                                            <a
                                                href={item.externalLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={`${item.title} (external, opens in new tab)`}
                                                className="text-pink-500 group-hover:text-black group-has-[:focus-visible]:text-black font-bold uppercase"
                                            >
                                                [EXT ↗]
                                            </a>
                                        ) : isWork ? (
                                            <Link
                                                to={workPath(item.id)}
                                                aria-label={`View ${item.title}`}
                                                className="text-white group-hover:text-black group-has-[:focus-visible]:text-black font-bold uppercase"
                                            >
                                                [VIEW →]
                                            </Link>
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
