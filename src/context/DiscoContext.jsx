import { createContext, useContext, useState, useEffect } from "react";

const DiscoContext = createContext();

export function DiscoProvider({ children }) {
    const [discoMode, setDiscoMode] = useState(false);
    const [inputBuffer, setInputBuffer] = useState("");

    useEffect(() => {
        const handleKeyDown = (e) => {
            const key = e.key.toLowerCase();
            // Alleen letters loggen
            if (key.length === 1 && /[a-z]/.test(key)) {
                const newBuffer = (inputBuffer + key).slice(-10);
                setInputBuffer(newBuffer);

                // Check of de buffer eindigt op 'disco'
                if (newBuffer.endsWith("disco")) {
                    setDiscoMode(prev => !prev);
                    setInputBuffer(""); // Reset buffer na activatie
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [inputBuffer]);

    return (
        <DiscoContext.Provider value={{ discoMode }}>
            {children}
        </DiscoContext.Provider>
    );
}
export const useDisco = () => useContext(DiscoContext);