export default function Contact() {
    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 font-mono uppercase">
            <div className="w-full max-w-md border border-white/20 p-8">
                <h2 className="text-pink-500 mb-6 tracking-tighter">{">"} INITIALIZING_COMMUNICATION...</h2>
                <div className="space-y-6">
                    <a href="mailto:info@sisyfuz.com" className="block hover:text-pink-500 underline">Email_Direct</a>
                    <a href="https://instagram.com/sisyfuz" className="block hover:text-pink-500 underline">Instagram</a>
                </div>
            </div>
        </div>
    );
}