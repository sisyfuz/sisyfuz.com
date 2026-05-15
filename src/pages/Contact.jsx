import { useTypography } from "../hooks/useTypography";

export default function Contact() {
    useTypography();

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 font-mono uppercase">
            <div className="w-full max-w-md border border-white/20 p-8">
                <h2 className="font-title text-pink-500 mb-6 tracking-tighter">{">"} INITIALIZING_COMMUNICATION...</h2>
                <div className="space-y-6 font-body">
                    <a href="mailto:info@sisyfuz.com" className="block hover:text-pink-500 underline">Email_Direct</a>
                    <a href="https://instagram.com/sisyfuz" target="_blank" rel="noopener noreferrer" className="block hover:text-pink-500 underline">Instagram</a>
                </div>
            </div>
        </div>
    );
}
