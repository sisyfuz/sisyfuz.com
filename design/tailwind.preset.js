/** @type {import('tailwindcss').Config} */
module.exports = {
    theme: {
        extend: {
            colors: {
                tui: {
                    black: '#000000',
                    'surface-0': '#050505',
                    'surface-1': '#0a0a0a',
                    'surface-2': '#141414',
                    'border-dim': '#262626',
                    'border-med': '#333333',
                    'border-bright': '#444444',
                    white: '#ffffff',
                    'text-bright': '#f0f0f0',
                    'text-med': '#aaaaaa',
                    'text-dim': '#666666',
                    // Signature pink
                    pink: '#ff0080',
                    'pink-surface': '#2a0014',
                    // Cyber green
                    green: '#00ff66',
                    'green-surface': '#030d05',
                    // VT220 amber
                    amber: '#ffb000',
                    'amber-surface': '#0d0700',
                    // Status
                    live: '#ff0080',
                    standby: '#666666',
                    error: '#ff0055',
                    info: '#00e5ff',
                },
            },
            fontFamily: {
                mono: ['"Space Mono"', 'Menlo', 'Courier New', 'monospace'],
                display: ['"Sligoil Micro"', '"Space Grotesk"', 'sans-serif'],
            },
            borderRadius: {
                none: '0px',
                DEFAULT: '0px',
                sm: '0px',
                md: '0px',
                lg: '0px',
                xl: '0px',
                '2xl': '0px',
                full: '0px',
            },
            boxShadow: {
                'glow-pink': '0 0 10px rgba(255, 0, 128, 0.35)',
                'glow-green': '0 0 10px rgba(0, 255, 102, 0.35)',
                'glow-amber': '0 0 10px rgba(255, 176, 0, 0.35)',
            },
            keyframes: {
                tuiBlink: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.15' },
                },
                discoCycle: {
                    '0%': { filter: 'hue-rotate(0deg)' },
                    '100%': { filter: 'hue-rotate(360deg)' },
                },
            },
            animation: {
                blink: 'tuiBlink 1.2s infinite',
                disco: 'discoCycle 2s linear infinite',
            },
        },
    },
};
