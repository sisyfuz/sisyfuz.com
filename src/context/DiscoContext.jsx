import { createContext, useContext, useState, useEffect } from "react";
import { client } from "../sanityClient"; // IMPORT DE SANITY CLIENT

const DiscoContext = createContext();

export function DiscoProvider({ children }) {
    const [discoMode, setDiscoMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [asciiLiveMode, setAsciiLiveMode] = useState(false);

    // NIEUW: State om de geheime commando's in op te slaan
    const [easterEggs, setEasterEggs] = useState([]);

    // 1. Haal de easter eggs onzichtbaar op de achtergrond op zodra de app laadt
    useEffect(() => {
        const query = `*[_type == "easterEgg"] { command, url }`;
        client.fetch(query)
            .then((data) => {
                setEasterEggs(data);
            })
            .catch((err) => console.error("Error fetching easter eggs:", err));
    }, []);

    // 2. De "Hacker" watcher: checkt bij elke letter die je typt of het een code is
    useEffect(() => {
        if (!searchQuery) return; // Doe niets als de zoekbalk leeg is

        const typedWord = searchQuery.toLowerCase().trim();

        // Zoek of het getypte woord exact overeenkomt met een command in de database
        const foundEgg = easterEggs.find(egg => egg.command === typedWord);

        if (foundEgg && typeof foundEgg.url === "string") {
            const rawUrl = foundEgg.url.trim();
            // Strictly allow only valid secure HTTP/HTTPS URLs (prevents javascript: XSS)
            if (rawUrl.startsWith("https://") || rawUrl.startsWith("http://")) {
                // Clearing the query is a one-shot reaction to a matched command, not derived state.
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setSearchQuery("");
                window.open(rawUrl, "_blank", "noopener,noreferrer");
            }
        }
    }, [searchQuery, easterEggs]);

    return (
        <DiscoContext.Provider value={{
            discoMode,
            setDiscoMode,
            searchQuery,
            setSearchQuery,
            asciiLiveMode,
            setAsciiLiveMode
        }}>
            {children}
        </DiscoContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export const useDisco = () => {
    const context = useContext(DiscoContext);
    if (!context) {
        return {
            discoMode: false,
            setDiscoMode: () => {},
            searchQuery: "",
            setSearchQuery: () => {},
            asciiLiveMode: false,
            setAsciiLiveMode: () => {},
        };
    }
    return context;
};