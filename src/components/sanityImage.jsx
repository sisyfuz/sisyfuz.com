// src/components/sanityImage.jsx
import { createImageUrlBuilder } from '@sanity/image-url';
import { client } from '../sanityClient';

const builder = createImageUrlBuilder(client);

export function urlFor(source) {
    return builder.image(source);
}

/**
 * Responsive Sanity image URL builder with automatic WebP/AVIF formatting
 * and width bounding to eliminate 4K image over-fetching on ASCII previews.
 */
export function getOptimizedImageUrl(source, baseWidth = 800) {
    if (!source) return "";

    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    // Bound responsive width: 800 for 1x, 1200 for 2x/3x retina
    const targetWidth = dpr > 1 ? Math.min(1200, Math.round(baseWidth * 1.5)) : baseWidth;

    if (typeof source === "string") {
        if (source.includes("cdn.sanity.io")) {
            try {
                return builder.image(source).auto("format").quality(80).width(targetWidth).url();
            } catch {
                const sep = source.includes("?") ? "&" : "?";
                return `${source}${sep}auto=format&q=80&w=${targetWidth}`;
            }
        }
        return source;
    }

    try {
        const url = builder.image(source).auto("format").quality(80).width(targetWidth).url();
        return url || "";
    } catch {
        return "";
    }
}