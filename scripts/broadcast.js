#!/usr/bin/env node

/**
 * broadcast.js
 *
 * Automated TouchDesigner live stream broadcaster for sisyfuz.com:
 * 1. Verifies TouchDesigner is running on port 9980.
 * 2. Starts a secure Cloudflare Tunnel.
 * 3. Extracts the public WSS URL.
 * 4. Publishes the URL to sisyfuz.com via Cloudflare Worker.
 * 5. On Ctrl+C, unpublishes the stream cleanly and returns site to standby.
 */

import { spawn } from "child_process";
import http from "http";

const LOCAL_PORT = 9980;
const WORKER_LIVE_URL = "https://sisyfuz-counter.sisyfuz.workers.dev/live";

console.log("\n==============================================================");
console.log("   SISYFUZ // TOUCHDESIGNER REAL-TIME LIVE BROADCASTER        ");
console.log("==============================================================\n");

// 1. Verify TouchDesigner is listening on port 9980
function checkLocalServer() {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${LOCAL_PORT}`, () => {
            resolve(true);
        });
        req.on("error", () => {
            resolve(false);
        });
        req.setTimeout(1500, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// 2. Publish/Unpublish status to worker
async function setLiveState(url, active) {
    try {
        const res = await fetch(WORKER_LIVE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url || "", active: Boolean(active) }),
        });
        if (!res.ok) {
            console.warn(`[WARN] Cloudflare Worker returned status ${res.status}`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn(`[WARN] Failed to notify Cloudflare Worker: ${err.message}`);
        return false;
    }
}

async function main() {
    console.log(`[1/3] Checking TouchDesigner on port ${LOCAL_PORT}...`);
    const isRunning = await checkLocalServer();

    if (!isRunning) {
        console.log(`\n[!] NOTICE: TouchDesigner does not appear to be listening on port ${LOCAL_PORT} yet.`);
        console.log("    Please make sure TouchDesigner is running with:");
        console.log("    - 'webserver1' (Web Server DAT) Active: On");
        console.log("    - Port: 9980\n");
        console.log("    Starting tunnel anyway so you're ready when TouchDesigner starts...\n");
    } else {
        console.log(`[OK] TouchDesigner is active and ready on port ${LOCAL_PORT}!\n`);
    }

    console.log("[2/3] Launching secure Cloudflare Tunnel...");

    const cf = spawn("npx", ["--yes", "cloudflared", "tunnel", "--url", `http://localhost:${LOCAL_PORT}`], {
        stdio: ["ignore", "pipe", "pipe"],
    });

    let liveUrl = null;
    let isShuttingDown = false;

    const handleOutput = async (data) => {
        const text = data.toString();
        // Look for *.trycloudflare.com in logs
        const match = text.match(/https:\/\/([a-zA-Z0-9\-]+\.trycloudflare\.com)/);
        if (match && !liveUrl && !isShuttingDown) {
            const domain = match[1];
            liveUrl = `wss://${domain}`;

            console.log("\n[3/3] TUNNEL ESTABLISHED!");
            console.log(`      Public WSS: ${liveUrl}`);
            console.log(`      Notifying sisyfuz.com...`);

            const published = await setLiveState(liveUrl, true);
            if (published) {
                console.log(`      [OK] Successfully published to sisyfuz.com/live!\n`);
            }

            console.log("==============================================================");
            console.log("  ● YOU ARE CURRENTLY BROADCASTING LIVE TO THE WORLD!");
            console.log("");
            console.log(`  Live URL:      https://sisyfuz.com/live`);
            console.log(`  Direct Stream: ${liveUrl}`);
            console.log("");
            console.log("  Every visitor to sisyfuz.com/live now sees your 1280x1280 TOP!");
            console.log("  Press Ctrl+C at any time to stop broadcasting.");
            console.log("==============================================================\n");
        }
    };

    cf.stdout.on("data", handleOutput);
    cf.stderr.on("data", handleOutput);

    const cleanup = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log("\n[!] Stopping broadcast...");

        try {
            cf.kill("SIGINT");
        } catch {}

        console.log("    Returning sisyfuz.com/live to standby state...");
        await setLiveState("", false);

        console.log("    [OK] Stream ended. Goodbye!\n");
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    cf.on("close", async (code) => {
        if (!isShuttingDown) {
            console.log(`\n[!] Cloudflare tunnel closed with code ${code}.`);
            await setLiveState("", false);
            process.exit(0);
        }
    });
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
