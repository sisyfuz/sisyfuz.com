import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisco } from "../context/DiscoContext";

export default function CommandListener() {
    const [buffer, setBuffer] = useState("");
    const navigate = useNavigate();
    const { setDiscoMode } = useDisco();

    useEffect(() => {
        const handleKeyDown = (e) => {
            const key = e.key.toLowerCase();
            if (key.length === 1 && /[a-z]/.test(key)) {
                const newBuffer = (buffer + key).slice(-10);
                setBuffer(newBuffer);

                // --- COMMANDS ---

                // 1. Disco toggle
                if (newBuffer.endsWith("disco")) {
                    setDiscoMode(prev => !prev);
                    setBuffer("");
                }

                // 2. Navigatie: naar Home
                if (newBuffer.endsWith("home")) {
                    navigate("/");
                    setBuffer("");
                }

                // 3. Navigatie: naar About (als je die pagina hebt)
                if (newBuffer.endsWith("about")) {
                    navigate("/about");
                    setBuffer("");
                }

                // 4. Navigatie: naar Work
                if (newBuffer.endsWith("work")) {
                    navigate("/work");
                    setBuffer("");
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [buffer, navigate, setDiscoMode]);

    return null; // Dit component rendert niets, het luistert alleen
}