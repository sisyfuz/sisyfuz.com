import { useEffect, useState } from "react";
import { HashRouter as Router, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { DiscoProvider, useDisco } from "./context/DiscoContext";
import Home from "./pages/Home";
import Work from "./pages/Work";
import Archive from "./pages/Archive";
import About from "./pages/About";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";

const menuItems = [
    { label: "_work", to: "/work" },
    { label: "_archive", to: "/archive" },
    { label: "_contact", to: "/contact" },
    { label: "_about", to: "/about" },
    { label: "_home", to: "/" },
];

const MarqueeMenu = ({ isVisible }) => (
    <div
        className={`fixed bottom-0 left-0 w-full z-50 bg-black border-t border-white/10 overflow-hidden whitespace-nowrap transition-transform duration-500 ease-out`}
        style={{
            paddingBottom: 'calc(0.8rem + env(safe-area-inset-bottom))',
            paddingTop: '0.8rem',
            transform: isVisible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
            willChange: 'transform'
        }}
    >
        <div className="animate-marquee cursor-crosshair flex">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="flex shrink-0">
                    {menuItems.map((item) => (
                        <Link
                            key={item.label}
                            to={item.to}
                            className="text-white text-[10px] font-mono uppercase tracking-[0.3em] px-12 transition-colors duration-150 hover:text-pink-500"
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>
            ))}
        </div>
    </div>
);

function Layout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { setDiscoMode, setSearchQuery } = useDisco();

    const isHome = location.pathname === "/";
    const [scrollVisible, setScrollVisible] = useState(false);
    const [buffer, setBuffer] = useState("");
    const [hintVisible, setHintVisible] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setHintVisible(true), 20000);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        const clearAll = () => {
            setBuffer("");
            setSearchQuery("");
        };

        const handleKeyDown = (e) => {
            if (e.key === "Enter" || e.key === "Escape") {
                clearAll();
                return;
            }

            if (e.key === "Backspace") {
                const next = buffer.slice(0, -1);
                setBuffer(next);
                setSearchQuery(next);
                return;
            }

            const key = e.key.toLowerCase();
            if (key.length !== 1 || !/[a-z]/.test(key)) return;

            const newBuffer = (buffer + key).slice(-30);
            setBuffer(newBuffer);

            const routes = ["work", "archive", "about", "contact", "home"];

            if (newBuffer.endsWith("disco")) {
                setDiscoMode(prev => !prev);
                clearAll();
            } else if (newBuffer.endsWith("clear")) {
                clearAll();
            } else if (routes.some(route => newBuffer.endsWith(route))) {
                routes.forEach(route => {
                    if (newBuffer.endsWith(route)) {
                        navigate(route === "home" ? "/" : `/${route}`);
                        clearAll();
                    }
                });
            } else {
                setSearchQuery(newBuffer);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [buffer, navigate, setDiscoMode, setSearchQuery]);

    useEffect(() => {
        if (!isHome) return;
        const handleScroll = () => setScrollVisible(window.scrollY / 500 > 0.1);
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [isHome]);

    const menuVisible = isHome ? scrollVisible : true;

    return (
        <>
            <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none whitespace-nowrap" style={{ mixBlendMode: 'difference' }}>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white transition-opacity duration-500" style={{ opacity: buffer ? 0.6 : hintVisible ? 0.3 : 0 }}>
                    {buffer
                        ? <>&gt; {buffer}<span className="animate-pulse ml-0.5">█</span></>
                        : location.pathname === "/work"
                            ? <>type to search / navigate<span className="animate-pulse ml-0.5">_</span></>
                            : <>start typing to navigate<span className="animate-pulse ml-0.5">_</span></>
                    }
                </span>
            </div>

            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/work" element={<Work />} />
                <Route path="/archive" element={<Archive />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
            <MarqueeMenu isVisible={menuVisible} />
        </>
    );
}

export default function App() {
    return (
        <DiscoProvider>
            <Router>
                <Layout />
            </Router>
        </DiscoProvider>
    );
}