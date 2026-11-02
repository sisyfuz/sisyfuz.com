#!/usr/bin/env node
// scripts/agenda-admin.mjs
// Admin commands for the private agenda (worker/src/agenda.js).
//
//   npm run agenda:admin -- status               who has a password (never the password)
//   npm run agenda:admin -- reset partner        first-time setup or "forgot password":
//                                                wipes their password, logs them out
//                                                everywhere and prints a one-time code
//   npm run agenda:admin -- init-key             makes AGENDA_ADMIN_KEY, saves it in
//                                                .env.local and uploads it with wrangler
//
// Add --local to talk to `npm run dev:agenda` (http://localhost:8787, key in
// worker/.dev.vars) instead of the live worker (key in .env.local).

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [command, person] = args.filter((a) => !a.startsWith("--"));
const local = flags.has("--local");
const keyFile = path.join(rootDir, local ? "worker/.dev.vars" : ".env.local");
const baseUrl = local ? "http://localhost:8787" : process.env.AGENDA_API || "https://sisyfuz-counter.sisyfuz.workers.dev";

const fail = (msg) => {
    console.error(`\n  ${msg}\n`);
    process.exit(1);
};

async function readVars(file) {
    const text = await readFile(file, "utf8").catch(() => "");
    return Object.fromEntries(
        text
            .split(/\r?\n/)
            .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
            .filter(Boolean)
            .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
    );
}

async function adminKey() {
    const key = process.env.AGENDA_ADMIN_KEY || (await readVars(keyFile)).AGENDA_ADMIN_KEY;
    if (!key) fail(`AGENDA_ADMIN_KEY ontbreekt in ${path.relative(rootDir, keyFile)}. Draai eerst: npm run agenda:admin -- init-key${local ? " --local" : ""}`);
    return key;
}

async function call(route, { method = "GET", body } = {}) {
    let res;
    try {
        res = await fetch(`${baseUrl}${route}`, {
            method,
            headers: { Authorization: `Bearer ${await adminKey()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch {
        fail(`Kon ${baseUrl} niet bereiken.${local ? " Draait npm run dev:agenda?" : ""}`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) fail("De admin key klopt niet met de key in de worker.");
    if (res.status === 503) fail("De worker heeft (nog) geen AGENDA_ADMIN_KEY, of de agenda is niet ingesteld.");
    if (!res.ok) fail(data.error || `Fout ${res.status}`);
    return data;
}

const when = (ms) =>
    new Date(ms).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const PASSWORD_LABELS = {
    eigen: "eigen wachtwoord (alleen als hash opgeslagen)",
    vast: "vast wachtwoord uit een worker-secret",
    geen: "nog geen wachtwoord",
};

async function status() {
    const { people } = await call("/agenda/admin/status");
    console.log("");
    for (const p of people) {
        const code = p.codeExpiresAt ? ` · open code tot ${when(p.codeExpiresAt)}` : "";
        console.log(`  ${p.name.padEnd(6)} ${PASSWORD_LABELS[p.password] ?? p.password}${code}`);
    }
    console.log("");
}

async function confirm(question) {
    if (flags.has("--yes") || !process.stdin.isTTY) return true;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(question);
    rl.close();
    return /^(j|ja|y|yes)$/i.test(answer.trim());
}

async function reset() {
    if (!person) fail("Voor wie? Bijvoorbeeld: npm run agenda:admin -- reset partner");
    const id = person.toLowerCase();
    const ok = await confirm(
        `\n  Het huidige wachtwoord van ${id.toUpperCase()} werkt hierna niet meer en ${id.toUpperCase()} wordt overal uitgelogd. Doorgaan? (j/n) `
    );
    if (!ok) fail("Niets veranderd.");
    const { name, code, expiresAt } = await call("/agenda/admin/reset", { method: "POST", body: { person: id } });
    console.log(`
  Eenmalige code voor ${name} (geldig tot ${when(expiresAt)}):

      ${code}

  Geef deze code aan ${name}. Op sisyfuz.com/agenda: tik [EERSTE KEER / CODE],
  vul de code in en kies een eigen wachtwoord. Alleen een hash daarvan wordt
  bewaard, dus niemand anders kan het zien. Na gebruik is de code verbruikt.
`);
}

async function initKey() {
    const existing = (await readVars(keyFile)).AGENDA_ADMIN_KEY;
    if (existing && !flags.has("--force")) {
        fail(`${path.relative(rootDir, keyFile)} heeft al een AGENDA_ADMIN_KEY. Gebruik --force om een nieuwe te maken.`);
    }
    const key = randomBytes(32).toString("hex");
    const text = await readFile(keyFile, "utf8").catch(() => "");
    const line = `AGENDA_ADMIN_KEY=${key}`;
    const next = /^AGENDA_ADMIN_KEY=.*$/m.test(text)
        ? text.replace(/^AGENDA_ADMIN_KEY=.*$/m, line)
        : `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n# Admin key for scripts/agenda-admin.mjs (same value as the worker secret)\n${line}\n`;
    await writeFile(keyFile, next, { mode: 0o600 });
    console.log(`\n  Nieuwe admin key opgeslagen in ${path.relative(rootDir, keyFile)}.`);

    if (local) {
        console.log("  Herstart npm run dev:agenda zodat de lokale worker hem leest.\n");
        return;
    }
    if (flags.has("--no-upload")) {
        console.log("  Zet hem zelf in de worker: cd worker && npx wrangler secret put AGENDA_ADMIN_KEY\n");
        return;
    }
    console.log("  Uploaden naar de worker met wrangler...\n");
    const child = spawn("npx", ["wrangler", "secret", "put", "AGENDA_ADMIN_KEY"], {
        cwd: path.join(rootDir, "worker"),
        stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.end(key);
    child.on("exit", (code) => process.exit(code ?? 1));
}

const commands = { status, reset, "init-key": initKey };
if (!commands[command]) {
    console.log(`
  Gebruik:
    npm run agenda:admin -- status
    npm run agenda:admin -- reset <dorus|partner>
    npm run agenda:admin -- init-key [--force] [--no-upload]

  Voeg --local toe voor de lokale worker (npm run dev:agenda).
`);
    process.exit(command ? 1 : 0);
}
await commands[command]();
