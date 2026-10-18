// src/components/sanityImage.jsx
import { createImageUrlBuilder } from '@sanity/image-url';
import { client } from '../sanityClient';

const builder = createImageUrlBuilder(client);

export function urlFor(source) {
    return builder.image(source);
}

/**
 * Responsive Sanity image URL builder with automatic modern WebP/AVIF formatting,
 * fit=max boundary, and width bounding to eliminate 4K image over-fetching.
 */
export function getOptimizedImageUrl(source, baseWidth = 800) {
    if (!source) return "";

    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    // Bound responsive width: 800 for 1x, 1200 for 2x/3x retina
    const targetWidth = dpr > 1 ? Math.min(1200, Math.round(baseWidth * 1.5)) : baseWidth;

    if (typeof source === "string") {
        if (source.includes("cdn.sanity.io")) {
            try {
                return builder.image(source).auto("format").fit("max").quality(80).width(targetWidth).url();
            } catch {
                const sep = source.includes("?") ? "&" : "?";
                return `${source}${sep}auto=format&fit=max&q=80&w=${targetWidth}`;
            }
        }
        return source;
    }

    try {
        const url = builder.image(source).auto("format").fit("max").quality(80).width(targetWidth).url();
        return url || "";
    } catch {
        return "";
    }
}

/**
 * High-performance, lazy-loaded accessible Sanity Image component
 */
export function SanityImage({
    source,
    alt = "",
    baseWidth = 800,
    className = "",
    loading = "lazy",
    decoding = "async",
    ...props
}) {
    const optimizedSrc = getOptimizedImageUrl(source, baseWidth);
    if (!optimizedSrc) return null;

    return (
        <img
            src={optimizedSrc}
            alt={alt}
            loading={loading}
            decoding={decoding}
            className={`block max-w-full h-auto ${className}`}
            {...props}
        />
    );
}

export default SanityImage;