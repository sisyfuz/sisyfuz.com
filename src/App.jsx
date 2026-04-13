import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { DiscoProvider } from "./context/DiscoContext";
import Home from "./pages/Home";

// Eventuele andere pagina's
// import Work from "./pages/Work";

export default function App() {
    return (
        /* De DiscoProvider moet BUITEN de Router staan om globaal te werken */
        <DiscoProvider>
            <Router>
                <Routes>
                    <Route path="/" element={<Home />} />

                    {/* Zodra je meer pagina's maakt, voeg je ze hier toe. 
                        Ze erven allemaal de Disco-functionaliteit! 
                    */}
                    {/* <Route path="/work" element={<Work />} /> */}
                </Routes>
            </Router>
        </DiscoProvider>
    );
}