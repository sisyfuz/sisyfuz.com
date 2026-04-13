import { useEffect, useState } from "react";
import { HashRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Work from "./pages/Work";
import Archive from "./pages/Archive";
import About from "./pages/About";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";

// --- GLOBAL STYLES ---
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
  `}} />
);

// --- MARQUEE MENU ---
// Nu weer met de 'isVisible' prop
const MarqueeMenu = ({ isVisible }) => {
    const menuItems = [
        { label: "_work", path: "/work" },
        { label: "_archive", path: "/archive" },
        { label: "_about", path: "/about" },
        { label: "_contact", path: "/contact" },
        { label: "_home", path: "/" }
    ];

    return (
        <div className={`fixed bottom-0 left-0 w-full z-50 bg-black py-4 border-t border-white/10 overflow-hidden whitespace-nowrap transition-transform duration-700 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="flex marquee-active hover:[animation-play-state:paused] cursor-crosshair w-max">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex shrink-0">
                        {menuItems.map((item, index) => (
                            <Link
                                key={index}
                                to={item.path}
                                className="text-white text-[10px] font-mono uppercase tracking-[0.3em] px-12 hover:text-pink-500 active:text-pink-500 transition-colors duration-150 no-underline"
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- WRAPPER VOOR DE LOGICA ---
function AppContent() {
    const location = useLocation();
    const [progress, setProgress] = useState(0);

    // We houden de scroll-progress bij in de hoofd-app
    useEffect(() => {
        const handleScroll = () => {
            const p = Math.min(window.scrollY / 700, 1);
            setProgress(p);
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // LOGICA VOOR ZICHTBAARHEID:
    // Als pad "/" is (Home) -> toon pas na 10% scrollen.
    // Voor alle andere paden -> altijd tonen.
    const isHome = location.pathname === "/";
    const menuIsVisible = isHome ? progress > 0.1 : true;

    return (
        <>
            <GlobalStyles />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/work" element={<Work />} />
                <Route path="/archive" element={<Archive />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
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