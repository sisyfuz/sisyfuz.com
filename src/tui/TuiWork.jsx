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
            <div className="py-20 font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse">
                [ LOADING_SELECTED_WORKS... ]
            </div>
        );
    }

    if (loadError) {
        return <TuiLoadError label="COULD_NOT_LOAD_WORKS" onRetry={retry} />;
    }

    if (selectedId && !activeProject) {
        return (
            <div className="py-20 font-mono text-xs uppercase text-neutral-500 space-y-2">
                <div>[ PROJECT_NOT_FOUND ]</div>
                <Link
                    to="/work"
                    className="inline-block uppercase hover:bg-white hover:text-black px-1 -mx-1 font-bold cursor-pointer text-white"
                >
                    [← BACK_TO_WORKS]
                </Link>
            </div>
        );
    }

    if (activeProject) {
        return (
            <div className="space-y-8 animate-fadeIn max-w-4xl text-xs sm:text-[13px] leading-relaxed">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold uppercase text-white">
                        {activeProject.title} ({activeProject.year})
                    </span>
                    <Link
                        to="/work"
                        className="uppercase hover:bg-white hover:text-black px-1 -mx-1 font-bold cursor-pointer"
                    >
                        [← BACK_TO_WORKS]
                    </Link>
                </div>

                <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                    {ASCII_DIVIDER}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    {/* Visual with Cellular ASCII Wipe */}
                    <div className="lg:col-span-7 space-y-2">
                        {activeProject.mainImage ? (
                            <AsciiMedia
                                src={getOptimizedImageUrl(activeProject.rawMainImage || activeProject.mainImage, 1200)}
                                alt={activeProject.title}
                                cols={56}
                                aspectRatio="aspect-[4/3]"
                            />
                        ) : (
                            <div className="p-12 text-center opacity-50">
                                [NO_MEDIA_ATTACHED]
                            </div>
                        )}
                        <div className="text-neutral-500 uppercase text-[11px]">
                            // HOVER / TOUCH TO REVEAL FULL-COLOR
                        </div>
                    </div>

                    {/* Description & Technical Specs */}
                    <div className="lg:col-span-5 space-y-6">
                        <div className="flex gap-2 flex-wrap">
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
                            <div className="space-y-1.5 pt-4">
                                <span className="uppercase font-bold text-neutral-400 block">
                                    TECHNICAL_SPECS:
                                </span>
                                <ul className="space-y-1 text-neutral-400">
                                    {activeProject.technicalSpecs.map((s, i) => (
                                        <li key={i}>&gt; {s}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {activeProject.credits && activeProject.credits.length > 0 && (
                            <div className="space-y-1.5 pt-4">
                                <span className="uppercase font-bold text-neutral-400 block">
                                    CREDITS:
                                </span>
                                <div className="space-y-1 text-neutral-400">
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
                    <div className="pt-8 space-y-4">
                        <div className="text-neutral-600 select-none overflow-hidden whitespace-nowrap">
                            {ASCII_DIVIDER}
                        </div>
                        <span className="uppercase font-bold text-neutral-400 block">
                            MEDIA_ATTACHMENTS ({activeProject.media.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {activeProject.media.map((item, idx) => (
                                <div key={idx}>
                                    <AsciiMedia
                                        src={getOptimizedImageUrl(item.asset || item.src, 800)}
                                        alt={item.caption || item.alt || `${activeProject.title} media attachment ${idx + 1}`}
                                        cols={44}
                                        aspectRatio="aspect-video"
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
            <div className="py-20 font-mono text-xs uppercase text-neutral-500 space-y-2">
                <div>[ NO_PROJECTS_MATCHING "{searchQuery}" ]</div>
                <div className="text-neutral-600 text-[11px]">PRESS ESC TO CLEAR SEARCH FILTER</div>
            </div>
        );
    }

    return (
        <div className="space-y-10 text-xs sm:text-[13px] leading-relaxed">
            {searchQuery && (
                <div className="flex flex-wrap items-center gap-2 uppercase">
                    <span className="text-neutral-500">FILTER:</span>
                    <span className="bg-pink-500 text-black font-bold px-1">"{searchQuery}"</span>
                    <span className="text-neutral-600 text-[11px]">(PRESS ESC OR TAP [ESC] TO CLEAR)</span>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-10 lg:gap-14">
                {filteredProjects.map((project) => (
                    <Link
                        key={project.id}
                        to={workPath(project.id)}
                        onClick={(e) => {
                            if (isPlainLeftClick(e)) window.scrollTo({ top: 0, behavior: "instant" });
                        }}
                        className="cursor-pointer group flex flex-col justify-between space-y-3"
                    >
                        <div>
                            {/* Visual without any box border */}
                            {project.mainImage && (
                                <div className="mb-3">
                                    <AsciiMedia
                                        src={getOptimizedImageUrl(project.rawMainImage || project.mainImage, 800)}
                                        alt={project.title}
                                        cols={48}
                                        aspectRatio="aspect-[3/2]"
                                    />
                                </div>
                            )}

                            {/* Title & Metadata */}
                            <div className="flex items-start justify-between gap-2 uppercase mb-1">
                                <h3 className="font-bold text-white group-hover:bg-white group-hover:text-black group-focus-visible:bg-white group-focus-visible:text-black px-1 -mx-1 transition-none">
                                    {project.title}
                                </h3>
                                <span className="text-neutral-500 shrink-0">{project.year}</span>
                            </div>

                            <p className="text-neutral-400 line-clamp-3 mb-2">
                                {project.shortDesc}
                            </p>
                        </div>

                        <div className="flex items-center justify-between uppercase pt-1">
                            <div className="flex gap-2 flex-wrap text-neutral-500">
                                {project.tags?.slice(0, 2).map(tag => (
                                    <span key={tag}>[{tag}]</span>
                                ))}
                            </div>
                            <span className="text-neutral-300 group-hover:bg-pink-500 group-hover:text-black group-focus-visible:bg-pink-500 group-focus-visible:text-black px-1 font-bold">
                                [VIEW →]
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
