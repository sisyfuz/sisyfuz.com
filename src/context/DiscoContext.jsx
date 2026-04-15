import { createContext, useContext, useState, useEffect } from "react";
import { client } from "../sanityClient"; // IMPORT DE SANITY CLIENT

const DiscoContext = createContext();

export function DiscoProvider({ children }) {
    const [discoMode, setDiscoMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

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

        if (foundEgg && foundEgg.url) {
            // BOOM! Easter egg getriggerd.

            // Maak de zoekbalk snel weer leeg voor de netheid
            setSearchQuery("");

            // Open de link in een nieuw tabblad (zodat ze je portfolio niet kwijtraken)
            window.open(foundEgg.url, '_blank');

            // TIP: Wil je dat het in HETZELFDE tabblad opent? 
            // Verander de regel hierboven dan in: window.location.href = foundEgg.url;
        }
    }, [searchQuery, easterEggs]);

    return (
        <DiscoContext.Provider value={{
            discoMode,
            setDiscoMode,
            searchQuery,
            setSearchQuery
        }}>
            {children}
        </DiscoContext.Provider>
    );
}

export const useDisco = () => useContext(DiscoContext);