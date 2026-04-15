import { useEffect, useState, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
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

    const inputRef = useRef(null);

    const processCommand = (val) => {
        setBuffer(val);

        const routes = ["work", "archive", "about", "contact", "home"];

        if (val.endsWith("disco")) {
            setDiscoMode(prev => !prev);
            setBuffer("");
            setSearchQuery("");
            inputRef.current?.blur();
        }
        else if (routes.some(r => val.endsWith(r))) {
            const matchedRoute = routes.find(r => val.endsWith(r));
            navigate(matchedRoute === "home" ? "/" : `/${matchedRoute}`);
            setBuffer("");
            setSearchQuery("");
            inputRef.current?.blur();
        }
        else {
            setSearchQuery(val.trim());
        }
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
            if (e.key === "Enter" || e.key === "Escape") {
                setBuffer("");
                setSearchQuery("");
                return;
            }
            if (e.key === "Backspace") {
                processCommand(buffer.slice(0, -1));
                return;
            }

            const key = e.key.toLowerCase();
            if (key.length === 1 && /[a-z0-9 ]/.test(key)) {
                processCommand((buffer + key).slice(-25));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [buffer, location.pathname, navigate]);

    useEffect(() => {
        if (!isHome) return;
        const handleScroll = () => setScrollVisible(window.scrollY / 500 > 0.1);
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [isHome]);

    const menuVisible = isHome ? scrollVisible : true;

    return (
        <>
            {/* TERMINAL LOG: Verplaatst naar beneden + mix-blend-difference */}
            <div
                className="fixed z-50 text-center pointer-events-auto md:pointer-events-none mix-blend-difference"
                style={{
                    // Dynamisch geplaatst net boven de marquee, veilig voor iPhone balkjes
                    bottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
                    left: '50%',
                    transform: 'translateX(-50%)'
                }}
                onClick={() => {
                    if (window.innerWidth < 768) inputRef.current?.focus();
                }}
            >
                <input
                    ref={inputRef}
                    type="text"
                    value={buffer}
                    onChange={(e) => {
                        const cleanVal = e.target.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(-25);
                        processCommand(cleanVal);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") {
                            setBuffer("");
                            setSearchQuery("");
                            e.target.blur();
                        }
                    }}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-text md:hidden"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                />

                <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-white flex items-center justify-center">
                    <div className="md:hidden flex items-center opacity-40">
                        <span className="mr-2">&gt;</span>
                        <span className="bg-white/10 px-3 py-1.5 rounded-sm flex items-center min-w-[140px] justify-center">
                            {buffer || "tap_to_search"}
                        </span>
                        <span className="animate-pulse ml-2 w-1.5 h-3.5 bg-white"></span>
                    </div>

                    <div className="hidden md:flex items-center opacity-40 transition-all">
                        <span className="mr-2">&gt;</span>
                        <span className="bg-white/5 px-2 py-1 rounded-sm">
                            {buffer || "..."}
                        </span>
                        <span className="animate-pulse ml-1 inline-block w-1 h-3 bg-white align-middle"></span>
                    </div>
                </div>
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