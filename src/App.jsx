import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { DiscoProvider } from "./context/DiscoContext";
import { A11yProvider } from "./context/A11yContext";
import SharpDisplay from "./components/SharpDisplay";
import ErrorBoundary from "./components/ErrorBoundary";
import { useTypography } from "./hooks/useTypography";

export default function App() {
    useTypography();

    return (
        <ErrorBoundary>
            <A11yProvider>
                <DiscoProvider>
                    <Router>
                        <Routes>
                            <Route path="/*" element={<SharpDisplay />} />
                        </Routes>
                    </Router>
                </DiscoProvider>
            </A11yProvider>
        </ErrorBoundary>
    );
}