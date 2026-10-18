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
        } catch {}
        window.location.href = "/";
    };

    render() {
        if (this.state.hasError) {
            const errorMsg = String(this.state.error?.message || this.state.error || "UNKNOWN_SYSTEM_FAULT");

            return (
                <div
                    role="alert"
                    className="min-h-screen w-full bg-[#050505] text-[#f0f0f0] font-mono text-xs sm:text-sm p-4 sm:p-8 md:p-12 flex flex-col items-center justify-center select-text"
                >
                    <div className="w-full max-w-2xl bg-[#0a0a0a] p-5 sm:p-8 space-y-4 shadow-2xl">
                        <div className="flex items-center justify-between pb-2">
                            <span className="text-[#ff0080] font-bold text-sm sm:text-base tracking-wider uppercase flex items-center gap-2">
                                <span className="animate-pulse">●</span>
                                [CRITICAL_FAULT_RECOVERY // ERROR_BOUNDARY]
                            </span>
                            <span className="text-neutral-500 text-[11px] uppercase">[CODE: 0xDEAD]</span>
                        </div>

                        <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap text-[10px] leading-none">
                            {ASCII_DIVIDER}
                        </div>

                        <p className="text-neutral-300 leading-relaxed text-xs sm:text-sm">
                            A runtime fault was intercepted before it could cause an unhandled crash or black screen. Your session data remains safe.
                        </p>

                        <div className="bg-[#0f0008] p-3 text-[#ff0080] font-mono text-[11px] sm:text-xs overflow-x-auto whitespace-pre no-scrollbar">
                            &gt; EXCEPTION: {errorMsg}
                        </div>

                        <div aria-hidden="true" className="text-neutral-800 select-none overflow-hidden whitespace-nowrap text-[10px] leading-none pt-2">
                            {ASCII_DIVIDER}
                        </div>

                        <div className="pt-2 flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={this.handleReload}
                                className="touch-target cursor-pointer bg-[#ff0080] text-black font-bold px-3 py-1.5 uppercase hover:bg-white transition-none"
                            >
                                [RELOAD_SESSION ⟳]
                            </button>
                            <button
                                type="button"
                                onClick={this.handleResetAndHome}
                                className="touch-target cursor-pointer text-neutral-400 hover:bg-white hover:text-black px-3 py-1.5 uppercase transition-none font-bold"
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
