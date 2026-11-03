// src/tui/agenda/StickerImage.jsx
import { pngDataUrl, SMALL_SIZE, STICKER_SIZE } from "../../utils/agendaPixelFormat";
import useStickerVariant from "./useStickerVariant";

// A library image at one CSS pixel per art pixel, in a block of whole cells:
// "groot" is 9ch x 4lh (about 64px square in the grid font), "klein" is 2ch x 1lh.
// The picture sits top-left in its block; the small one may run a pixel or two into
// the next column, which is always a gap. A stuck sticker can have a `scale` and a
// `rot`: it is then drawn again on the same pixel grid (useStickerVariant) and
// centred on the block, which keeps its place and size in the layout.
const SIZES = {
    groot: { block: "w-[9ch] h-[4lh]", px: STICKER_SIZE, key: "png" },
    klein: { block: "w-[2ch] h-[1lh]", px: SMALL_SIZE, key: "pngSmall" },
};

export default function StickerImage({ sticker, size = "groot", scale = 1, rot = 0, className = "" }) {
    const { block, px, key } = SIZES[size];
    const turned = useStickerVariant(size === "groot" ? sticker : null, scale, rot);
    const src = turned?.src ?? (sticker?.[key] ? pngDataUrl(sticker[key]) : null);
    const shown = turned?.px ?? px;
    // Until the redrawn picture is ready, the plain one stands in at about the new size.
    const stretch = !turned && size === "groot" && scale !== 1 ? scale : 1;
    const offset = Math.round((px - shown * stretch) / 2);
    return (
        <span aria-hidden="true" className={`relative inline-block shrink-0 align-top select-none ${block} ${className}`}>
            {src && (
                <img
                    src={src}
                    alt=""
                    width={shown}
                    height={shown}
                    draggable={false}
                    className="absolute block max-w-none"
                    style={{ left: offset, top: offset, width: shown * stretch, height: shown * stretch, imageRendering: "pixelated" }}
                />
            )}
        </span>
    );
}
