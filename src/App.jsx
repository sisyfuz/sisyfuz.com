import { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { DiscoProvider } from "./context/DiscoContext";
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
    const isHome = location.pathname === "/";
    const [scrollVisible, setScrollVisible] = useState(false);

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