import { Link } from "react-router-dom";

export default function About() {
    return (
        <div className="min-h-screen bg-white text-black p-8 md:p-24 font-sans uppercase">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-5xl font-black mb-12">_about</h1>
                <p className="text-lg leading-relaxed mb-8">
                    Dorus Kleijne (2006) maakt onverstaanbaar, intellectueel, eclectisch en interdisciplinair werk. Doormiddel van sci-fi ontstaan ruizige ervaringen, die inherent queer zijn.
                </p>
                <Link to="/" className="text-pink-500 font-mono text-xs">/terug_naar_huis</Link>
            </div>
        </div>
    );
}