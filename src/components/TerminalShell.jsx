// src/components/TerminalShell.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTerminalTheme } from "../context/TerminalThemeContext";
import { SISYFUZ_BANNER } from "../utils/ascii";
import TuiWork from "../tui/TuiWork";
import TuiArchive from "../tui/TuiArchive";
import TuiAbout from "../tui/TuiAbout";
import TuiContact from "../tui/TuiContact";
import TuiPress from "../tui/TuiPress";

const VALID_COMMANDS = [
    "help",
    "ls",
    "work",
    "archive",
    "about",
    "contact",
    "press",
    "clear",
    "theme",
    "disco",
    "whoami",
    "cat",
    "view",
];

export default function TerminalShell() {
    const navigate = useNavigate();
    const location = useLocation();
    const { theme, themeKey, setTheme, availableThemes } = useTerminalTheme();

    const [activeView, setActiveView] = useState("home");
    const [selectedWorkId, setSelectedWorkId] = useState(null);
    const [inputVal, setInputVal] = useState("");
    const [commandHistory, setCommandHistory] = useState([]);
    const [historyIdx, setHistoryIdx] = useState(-1);
    const [outputLogs, setOutputLogs] = useState([]);
    const [isDisco, setIsDisco] = useState(false);
    const [currentTime, setCurrentTime] = useState("");

    const inputRef = useRef(null);
    const scrollContainerRef = useRef(null);

    // Clock
    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            setCurrentTime(now.toTimeString().split(" ")[0]);
        };
        updateTime();
        const id = setInterval(updateTime, 1000);
        return () => clearInterval(id);
    }, []);

    // Sync route with terminal activeView
    useEffect(() => {
        const path = location.pathname.replace(/^\//, "").toLowerCase();
        if (path === "" || path === "home") {
            setActiveView("home");
        } else if (path === "work") {
            setActiveView("work");
            if (location.hash) {
                setSelectedWorkId(location.hash.replace("#", ""));
            }
        } else if (path === "archive") {
            setActiveView("archive");
        } else if (path === "about") {
            setActiveView("about");
        } else if (path === "contact") {
            setActiveView("contact");
        } else if (path === "press") {
            setActiveView("press");
        }
    }, [location.pathname, location.hash]);

    const executeCommand = (cmdStr) => {
        const trimmed = cmdStr.trim();
        if (!trimmed) return;

        // Push to history
        setCommandHistory(prev => [trimmed, ...prev.filter(c => c !== trimmed)]);
        setHistoryIdx(-1);

        const [cmd, ...args] = trimmed.split(" ");
        const lowerCmd = cmd.toLowerCase();

        switch (lowerCmd) {
            case "help":
                addLog(trimmed, (
                    <div className="space-y-2 text-xs">
                        <div className="font-bold border-b border-current/20 pb-1">AVAILABLE SYSTEM COMMANDS:</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                            <div><b className="text-current">[work]</b> — Browse projects with live ASCII graphics</div>
                            <div><b className="text-current">[archive]</b> — View tabular archive of all works</div>
                            <div><b className="text-current">[about]</b> — Open Dorus Kleijne manifesto & specs</div>
                            <div><b className="text-current">[contact]</b> — Transmit inquiry / direct protocols</div>
                            <div><b className="text-current">[press]</b> — Access attempt button counter</div>
                            <div><b className="text-current">[theme &lt;name&gt;]</b> — pink, green, amber, mono</div>
                            <div><b className="text-current">[view &lt;id&gt;]</b> — Open specific project dossier</div>
                            <div><b className="text-current">[ls]</b> — List filesystem contents</div>
                            <div><b className="text-current">[clear]</b> — Clear terminal screen</div>
                            <div><b className="text-current">[disco]</b> — Toggle color-cycling mode</div>
                            <div><b className="text-current">[whoami]</b> — Print entity identification</div>
                        </div>
                    </div>
                ));
                break;

            case "ls":
            case "dir":
                addLog(trimmed, (
                    <div className="text-xs space-y-1 font-mono">
                        <div className="text-[10px] opacity-60">CONTENTS OF /ROOT:</div>
                        <div className="flex gap-4 flex-wrap">
                            <span className="cursor-pointer underline" onClick={() => executeCommand("work")}>📁 work/</span>
                            <span className="cursor-pointer underline" onClick={() => executeCommand("archive")}>📁 archive/</span>
                            <span className="cursor-pointer underline" onClick={() => executeCommand("about")}>📄 about.txt</span>
                            <span className="cursor-pointer underline" onClick={() => executeCommand("contact")}>📡 contact.sh</span>
                            <span className="cursor-pointer underline" onClick={() => executeCommand("press")}>⚙️ press.bin</span>
                        </div>
                    </div>
                ));
                break;

            case "work":
                setActiveView("work");
                setSelectedWorkId(null);
                navigate("/work");
                addLog(trimmed, "OPENING_DIRECTORY: /ROOT/WORKS");
                break;

            case "archive":
                setActiveView("archive");
                navigate("/archive");
                addLog(trimmed, "OPENING_REGISTRY: /ROOT/ARCHIVE");
                break;

            case "about":
            case "cat about.txt":
            case "cat about":
                setActiveView("about");
                navigate("/about");
                addLog(trimmed, "READING_FILE: /ETC/DORUS_KLEIJNE.CONF");
                break;

            case "contact":
            case "./contact.sh":
                setActiveView("contact");
                navigate("/contact");
                addLog(trimmed, "INITIALIZING_COMMUNICATION_LINK");
                break;

            case "press":
            case "./press.bin":
                setActiveView("press");
                navigate("/press");
                addLog(trimmed, "ACCESSION: ATTEMPT_COUNTER_METRIC");
                break;

            case "home":
                setActiveView("home");
                navigate("/");
                addLog(trimmed, "RETURNING_ROOT_TERMINAL");
                break;

            case "view":
                if (args.length > 0) {
                    const id = args[0];
                    setSelectedWorkId(id);
                    setActiveView("work");
                    navigate(`/work#${id}`);
                    addLog(trimmed, `LOADING_PROJECT_DOSSIER: ${id}`);
                } else {
                    addLog(trimmed, "USAGE: view <project_id> (e.g. 'work' to list IDs)");
                }
                break;

            case "clear":
                setOutputLogs([]);
                setActiveView("home");
                break;

            case "theme":
                if (args.length > 0) {
                    const targetTheme = args[0].toLowerCase();
                    const success = setTheme(targetTheme);
                    if (success) {
                        addLog(trimmed, `PHOSPHOR THEME CHANGED TO: [${targetTheme.toUpperCase()}]`);
                    } else {
                        addLog(trimmed, `UNKNOWN THEME. AVAILABLE: ${availableThemes.join(", ")}`);
                    }
                } else {
                    addLog(trimmed, `CURRENT THEME: [${themeKey.toUpperCase()}]. AVAILABLE: ${availableThemes.join(", ")}`);
                }
                break;

            case "disco":
                setIsDisco(prev => !prev);
                addLog(trimmed, !isDisco ? "DISCO_PROTOCOL: ACTIVE" : "DISCO_PROTOCOL: TERMINATED");
                break;

            case "whoami":
                addLog(trimmed, "Dorus Kleijne (2006) // sisyfuz // Interdisciplinary artist, theater & queer sci-fi.");
                break;

            case "sudo":
                addLog(trimmed, "PERMISSION DENIED: Sisyphus does not answer to administrative elevation.");
                break;

            default:
                addLog(trimmed, `COMMAND NOT RECOGNIZED: '${cmd}'. TYPE 'help' OR CLICK A SHORTCUT.`);
                break;
        }

        setInputVal("");
    };

    const addLog = (cmd, content) => {
        setOutputLogs(prev => [...prev.slice(-15), { cmd, content, time: new Date().toLocaleTimeString() }]);
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter") {
            executeCommand(inputVal);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (commandHistory.length > 0) {
                const nextIdx = Math.min(commandHistory.length - 1, historyIdx + 1);
                setHistoryIdx(nextIdx);
                setInputVal(commandHistory[nextIdx]);
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (historyIdx > 0) {
                const nextIdx = historyIdx - 1;
                setHistoryIdx(nextIdx);
                setInputVal(commandHistory[nextIdx]);
            } else if (historyIdx === 0) {
                setHistoryIdx(-1);
                setInputVal("");
            }
        } else if (e.key === "Tab") {
            e.preventDefault();
            const matching = VALID_COMMANDS.filter(c => c.startsWith(inputVal.toLowerCase().trim()));
            if (matching.length === 1) {
                setInputVal(matching[0]);
            }
        }
    };

    // Cycle themes when clicking the theme pill
    const cycleTheme = () => {
        const idx = availableThemes.indexOf(themeKey);
        const next = availableThemes[(idx + 1) % availableThemes.length];
        setTheme(next);
    };

    return (
        <div
            className={`min-h-screen ${theme.bg} ${theme.text} font-mono flex flex-col p-2 sm:p-4 md:p-6 select-text transition-colors duration-300 ${
                isDisco ? "animate-disco" : ""
            }`}
        >
            {/* Terminal Main Window Frame */}
            <div className={`flex-1 border ${theme.border} flex flex-col bg-black/60 shadow-2xl relative overflow-hidden backdrop-blur-sm`}>
                
                {/* Header Title Bar */}
                <header className={`border-b ${theme.border} px-3 py-2 flex items-center justify-between text-[11px] sm:text-xs uppercase bg-black/40 select-none`}>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full inline-block cursor-pointer" onClick={() => executeCommand("clear")}></span>
                        <span className="w-2.5 h-2.5 bg-yellow-500 rounded-full inline-block cursor-pointer" onClick={() => executeCommand("help")}></span>
                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full inline-block cursor-pointer" onClick={cycleTheme}></span>
                        <span className="font-bold tracking-wider ml-1">
                            [SISYFUZ-OS v2.6.0] // TTY1
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={cycleTheme}
                            className="border border-current px-2 py-0.5 text-[10px] tracking-widest hover:bg-current hover:text-black transition-colors"
                        >
                            THEME: [{themeKey.toUpperCase()}]
                        </button>
                        <span className="hidden sm:inline opacity-60 tabular-nums">
                            {currentTime}
                        </span>
                    </div>
                </header>

                {/* Quick Interactive Command Bar */}
                <div className={`border-b ${theme.border} px-3 py-2 flex items-center gap-2 flex-wrap text-xs bg-black/20 select-none overflow-x-auto`}>
                    <span className="opacity-50 text-[10px] uppercase tracking-widest mr-1">EXECUTE:</span>
                    {["work", "archive", "about", "contact", "press", "help", "clear"].map(cmd => (
                        <button
                            key={cmd}
                            onClick={() => executeCommand(cmd)}
                            className={`border px-2.5 py-0.5 text-[11px] uppercase tracking-wider transition-all ${
                                activeView === cmd
                                    ? "bg-current text-black font-bold border-current"
                                    : "border-current/40 hover:border-current hover:bg-current/10"
                            }`}
                        >
                            [{cmd}]
                        </button>
                    ))}
                </div>

                {/* Terminal Body Content */}
                <div
                    ref={scrollContainerRef}
                    className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto space-y-6"
                    onClick={() => inputRef.current?.focus()}
                >
                    {/* Welcome Banner when in Home view */}
                    {activeView === "home" && (
                        <div className="space-y-6">
                            <pre className="text-[10px] sm:text-xs md:text-sm leading-none font-bold text-current select-none overflow-x-auto">
                                {SISYFUZ_BANNER}
                            </pre>

                            <div className="border border-current/30 p-4 space-y-3 bg-black/40 text-xs sm:text-sm">
                                <div className="font-bold text-current uppercase tracking-wider">
                                    // SYSTEM ROOT LOGIN: DORUS KLEIJNE (SISYFUZ)
                                </div>
                                <p className="opacity-90 leading-relaxed">
                                    Welcome to sisyfuz.com terminal environment. Interdisciplinary art, scenography, and queer speculative sci-fi. All media, assets, and documentation are rendered directly into ASCII buffers.
                                </p>
                                <p className="text-[11px] opacity-70">
                                    Type <span className="font-bold underline cursor-pointer" onClick={() => executeCommand("help")}>'help'</span> for instructions, or click any command badge above to initiate routines.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                <div
                                    onClick={() => executeCommand("work")}
                                    className="border border-current/30 p-3 hover:border-current hover:bg-current/10 cursor-pointer transition-colors"
                                >
                                    <div className="font-bold uppercase">[ 01_WORKS ]</div>
                                    <div className="text-[10px] opacity-60 mt-1">Selected projects with ASCII shaders</div>
                                </div>

                                <div
                                    onClick={() => executeCommand("archive")}
                                    className="border border-current/30 p-3 hover:border-current hover:bg-current/10 cursor-pointer transition-colors"
                                >
                                    <div className="font-bold uppercase">[ 02_ARCHIVE ]</div>
                                    <div className="text-[10px] opacity-60 mt-1">Full chronological system index</div>
                                </div>

                                <div
                                    onClick={() => executeCommand("about")}
                                    className="border border-current/30 p-3 hover:border-current hover:bg-current/10 cursor-pointer transition-colors"
                                >
                                    <div className="font-bold uppercase">[ 03_ABOUT ]</div>
                                    <div className="text-[10px] opacity-60 mt-1">Artist manifesto & specs</div>
                                </div>

                                <div
                                    onClick={() => executeCommand("contact")}
                                    className="border border-current/30 p-3 hover:border-current hover:bg-current/10 cursor-pointer transition-colors"
                                >
                                    <div className="font-bold uppercase">[ 04_CONTACT ]</div>
                                    <div className="text-[10px] opacity-60 mt-1">Communication channels</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Active View Containers */}
                    {activeView === "work" && (
                        <TuiWork onExecuteCommand={executeCommand} selectedId={selectedWorkId} />
                    )}

                    {activeView === "archive" && (
                        <TuiArchive onExecuteCommand={executeCommand} />
                    )}

                    {activeView === "about" && (
                        <TuiAbout onExecuteCommand={executeCommand} />
                    )}

                    {activeView === "contact" && (
                        <TuiContact onExecuteCommand={executeCommand} />
                    )}

                    {activeView === "press" && (
                        <TuiPress />
                    )}

                    {/* Output History Logs */}
                    {outputLogs.length > 0 && (
                        <div className="border-t border-current/20 pt-4 space-y-3">
                            <div className="text-[10px] opacity-50 uppercase tracking-widest">// COMMAND_EXECUTION_LOG:</div>
                            {outputLogs.map((log, i) => (
                                <div key={i} className="text-xs space-y-1">
                                    <div className="flex items-center gap-2 opacity-70">
                                        <span className="text-pink-500 font-bold">&gt;</span>
                                        <span>user@sisyfuz:~$ {log.cmd}</span>
                                        <span className="text-[9px] opacity-40 ml-auto">{log.time}</span>
                                    </div>
                                    <div className="pl-4 opacity-90">{log.content}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Command Line Input Footer */}
                <footer className={`border-t ${theme.border} p-3 sm:p-4 bg-black/60 flex items-center gap-2 select-none`}>
                    <span className="text-xs sm:text-sm font-bold text-current flex items-center gap-1 shrink-0">
                        <span>user@sisyfuz:~$</span>
                    </span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputVal}
                        onChange={(e) => setInputVal(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="type command (e.g. 'work', 'about', 'help', 'theme')..."
                        className="flex-1 bg-transparent border-none outline-none font-mono text-xs sm:text-sm text-current placeholder:text-current/30 selection:bg-current selection:text-black"
                        autoFocus
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                    />
                    <button
                        onClick={() => executeCommand(inputVal)}
                        className="border border-current px-3 py-1 text-xs uppercase font-bold hover:bg-current hover:text-black transition-colors"
                    >
                        RUN ↵
                    </button>
                </footer>

            </div>
        </div>
    );
}
