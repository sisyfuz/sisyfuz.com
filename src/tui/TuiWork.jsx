// src/tui/TuiWork.jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { client } from "../sanityClient";
import AsciiMedia from "../components/AsciiMedia";
import { getOptimizedImageUrl } from "../components/sanityImage";
import { useDisco } from "../context/DiscoContext";
import { ASCII_DIVIDER } from "../utils/ascii";
import { workPath, isPlainLeftClick } from "../utils/routing";
import TuiLoadError from "./TuiLoadError";

// `selectedId` is the project slug from the URL (/work/<slug>); the URL is the
// source of truth for which project detail is shown.
export default function TuiWork({ selectedId = null }) {
    const { searchQuery } = useDisco();
    const [projects, setProjects] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const query = `*[_type == "project" && category == "work"] | order(ranking asc, year desc) {
            "id": coalesce(slug.current, _id),
            title,
            year,
            shortDesc,
            fullDesc,
            tags,
            credits,
            technicalSpecs,
            "rawMainImage": mainImage,
            "mainImage": mainImage.asset->url,
            media[] {
                _type == 'image' => {
                    "type": "image",
                    "asset": asset,
                    "src": asset->url
                },
                _type == 'videoUrl' => {
                    "type": "video",
                    "src": url
                }
            }
        }`;

        client.fetch(query)
            .then((data) => {
                if (cancelled) return;
                setProjects(Array.isArray(data) ? data : []);
                setIsLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Error fetching projects:", err);
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

    const activeProject = selectedId ? projects.find(p => p.id === selectedId) ?? null : null;

    const filteredProjects = projects.filter(p => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            p.title?.toLowerCase().includes(q) ||
            p.shortDesc?.toLowerCase().includes(q) ||
            p.tags?.some(tag => tag.toLowerCase().includes(q)) ||
            String(p.year ?? "").includes(q)
        );
    });

    if (isLoading) {
        return (
            <div className="py-[4lh] font-mono uppercase text-neutral-500 animate-pulse">
                [ LOADING_SELECTED_WORKS... ]
            </div>
        );
    }

    if (loadError) {
        return <TuiLoadError label="COULD_NOT_LOAD_WORKS" onRetry={retry} />;
    }

    if (selectedId && !activeProject) {
        return (
            <div className="py-[4lh] font-mono uppercase text-neutral-500">
                <div>[ PROJECT_NOT_FOUND ]</div>
                <Link
                    to="/work"
                    className="inline-block uppercase hover:bg-white hover:text-black font-bold cursor-pointer text-white"
                >
                    [← BACK_TO_WORKS]
                </Link>
            </div>
        );
    }

    if (activeProject) {
        return (
            <div className="space-y-[2lh] animate-fadeIn max-w-[112ch]">
                <div className="flex flex-wrap items-center justify-between gap-x-[1ch]">
                    <span className="font-bold uppercase text-white">
                        {activeProject.title} ({activeProject.year})
                    </span>
                    <Link
                        to="/work"
                        className="uppercase hover:bg-white hover:text-black font-bold cursor-pointer"
                    >
                        [← BACK_TO_WORKS]
                    </Link>
                </div>

                <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>

                <div className="term-split">
                    {/* Visual with Cellular ASCII Wipe */}
                    <div>
                        {activeProject.mainImage ? (
                            <AsciiMedia
                                src={getOptimizedImageUrl(activeProject.rawMainImage || activeProject.mainImage, 1200)}
                                alt={activeProject.title}
                                aspect={4 / 3}
                            />
                        ) : (
                            <div className="px-[6ch] py-[2lh] text-center opacity-50">
                                [NO_MEDIA_ATTACHED]
                            </div>
                        )}
                        <div className="text-neutral-500 uppercase">
                            // HOVER / TOUCH TO REVEAL FULL-COLOR
                        </div>
                    </div>

                    {/* Description & Technical Specs */}
                    <div className="space-y-[1lh]">
                        <div className="flex gap-x-[1ch] flex-wrap">
                            {activeProject.tags?.map(t => (
                                <span key={t} className="text-pink-400 uppercase">
                                    [{t}]
                                </span>
                            ))}
                        </div>

                        <div className="text-neutral-300 whitespace-pre-line">
                            {activeProject.fullDesc || activeProject.shortDesc}
                        </div>

                        {activeProject.technicalSpecs && activeProject.technicalSpecs.length > 0 && (
                            <div className="pt-[1lh]">
                                <span className="uppercase font-bold text-neutral-400 block">
                                    TECHNICAL_SPECS:
                                </span>
                                <ul className="text-neutral-400">
                                    {activeProject.technicalSpecs.map((s, i) => (
                                        <li key={i}>&gt; {s}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {activeProject.credits && activeProject.credits.length > 0 && (
                            <div className="pt-[1lh]">
                                <span className="uppercase font-bold text-neutral-400 block">
                                    CREDITS:
                                </span>
                                <div className="text-neutral-400">
                                    {activeProject.credits.map((c, i) => (
                                        <div key={i}>
                                            <span className="text-neutral-500 uppercase">{c.role}:</span> <b>{c.name}</b>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Additional Media */}
                {activeProject.media && activeProject.media.length > 0 && (
                    <div className="pt-[2lh] space-y-[1lh]">
                        <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                            {ASCII_DIVIDER}
                        </div>
                        <span className="uppercase font-bold text-neutral-400 block">
                            MEDIA_ATTACHMENTS ({activeProject.media.length})
                        </span>
                        <div className="term-cards">
                            {activeProject.media.map((item, idx) => (
                                <div key={idx}>
                                    <AsciiMedia
                                        src={getOptimizedImageUrl(item.asset || item.src, 800)}
                                        alt={item.caption || item.alt || `${activeProject.title} media attachment ${idx + 1}`}
                                        aspect={16 / 9}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (filteredProjects.length === 0) {
        return (
            <div className="py-[4lh] font-mono uppercase text-neutral-500">
                <div>[ NO_PROJECTS_MATCHING "{searchQuery}" ]</div>
                <div className="text-neutral-600">PRESS ESC TO CLEAR SEARCH FILTER</div>
            </div>
        );
    }

    return (
        <div className="space-y-[2lh]">
            {searchQuery && (
                <div className="flex flex-wrap items-center gap-x-[1ch] uppercase">
                    <span className="text-neutral-500">FILTER:</span>
                    <span className="bg-pink-500 text-black font-bold">"{searchQuery}"</span>
                    <span className="text-neutral-600">(PRESS ESC OR TAP [ESC] TO CLEAR)</span>
                </div>
            )}

            <div className="term-cards">
                {filteredProjects.map((project) => (
                    <Link
                        key={project.id}
                        to={workPath(project.id)}
                        onClick={(e) => {
                            if (isPlainLeftClick(e)) window.scrollTo({ top: 0, behavior: "instant" });
                        }}
                        className="cursor-pointer group flex flex-col justify-between space-y-[1lh]"
                    >
                        <div>
                            {/* Visual without any box border */}
                            {project.mainImage && (
                                <div className="mb-[1lh]">
                                    <AsciiMedia
                                        src={getOptimizedImageUrl(project.rawMainImage || project.mainImage, 800)}
                                        alt={project.title}
                                        aspect={3 / 2}
                                    />
                                </div>
                            )}

                            {/* Title & Metadata */}
                            <div className="flex items-start justify-between gap-x-[1ch] uppercase">
                                <h3 className="font-bold text-white group-hover:bg-white group-hover:text-black group-focus-visible:bg-white group-focus-visible:text-black transition-none">
                                    {project.title}
                                </h3>
                                <span className="text-neutral-500 shrink-0">{project.year}</span>
                            </div>

                            <p className="text-neutral-400 line-clamp-3">
                                {project.shortDesc}
                            </p>
                        </div>

                        <div className="flex items-center justify-between uppercase">
                            <div className="flex gap-x-[1ch] flex-wrap text-neutral-500">
                                {project.tags?.slice(0, 2).map(tag => (
                                    <span key={tag}>[{tag}]</span>
                                ))}
                            </div>
                            <span className="text-neutral-300 group-hover:bg-pink-500 group-hover:text-black group-focus-visible:bg-pink-500 group-focus-visible:text-black font-bold">
                                [VIEW →]
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
