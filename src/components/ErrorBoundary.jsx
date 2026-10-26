// src/components/ErrorBoundary.jsx
import React from "react";
import { ASCII_DIVIDER } from "../utils/ascii";

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught runtime error:", error, errorInfo);
    }

    handleReload = () => {
        window.location.reload();
    };

    handleResetAndHome = () => {
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch { /* best-effort: ignore */ }
        window.location.href = "/";
    };

    render() {
        if (this.state.hasError) {
            const errorMsg = String(this.state.error?.message || this.state.error || "UNKNOWN_SYSTEM_FAULT");

            return (
                <div
                    role="alert"
                    className="min-h-screen w-full bg-[#050505] text-[#f0f0f0] font-mono px-[2ch] py-[1lh] sm:px-[4ch] sm:py-[2lh] md:px-[6ch] md:py-[2lh] flex flex-col items-center justify-center select-text"
                >
                    <div className="w-full max-w-[84ch] bg-[#0a0a0a] px-[2ch] py-[1lh] sm:px-[4ch] sm:py-[2lh] space-y-[1lh] shadow-2xl">
                        <div className="flex items-center justify-between">
                            <span className="text-[#ff0080] font-bold uppercase flex items-center gap-x-[1ch]">
                                <span className="cell animate-pulse">●</span>
                                [CRITICAL_FAULT_RECOVERY // ERROR_BOUNDARY]
                            </span>
                            <span className="text-neutral-500 uppercase">[CODE: 0xDEAD]</span>
                        </div>

                        <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap">
                            {ASCII_DIVIDER}
                        </div>

                        <p className="text-neutral-300">
                            A runtime fault was intercepted before it could cause an unhandled crash or black screen. Your session data remains safe.
                        </p>

                        <div className="bg-[#0f0008] px-[2ch] py-[1lh] text-[#ff0080] font-mono overflow-x-auto whitespace-pre no-scrollbar">
                            &gt; EXCEPTION: {errorMsg}
                        </div>

                        <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap">
                            {ASCII_DIVIDER}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-[2ch] gap-y-[1lh]">
                            <button
                                type="button"
                                onClick={this.handleReload}
                                className="touch-target cursor-pointer bg-[#ff0080] text-black font-bold px-[2ch] uppercase hover:bg-white transition-none"
                            >
                                [RELOAD_SESSION ⟳]
                            </button>
                            <button
                                type="button"
                                onClick={this.handleResetAndHome}
                                className="touch-target cursor-pointer text-neutral-400 hover:bg-white hover:text-black px-[2ch] uppercase transition-none font-bold"
                            >
                                [RESET_STORAGE_&_HOME →]
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
