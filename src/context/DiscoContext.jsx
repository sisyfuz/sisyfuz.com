import { createContext, useContext, useState } from "react";

const DiscoContext = createContext();

export function DiscoProvider({ children }) {
    const [discoMode, setDiscoMode] = useState(false);

    return (
        <DiscoContext.Provider value={{ discoMode, setDiscoMode }}>
            {children}
        </DiscoContext.Provider>
    );
}

export const useDisco = () => useContext(DiscoContext);