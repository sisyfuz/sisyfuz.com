// src/utils/ascii.js

// String.raw keeps the figlet backslashes (a plain template literal swallows them)
export const SISYFUZ_BANNER = String.raw`
  ____ ___ ______   _______ _   _ _____ 
 / ___|_ _/ ___\ \ / /  ___| | | |__  / 
 \___ \| |\___ \\ V /| |_  | | | | / /  
  ___) | | ___) || | |  _| | |_| |/ /_  
 |____/___|____/ |_| |_|    \___//____| 
`;

export const ASCII_RAMP = "@%#*+=-:. ";
export const ASCII_DIVIDER = "--------------------------------------------------------------------------------";

export function box(title = "", content = [], width = 72) {
    const topTitle = title ? `[ ${title} ]` : "";
    const topDashes = Math.max(0, width - topTitle.length - 3);
    const top = `+--${topTitle}${"-".repeat(topDashes)}+`;
    const bottom = `+${"-".repeat(width)}+`;

    const lines = content.map(line => {
        const text = String(line);
        if (text.length > width - 2) {
            return `| ${text.slice(0, width - 4)}.. |`;
        }
        return `| ${text.padEnd(width - 2)} |`;
    });

    return [top, ...lines, bottom].join("\n");
}
