// src/tui/agenda/StickerImage.jsx
import { pngDataUrl, SMALL_SIZE, STICKER_SIZE } from "../../utils/agendaPixelFormat";

// A library image at one CSS pixel per art pixel, in a block of whole cells:
// "groot" is 9ch x 4lh (about 64px square in the grid font), "klein" is 2ch x 1lh.
// The picture sits top-left in its block; the small one may run a pixel or two into
// the next column, which is always a gap.
const SIZES = {
    groot: { block: "w-[9ch] h-[4lh]", px: STICKER_SIZE, key: "png" },
    klein: { block: "w-[2ch] h-[1lh]", px: SMALL_SIZE, key: "pngSmall" },
};

export default function StickerImage({ sticker, size = "groot", className = "" }) {
    const { block, px, key } = SIZES[size];
    return (
        <span aria-hidden="true" className={`inline-block shrink-0 align-top select-none ${block} ${className}`}>
            {sticker?.[key] && (
                <img
                    src={pngDataUrl(sticker[key])}
                    alt=""
                    width={px}
                    height={px}
                    draggable={false}
                    className="block max-w-none"
                    style={{ width: px, height: px, imageRendering: "pixelated" }}
                />
            )}
        </span>
    );
}
