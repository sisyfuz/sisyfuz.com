// scripts/seo/prerender.mjs
// Runs after `vite build`. Writes dist/<route>/index.html (copies of the SPA shell
// with route-specific <title>, description, canonical, Open Graph and Twitter tags)
// for every static route and every Sanity work project.
// GitHub Pages then answers those URLs with HTTP 200 instead of going through 404.html.
//
// Set SEO_SKIP_SANITY=1 to skip the network fetch (static routes only).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    ROUTES,
    fetchProjects,
    injectHead,
    outputFileFor,
    projectsToPages,
} from "./lib.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distDir = path.join(rootDir, "dist");

const warn = (msg) => console.warn(`[seo] warning: ${msg}`);

async function main() {
    const template = await readFile(path.join(distDir, "index.html"), "utf8");

    const projects = process.env.SEO_SKIP_SANITY ? [] : await fetchProjects({ warn });
    const projectPages = projectsToPages(projects, warn);
    const pages = [...ROUTES, ...projectPages];

    for (const page of pages) {
        const file = path.join(distDir, outputFileFor(page.path));
        if (!file.startsWith(distDir + path.sep)) throw new Error(`refusing to write outside dist/: ${file}`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, injectHead(template, page));
    }

    console.log(`[seo] wrote ${ROUTES.length} route pages, ${projectPages.length} project pages`);
}

main().catch((err) => {
    console.error(`[seo] ${err?.stack ?? err}`);
    process.exit(1);
});
