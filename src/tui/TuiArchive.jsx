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

    // Reset state in the event handler, not the effect, so a retry renders once
    const retry = () => {
        setIsLoading(true);
        setLoadError(false);
        setReloadKey(k => k + 1);
    };

    if (isLoading) {
        return (
            <div className="py-[4lh] font-mono uppercase text-neutral-500 animate-pulse">
                [ LOADING_ARCHIVE_DATA... ]
            </div>
        );
    }

    if (loadError) {
        return <TuiLoadError label="COULD_NOT_LOAD_ARCHIVE" onRetry={retry} />;
    }

    return (
        <div className="space-y-[1lh] max-w-[112ch]">
            <div className="overflow-x-auto">
                <table className="w-full table-fixed [&_td]:align-top [&_th]:align-top text-left font-mono border-collapse">
                    <thead>
                        <tr className="text-neutral-500 uppercase">
                            <th className="pb-[1lh] pr-[1ch] sm:pr-[2ch] w-[7ch] sm:w-[12ch] font-normal">YEAR</th>
                            <th className="pb-[1lh] px-[1ch] sm:px-[2ch] font-normal">TITLE</th>
                            <th className="pb-[1lh] px-[2ch] w-[20ch] font-normal hidden sm:table-cell">MEDIUM</th>
                            <th className="pb-[1lh] pl-[1ch] sm:pl-[2ch] w-[10ch] sm:w-[14ch] text-right font-normal">ACCESS</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td colSpan="4" className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
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
                                    <td className="pb-[1lh] sm:pb-0 pr-[1ch] sm:pr-[2ch] text-neutral-500 group-hover:text-black group-has-[:focus-visible]:text-black">{item.year}</td>
                                    <td className="pb-[1lh] sm:pb-0 px-[1ch] sm:px-[2ch] font-bold uppercase text-white group-hover:text-black group-has-[:focus-visible]:text-black">
                                        {item.title}
                                    </td>
                                    <td className="pb-[1lh] sm:pb-0 px-[2ch] text-neutral-400 group-hover:text-black group-has-[:focus-visible]:text-black hidden sm:table-cell uppercase">
                                        [{item.type || "project"}]
                                    </td>
                                    <td className="pb-[1lh] sm:pb-0 pl-[1ch] sm:pl-[2ch] text-right">
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
