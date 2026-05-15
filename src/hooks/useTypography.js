// src/hooks/useTypography.js
import { useEffect } from 'react';
import { client } from '../sanityClient';

// Maps display name → Google Fonts family param
const FONT_MAP = {
    'Space Grotesk':      'Space+Grotesk:wght@400;500;700',
    'Syne':               'Syne:wght@400;700;800',
    'DM Serif Display':   'DM+Serif+Display',
    'Playfair Display':   'Playfair+Display:wght@400;700;900',
    'Bebas Neue':         'Bebas+Neue',
    'Inter':              'Inter:wght@400;500;700',
    'IBM Plex Mono':      'IBM+Plex+Mono:wght@400;500;700',
    'Space Mono':         'Space+Mono:wght@400;700',
    'DM Sans':            'DM+Sans:wght@400;500;700',
    'Lato':               'Lato:wght@400;700',
    'Source Sans 3':      'Source+Sans+3:wght@400;600;700',
    'Fira Code':          'Fira+Code:wght@400;500;700',
    'JetBrains Mono':     'JetBrains+Mono:wght@400;500;700',
};

export function useTypography() {
    useEffect(() => {
        client
            .fetch(`*[_type == "siteTypography" && _id == "siteTypography"][0]`)
            .then(data => {
                if (!data) return;

                const { titleFont, bodyFont, monoFont } = data;

                // Collect unique fonts that have a mapping
                const families = [...new Set([titleFont, bodyFont, monoFont])]
                    .filter(Boolean)
                    .map(f => FONT_MAP[f])
                    .filter(Boolean);

                if (families.length) {
                    const existing = document.getElementById('sanity-typography-fonts');
                    if (existing) existing.remove();

                    const link = document.createElement('link');
                    link.id = 'sanity-typography-fonts';
                    link.rel = 'stylesheet';
                    link.href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}`).join('&')}&display=swap`;
                    document.head.appendChild(link);
                }

                // Set CSS variables on :root
                const root = document.documentElement;
                if (titleFont) root.style.setProperty('--font-title', `"${titleFont}", sans-serif`);
                if (bodyFont)  root.style.setProperty('--font-body',  `"${bodyFont}", sans-serif`);
                if (monoFont)  root.style.setProperty('--font-mono',  `"${monoFont}", monospace`);
            });
    }, []);
}
