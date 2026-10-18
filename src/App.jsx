import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { DiscoProvider } from "./context/DiscoContext";
import { A11yProvider } from "./context/A11yContext";
import { TerminalThemeProvider } from "./context/TerminalThemeContext";
import SharpDisplay from "./components/SharpDisplay";
import ErrorBoundary from "./components/ErrorBoundary";
import { useTypography } from "./hooks/useTypography";

export default function App() {
    useTypography();

    return (
        <ErrorBoundary>
            <A11yProvider>
                <TerminalThemeProvider>
                    <DiscoProvider>
                        <Router>
                            <Routes>
                                <Route path="/*" element={<SharpDisplay />} />
                            </Routes>
                        </Router>
                    </DiscoProvider>
                </TerminalThemeProvider>
            </A11yProvider>
        </ErrorBoundary>
    );
}