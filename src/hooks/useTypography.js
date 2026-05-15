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

// Maps file extension → CSS format() hint
const FORMAT_MAP = {
    woff2: 'woff2',
    woff:  'woff',
    ttf:   'truetype',
    otf:   'opentype',
};

function getFormat(url) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    return FORMAT_MAP[ext] || 'opentype';
}

function injectCustomFontFace(familyName, url) {
    // Don't remove/re-inject if already present — avoids re-download on re-renders
    const existing = document.getElementById(`sanity-custom-font-${familyName}`);
    if (existing) return;

    const format = getFormat(url);

    const style = document.createElement('style');
    style.id = `sanity-custom-font-${familyName}`;
    style.textContent = `@font-face {
        font-family: "${familyName}";
        src: url("${url}") format("${format}");
        font-display: swap;
    }`;
    document.head.appendChild(style);
}

export function useTypography() {
    useEffect(() => {
        client
            .fetch(`*[_type == "siteTypography" && _id == "siteTypography"][0]{
                titleFont,
                bodyFont,
                monoFont,
                titleFontFile { asset->{ url } },
                bodyFontFile  { asset->{ url } },
                monoFontFile  { asset->{ url } }
            }`)
            .then(data => {
                if (!data) return;

                const { titleFont, bodyFont, monoFont,
                    titleFontFile, bodyFontFile, monoFontFile } = data;

                const root = document.documentElement;

                const roles = [
                    { file: titleFontFile, preset: titleFont, cssVar: '--font-title', name: 'SanityTitleFont', fallback: 'sans-serif' },
                    { file: bodyFontFile,  preset: bodyFont,  cssVar: '--font-body',  name: 'SanityBodyFont',  fallback: 'sans-serif' },
                    { file: monoFontFile,  preset: monoFont,  cssVar: '--font-mono',  name: 'SanityMonoFont',  fallback: 'monospace'  },
                ];

                const googleFamilies = [];

                for (const { file, preset, cssVar, name, fallback } of roles) {
                    const fileUrl = file?.asset?.url;
                    if (fileUrl) {
                        injectCustomFontFace(name, fileUrl);
                        root.style.setProperty(cssVar, `"${name}", ${fallback}`);
                    } else if (preset) {
                        if (FONT_MAP[preset]) googleFamilies.push(FONT_MAP[preset]);
                        root.style.setProperty(cssVar, `"${preset}", ${fallback}`);
                    }
                }

                // Load all Google Fonts presets in a single request
                if (googleFamilies.length) {
                    const existing = document.getElementById('sanity-typography-fonts');
                    if (existing) return;

                    const link = document.createElement('link');
                    link.id = 'sanity-typography-fonts';
                    link.rel = 'stylesheet';
                    link.href = `https://fonts.googleapis.com/css2?${[...new Set(googleFamilies)].map(f => `family=${f}`).join('&')}&display=swap`;
                    document.head.appendChild(link);
                }
            });
    }, []);
}