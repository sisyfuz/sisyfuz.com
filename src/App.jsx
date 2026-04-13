import { useEffect, useState } from "react";
import { HashRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Work from "./pages/Work";
import Archive from "./pages/Archive";
import About from "./pages/About";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";

const GlobalStyles = () => (
    <style dangerouslySetInnerHTML={{ __html: `
    @keyframes marqueeScroll {
      0% { transform: translateX(0%); }
      100% { transform: translateX(-50%); }
    }
    .marquee-active {
      display: flex !important;
      width: max-content !important;
      animation: marqueeScroll 25s linear infinite !important;
    }
    /* Zorgt dat animaties stoppen als de gebruiker 'Reduced Motion' heeft aanstaan */
    @media (prefers-reduced-motion: reduce) {
      .marquee-active {
        animation: none !important;
        overflow-x: auto !important;
      }
    }
  `}} />
);

// --- MARQUEE MENU ---
const MarqueeMenu = ({ isVisible }) => {
    const menuItems = [
        { label: "_work", path: "/work" },
        { label: "_archive", path: "/archive" },
        { label: "_about", path: "/about" },
        { label: "_contact", path: "/contact" },
        { label: "_home", path: "/" }
    ];

    return (
        <nav
            aria-label="Hoofdnavigatie"
            /* Uitleg classes:
               - translate-y: voor het visuele effect
               - invisible/visible: voor toegankelijkheid (haalt het uit de tab-volgorde)
               - opacity: voor een mooie fade
            */
            className={`fixed bottom-0 left-0 w-full z-[9999] bg-black py-4 border-t border-white/10 overflow-hidden whitespace-nowrap transition-all duration-700 ease-in-out 
            ${isVisible ? 'translate-y-0 opacity-100 visible' : 'translate-y-full opacity-0 invisible'}`}
        >
            <div className="flex marquee-active hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] cursor-crosshair w-max">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex shrink-0" aria-hidden={i > 0}>
                        {menuItems.map((item, index) => (
                            <Link
                                key={index}
                                to={item.path}
                                className="text-white text-[10px] font-mono uppercase tracking-[0.3em] px-12 hover:text-pink-500 focus:text-pink-500 focus:outline-none focus:underline active:text-pink-500 transition-colors duration-150 no-underline"
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>
                ))}
            </div>
        </nav>
    );
};

// --- APP WRAPPER (voor route & scroll logica) ---
function AppContent() {
    const location = useLocation();
    const [scrollProgress, setScrollProgress] = useState(0);

    useEffect(() => {
        const handleScroll = () => {
            // We meten de scroll-positie (700px is onze range)
            const currentScroll = window.scrollY;
            setScrollProgress(Math.min(currentScroll / 700, 1));
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll(); // Directe check bij laden

        return () => window.removeEventListener("scroll", handleScroll);
    }, [location]); // Re-check als de gebruiker van pagina wisselt

    // Logica: Op home pas na scrollen, op andere pagina's altijd
    const isHome = location.pathname === "/";
    const menuIsVisible = isHome ? scrollProgress > 0.1 : true;

    return (
        <>
            <GlobalStyles />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/work" element={<Work />} />
                <Route path="/archive" element={<Archive />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                {/* De 404 vangnet-route */}
                <Route path="*" element={<NotFound />} />
            </Routes>
            <MarqueeMenu isVisible={menuIsVisible} />
        </>
    );
}

export default function App() {
    return (
        <Router>
            <AppContent />
        </Router>
    );
}