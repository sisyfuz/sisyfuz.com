// src/tui/agenda/ui.js
// Shared class names for the agenda. Touch targets are 3 rows (48px) tall to stay
// on the terminal grid; form fields use 16px text so iOS Safari does not zoom in.

export const BTN =
    "font-mono uppercase cursor-pointer select-none transition-none min-h-[3lh] px-[1ch] inline-flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed";

export const BTN_PLAIN = `${BTN} text-neutral-300 hover:bg-white hover:text-black`;
export const BTN_ACTIVE = `${BTN} bg-white text-black font-bold`;
export const BTN_PRIMARY = `${BTN} text-white font-bold hover:bg-white hover:text-black`;
export const BTN_GREEN = `${BTN} text-[#00ff66] hover:bg-[#00ff66] hover:text-black`;
export const BTN_RED = `${BTN} text-[#ff4d4d] hover:bg-[#ff4d4d] hover:text-black`;
export const BTN_ATTENTION = `${BTN} text-[#f7e463] hover:bg-[#f7e463] hover:text-black`;
export const BTN_GREEN_ON = `${BTN} bg-[#00ff66] text-black font-bold`;
export const BTN_RED_ON = `${BTN} bg-[#ff4d4d] text-black font-bold`;

const FIELD_BASE =
    "w-full bg-black text-white border border-[#333] focus:border-white outline-none rounded-none px-[1ch] text-[16px] font-mono [color-scheme:dark] appearance-none";
export const FIELD = `${FIELD_BASE} h-[3lh] py-0`;
export const TEXTAREA = `${FIELD_BASE} min-h-[6lh] py-[0.5lh] resize-y`;

export const LABEL = "block uppercase text-neutral-500";

export const SAMEN_COLOR = "#00ff66";
