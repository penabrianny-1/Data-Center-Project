import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const TICK_MS = 10 * 60_000;
const LOG = join(process.cwd(), "data", "ingest.log");

let started = false;
let running = false;

function runDue() {
  if (running) return;
  running = true;
  const t0 = new Date().toISOString();
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=6144", "--env-file-if-exists=.env.local", "--import", "tsx", "scripts/ingest.ts", "--due"],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("close", (code) => {
    running = false;
    try {
      appendFileSync(LOG, `\n=== ${t0} scheduled refresh (exit ${code}) ===\n${out.trim()}\n`);
    } catch {
      // logging is best-effort
    }
  });
}

/** Start the in-process refresh loop (idempotent). */
export function startScheduler() {
  if (started) return;
  started = true;
  // First check shortly after boot, then every 10 minutes.
  setTimeout(runDue, 15_000).unref();
  setInterval(runDue, TICK_MS).unref();
  console.log("[scheduler] auto-refresh enabled: checking sources every 10 min (AUTO_REFRESH=0 to disable)");
}
