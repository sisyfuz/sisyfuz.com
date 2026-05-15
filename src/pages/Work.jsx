import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useDisco } from "../context/DiscoContext";
import { client } from "../sanityClient";
import { useTypography } from "../hooks/useTypography";

const ROW_UNIT = 10;
const GAP = 32;

export default function Work() {
    useTypography();

    const [projects, setProjects] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState(null);
    const [zoomedImage, setZoomedImage] = useState(null);
    const [rowSpans, setRowSpans] = useState({});
    const cardRefs = useRef({});
    const { hash } = useLocation();
    const { searchQuery } = useDisco();

    useEffect(() => {
        const query = `*[_type == "project" && category == "work"] | order(ranking asc, year desc) {
            "id": coalesce(slug.current, _id),
            title,
            year,
            shortDesc,
            fullDesc,
            tags,
            credits,
            technicalSpecs,
            "mainImage": mainImage.asset->url,
            media[] {
                _type == 'image' => {
                    "type": "image",
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
                setProjects(data);
                setIsLoading(false);
            })
            .catch((err) => {
                console.error("Error fetching projects:", err);
                setIsLoading(false);
            });
    }, []);

    const filteredProjects = projects.filter(p => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            p.title?.toLowerCase().includes(q) ||
            p.shortDesc?.toLowerCase().includes(q) ||
            p.tags?.some(tag => tag.toLowerCase().includes(q)) ||
            p.year?.includes(q)
        );
    });

    const recalcSpans = useCallback(() => {
        const next = {};
        Object.entries(cardRefs.current).forEach(([id, el]) => {
            if (!el) return;
            const h = el.scrollHeight;
            next[id] = Math.ceil((h + GAP) / ROW_UNIT);
        });
        setRowSpans(prev => {
            const same = Object.keys(next).every(k => prev[k] === next[k]);
            return same ? prev : next;
        });
    }, []);

    useLayoutEffect(() => {
        recalcSpans();
    }, [filteredProjects, recalcSpans]);

    useEffect(() => {
        const ro = new ResizeObserver(recalcSpans);
        Object.values(cardRefs.current).forEach(el => el && ro.observe(el));
        const images = Object.values(cardRefs.current).flatMap(el => el ? [...el.querySelectorAll('img')] : []);
        images.forEach(img => img.addEventListener('load', recalcSpans));
        return () => {
            ro.disconnect();
            images.forEach(img => img.removeEventListener('load', recalcSpans));
        };
    }, [recalcSpans, filteredProjects]);

    useEffect(() => {
        if (!isLoading && hash && projects.length > 0) {
            const id = hash.replace("#", "");
            const element = document.getElementById(id);
            if (element) {
                element.scrollIntoView({ behavior: "smooth" });
                const project = projects.find(p => p.id === id);
                if (project) setSelectedProject(project);
            }
        }
    }, [hash, isLoading, projects]);

    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                if (zoomedImage) setZoomedImage(null);
                else setSelectedProject(null);
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [zoomedImage]);

    return (
        <div className="min-h-screen bg-white text-black p-6 md:p-10 font-body pb-32">
            <h1 className="font-title text-5xl font-black mb-16 tracking-tighter uppercase">_selected_works</h1>

            {isLoading ? (
                <div className="font-mono text-sm text-slate-400 mt-8 uppercase tracking-widest animate-pulse">
                    fetching_system_data...
                </div>
            ) : filteredProjects.length === 0 ? (
                <div className="font-mono text-sm text-slate-400 mt-8 uppercase tracking-widest">
                    system_error: no_matches_found_for_"{searchQuery}"
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12" style={{ gridAutoRows: `${ROW_UNIT}px`, alignItems: 'start' }}>
                    {filteredProjects.map((project) => (
                        <div
                            key={project.id}
                            id={project.id}
                            ref={el => { cardRefs.current[project.id] = el; }}
                            className="group flex flex-col border-t-2 border-black pt-6 mb-8"
                            style={{ gridRowEnd: `span ${rowSpans[project.id] || 100}` }}
                        >
                            <div className="w-full aspect-[3/2] mb-6 overflow-hidden border border-black/5 bg-slate-50 flex items-center justify-center p-4 cursor-pointer" onClick={() => setSelectedProject(project)}>
                                {project.mainImage && (
                                    <img src={project.mainImage} alt={project.title} className="max-w-full max-h-full object-contain transition-transform duration-700 ease-in-out group-hover:scale-105" />
                                )}
                            </div>

                            <div className="flex justify-between items-start mb-4 font-mono text-[10px] uppercase tracking-widest">
                                <span className="opacity-50">{project.year}</span>
                                <div className="flex gap-2 flex-wrap">
                                    {project.tags?.map(tag => (
                                        <span key={tag} className="border border-black/20 px-2 py-0.5 rounded-full">{tag}</span>
                                    ))}
                                </div>
                            </div>

                            <h2 className="font-title text-2xl font-bold uppercase mb-2 group-hover:text-pink-600 transition-colors tracking-tight">{project.title}</h2>
                            <p className="font-body text-slate-600 mb-6 lowercase text-sm leading-relaxed">{project.shortDesc}</p>

                            <button onClick={() => setSelectedProject(project)} className="font-mono w-fit px-6 py-2 bg-black text-white text-xs font-bold uppercase tracking-widest hover:bg-pink-600 transition-all active:scale-95">
                                view_info_
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* MODAL */}
            {selectedProject && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10">
                    <div className="absolute inset-0 bg-black/95 backdrop-blur-md" onClick={() => setSelectedProject(null)} />

                    <div className="relative bg-white w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6 md:p-16 border-t-8 border-pink-500 shadow-2xl">
                        <button className="absolute top-6 right-6 text-3xl font-light hover:rotate-90 transition-transform z-10" onClick={() => setSelectedProject(null)}>✕</button>

                        <div className="mb-12">
                            <span className="font-mono text-pink-500 text-sm tracking-widest uppercase">{selectedProject.year}</span>
                            <h2 className="font-title text-4xl md:text-7xl font-black uppercase tracking-tighter leading-none">{selectedProject.title}</h2>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 mb-16">
                            <div className="space-y-12">
                                <p className="font-body text-lg leading-relaxed whitespace-pre-line text-slate-800 italic">
                                    {selectedProject.fullDesc}
                                </p>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-black/10">
                                    {selectedProject.credits && selectedProject.credits.length > 0 && (
                                        <div>
                                            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400 mb-4">_credits</p>
                                            <ul className="space-y-2">
                                                {selectedProject.credits.map((credit, i) => (
                                                    <li key={i} className="font-body text-xs uppercase">
                                                        <span className="opacity-40">{credit.role}:</span> <span className="font-bold">{credit.name}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {selectedProject.technicalSpecs && selectedProject.technicalSpecs.length > 0 && (
                                        <div>
                                            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400 mb-4">_technical_specs</p>
                                            <ul className="space-y-2">
                                                {selectedProject.technicalSpecs.map((spec, i) => (
                                                    <li key={i} className="font-mono text-xs uppercase text-slate-600 flex items-start">
                                                        <span className="mr-2 text-pink-500">→</span> {spec}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>

                                {selectedProject.tags && selectedProject.tags.length > 0 && (
                                    <div className="pt-8 border-t border-black/10">
                                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400 mb-4">_system_tags</p>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedProject.tags.map(tag => (
                                                <span key={tag} className="font-mono px-3 py-1 bg-black text-white text-[10px] font-bold uppercase">{tag}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div>
                                {selectedProject.mainImage && (
                                    <img src={selectedProject.mainImage} alt="" className="w-full border border-black/5 cursor-zoom-in shadow-lg" onClick={() => setZoomedImage(selectedProject.mainImage)} />
                                )}
                            </div>
                        </div>

                        {selectedProject.media && selectedProject.media.length > 0 && (
                            <div className="border-t border-black/10 pt-12">
                                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400 mb-6">_media_attachments</p>
                                <div className="flex gap-6 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-8">
                                    {selectedProject.media.map((item, index) => (
                                        <div key={index} className={`flex-shrink-0 w-[85vw] md:w-[600px] aspect-video bg-black snap-center overflow-hidden border border-black/10 shadow-lg ${item.type === 'image' ? 'cursor-zoom-in' : ''}`} onClick={() => item.type === 'image' && setZoomedImage(item.src)}>
                                            {item.type === 'image' ? <img src={item.src} alt="" className="w-full h-full object-cover" /> : <video src={item.src} controls className="w-full h-full object-cover" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* LIGHTBOX */}
            {zoomedImage && (
                <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 md:p-12 cursor-zoom-out" onClick={() => setZoomedImage(null)}>
                    <button className="absolute top-8 right-8 font-mono text-white text-xs uppercase tracking-[0.3em] border border-white/20 px-4 py-2 hover:bg-white hover:text-black transition-all">close_x</button>
                    <img src={zoomedImage} alt="Zoomed view" className="max-w-full max-h-full object-contain shadow-2xl scale-95 transition-transform duration-300" />
                </div>
            )}
        </div>
    );
}