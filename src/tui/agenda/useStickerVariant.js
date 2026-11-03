// src/tui/agenda/useStickerVariant.js
import { useEffect, useState } from "react";
import { base64PngToPixels, pixelsToBase64Png, pngDataUrl, STICKER_SIZE } from "../../utils/agendaPixelFormat";
import { transformPixels } from "../../utils/agendaTransform";

// A sticker resized and turned on the same pixel grid (agendaTransform.js), as a
// data URL plus its size in pixels. Each picture, size and angle is worked out
// once per page and remembered; until it's ready the hook gives null.
const cache = new Map();

function variant(sticker, scale, rot) {
    const key = `${sticker.id}|${sticker.updatedAt}|${scale}|${rot}`;
    if (!cache.has(key)) {
        cache.set(
            key,
            base64PngToPixels(sticker.png, STICKER_SIZE).then((pixels) => {
                const out = transformPixels(pixels, { scale, rot });
                return { src: pngDataUrl(pixelsToBase64Png(out)), px: out.size };
            })
        );
    }
    return cache.get(key);
}

export default function useStickerVariant(sticker, scale = 1, rot = 0) {
    const plain = !sticker?.png || (scale === 1 && rot % 360 === 0);
    const [ready, setReady] = useState(null);

    useEffect(() => {
        if (plain) return undefined;
        let live = true;
        variant(sticker, scale, rot).then(
            (v) => live && setReady({ key: `${sticker.id}|${sticker.updatedAt}|${scale}|${rot}`, ...v }),
            () => {}
        );
        return () => {
            live = false;
        };
    }, [plain, sticker, scale, rot]);

    if (plain || !ready || ready.key !== `${sticker.id}|${sticker.updatedAt}|${scale}|${rot}`) return null;
    return ready;
}
