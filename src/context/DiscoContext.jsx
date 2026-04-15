import { createContext, useContext, useState } from "react";

const DiscoContext = createContext();

export function DiscoProvider({ children }) {
    const [discoMode, setDiscoMode] = useState(false);
    // NIEUW: Deze state houdt bij wat je in de terminal typt
    const [searchQuery, setSearchQuery] = useState("");

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