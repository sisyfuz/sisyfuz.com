import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {/* Hero Sectie */}
        <section className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="relative mb-12">
            {/* De hoofd-image met zwevende logo's */}
            <img src={heroImg} className="w-44 h-auto drop-shadow-2xl" alt="Hero" />
            <img src={reactLogo} className="absolute -bottom-4 -right-4 w-12 h-12 animate-spin-slow" alt="React logo" />
            <img src={viteLogo} className="absolute -top-4 -left-4 w-12 h-12" alt="Vite logo" />
          </div>

          <h1 className="text-6xl font-black tracking-tighter mb-4 bg-gradient-to-r from-indigo-600 to-sky-500 bg-clip-text text-transparent">
            GET STARTED
          </h1>

          <p className="text-lg text-slate-600 max-w-md mx-auto mb-8">
            Pas <code className="bg-slate-200 px-2 py-1 rounded text-sm font-mono">src/App.jsx</code> aan en sla op om de wijzigingen direct te zien.
          </p>

          <button
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-10 rounded-full transition-all transform hover:scale-105 shadow-xl active:scale-95"
              onClick={() => setCount((count) => count + 1)}
          >
            Teller staat op: {count}
          </button>
        </section>

        {/* Informatie Sectie */}
        <section className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8 px-6 pb-20">
          {/* Documentatie Kaart */}
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
            <div className="text-3xl mb-4">📚</div>
            <h2 className="text-2xl font-bold mb-2">Documentatie</h2>
            <p className="text-slate-500 mb-6">Alles wat je moet weten over Vite en React.</p>
            <ul className="space-y-3">
              <li>
                <a href="https://vite.dev" target="_blank" className="flex items-center text-indigo-600 hover:underline">
                  <img className="w-5 h-5 mr-2" src={viteLogo} alt="" /> Explore Vite
                </a>
              </li>
              <li>
                <a href="https://react.dev" target="_blank" className="flex items-center text-indigo-600 hover:underline">
                  <img className="w-5 h-5 mr-2" src={reactLogo} alt="" /> Learn React
                </a>
              </li>
            </ul>
          </div>

          {/* Social Kaart */}
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
            <div className="text-3xl mb-4">💬</div>
            <h2 className="text-2xl font-bold mb-2">Community</h2>
            <p className="text-slate-500 mb-6">Maak verbinding met andere ontwikkelaars.</p>
            <div className="grid grid-cols-2 gap-4">
              <a href="https://github.com" target="_blank" className="bg-slate-100 p-3 rounded-xl text-center hover:bg-slate-200 transition-colors">GitHub</a>
              <a href="https://vite.dev" target="_blank" className="bg-slate-100 p-3 rounded-xl text-center hover:bg-slate-200 transition-colors">Discord</a>
              <a href="https://x.com" target="_blank" className="bg-slate-100 p-3 rounded-xl text-center hover:bg-slate-200 transition-colors">X.com</a>
              <a href="https://bsky.app" target="_blank" className="bg-slate-100 p-3 rounded-xl text-center hover:bg-slate-200 transition-colors">Bluesky</a>
            </div>
          </div>
        </section>
      </div>
  );
}

export default App;
