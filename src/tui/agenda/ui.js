// src/tui/agenda/ui.js
// Shared class names for the agenda. Everything sits on the site's terminal grid:
// no CSS borders or outlines, text in the grid font, blocks of whole cells.
// Touch targets are 3 rows tall with their text on the middle row; fields are a
// darker block instead of a box (the agenda page stops iOS from zooming in).

export const BTN =
    "font-mono uppercase cursor-pointer select-none transition-none min-h-[3lh] px-[1ch] inline-flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:bg-white focus-visible:text-black";

export const BTN_PLAIN = `${BTN} text-neutral-300 hover:bg-white hover:text-black`;
export const BTN_ACTIVE = `${BTN} bg-white text-black font-bold`;
export const BTN_PRIMARY = `${BTN} text-white font-bold hover:bg-white hover:text-black`;
export const BTN_GREEN = `${BTN} text-[#00ff66] hover:bg-[#00ff66] hover:text-black`;
export const BTN_RED = `${BTN} text-[#ff4d4d] hover:bg-[#ff4d4d] hover:text-black`;
export const BTN_ATTENTION = `${BTN} text-[#f7e463] hover:bg-[#f7e463] hover:text-black`;
export const BTN_GREEN_ON = `${BTN} bg-[#00ff66] text-black font-bold`;
export const BTN_RED_ON = `${BTN} bg-[#ff4d4d] text-black font-bold`;

const FIELD_BASE =
    "w-full bg-[#141414] focus:bg-[#262626] text-white border-0 outline-none rounded-none px-[1ch] py-0 font-mono [color-scheme:dark] appearance-none";
export const FIELD = `${FIELD_BASE} h-[3lh]`;
// Fixed rows (no drag handle) so its height stays whole lines.
export const TEXTAREA = `${FIELD_BASE} h-[6lh] resize-none`;

export const LABEL = "block uppercase text-neutral-500";

export const SAMEN_COLOR = "#00ff66";

// Rows the bottom bar takes while the sticker tray is open (rule, buttons, stickers).
export const TRAY_ROWS = 9;
