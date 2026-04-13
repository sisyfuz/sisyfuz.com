import { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { DiscoProvider, useDisco } from "./context/DiscoContext"; // Let op: useDisco import toegevoegd
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
        className={`fixed bottom-0 left-0 w-full z-50 bg-black py-4 border-t border-white/10 overflow-hidden whitespace-nowrap transition-transform duration-700 ease-in-out
            ${isVisible ? "translate-y-0" : "translate-y-full"}`}
    >
        <div className="animate-marquee cursor-crosshair">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="flex shrink-0">
                    {menuItems.map((item) => (
                        <Link
                            key={item.label}
                            to={item.to}
                            className="text-white text-[10px] font-mono uppercase tracking-[0.3em] px-12 transition-colors duration-150 outline-none focus:text-pink-400 hover:text-pink-500 active:text-pink-500"
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
    const { setDiscoMode } = useDisco(); // Pak de setter uit je context

    const isHome = location.pathname === "/";
    const [scrollVisible, setScrollVisible] = useState(false);
    const [buffer, setBuffer] = useState(""); // Buffer voor je typwerk

    // --- COMMAND LISTENER LOGICA ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            const key = e.key.toLowerCase();

            // We luisteren alleen naar letters a-z
            if (key.length === 1 && /[a-z]/.test(key)) {
                const newBuffer = (buffer + key).slice(-10);
                setBuffer(newBuffer);

                // Check commando's
                if (newBuffer.endsWith("disco")) {
                    setDiscoMode(prev => !prev);
                    setBuffer("");
                } else if (newBuffer.endsWith("work")) {
                    navigate("/work");
                    setBuffer("");
                } else if (newBuffer.endsWith("archive")) {
                    navigate("/archive");
                    setBuffer("");
                } else if (newBuffer.endsWith("about")) {
                    navigate("/about");
                    setBuffer("");
                } else if (newBuffer.endsWith("contact")) {
                    navigate("/contact");
                    setBuffer("");
                } else if (newBuffer.endsWith("home")) {
                    navigate("/");
                    setBuffer("");
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [buffer, navigate, setDiscoMode]);

    // --- BESTAANDE SCROLL LOGICA ---
    useEffect(() => {
        if (!isHome) return;
        const handleScroll = () => setScrollVisible(window.scrollY / 700 > 0.1);
        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener("scroll", handleScroll);
    }, [isHome]);

    const menuVisible = isHome ? scrollVisible : true;

    return (
        <>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/work" element={<Work />} />
                <Route path="/archive" element={<Archive />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
            {buffer && (
                <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                    <span className="font-mono text-xs text-gray-400/40 tracking-widest">
                        &gt; {buffer}_
                    </span>
                </div>
            )}
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