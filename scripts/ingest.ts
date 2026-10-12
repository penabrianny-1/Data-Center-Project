/**
 * Run source adapters and write results into data/intel.db.
 *
 *   npm run ingest                    # all adapters
 *   npm run ingest -- curated fec-bulk  # selected adapters (dependencies are read from the DB)
 *   npm run ingest -- --due             # only adapters whose refreshMinutes have elapsed (used by the scheduler)
 *
 * A lock file (data/.ingest.lock) prevents overlapping runs.
 * Each adapter runs independently: a failure is recorded in the source
 * registry and previously ingested records are kept (and shown as stale).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "../lib/adapters";
import { applyResult, openDb, registerAdapter } from "../lib/db";
import { politeFetch, redact } from "../lib/ingest/http";
import type { Entity, EntityKind } from "../lib/ingest/types";

async function main() {
  const selected = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const unknown = selected.filter((s) => !ADAPTERS.some((a) => a.id === s));
  if (unknown.length) {
    console.error(`Unknown adapter(s): ${unknown.join(", ")}. Available: ${ADAPTERS.map((a) => a.id).join(", ")}`);
    process.exit(1);
  }
  const due = process.argv.includes("--due");
  if (!acquireLock()) {
    console.log("Another ingest run is in progress; exiting.");
    process.exit(0);
  }
  process.on("exit", releaseLock);

  const db = openDb();
  const lastSuccess = new Map(
    (db.prepare("SELECT id, last_success FROM adapters").all() as { id: string; last_success: string | null }[]).map((r) => [r.id, r.last_success]),
  );
  const isDue = (id: string, minutes: number) => {
    const last = lastSuccess.get(id);
    return !last || Date.now() - Date.parse(last) >= minutes * 60_000 - 60_000;
  };
  const lookup = (kind: EntityKind): Entity[] =>
    (db.prepare("SELECT data FROM entities WHERE kind = ?").all(kind) as { data: string }[]).map((r) => JSON.parse(r.data));

  let failures = 0;
  let ran = 0;
  for (const adapter of ADAPTERS) {
    registerAdapter(db, adapter);
    if (selected.length && !selected.includes(adapter.id)) continue;
    // In --due mode the resolver runs whenever anything else ran.
    if (due && adapter.id !== "resolver" && !isDue(adapter.id, adapter.refreshMinutes)) continue;
    if (due && adapter.id === "resolver" && ran === 0) continue;
    ran++;

    const runId = randomUUID();
    const started = new Date().toISOString();
    db.prepare("UPDATE adapters SET last_attempt = ? WHERE id = ?").run(started, adapter.id);

    if (adapter.requiresEnv && !process.env[adapter.requiresEnv]) {
      const msg = `Skipped: ${adapter.requiresEnv} not set`;
      db.prepare("UPDATE adapters SET last_status = 'not_configured', last_error = ? WHERE id = ?").run(msg, adapter.id);
      db.prepare("INSERT INTO runs (id, adapter, started, finished, status, error) VALUES (?, ?, ?, ?, 'not_configured', ?)").run(
        runId, adapter.id, started, new Date().toISOString(), msg,
      );
      console.log(`- ${adapter.id}: ${msg}`);
      continue;
    }

    process.stdout.write(`• ${adapter.id} … `);
    const t0 = Date.now();
    try {
      const result = await adapter.run({
        fetch: politeFetch,
        log: (m) => process.stdout.write(`\n    ${m}`),
        env: process.env,
        lookup,
      });
      const stats = applyResult(db, adapter.id, runId, result, undefined, { appendOnly: adapter.appendOnly });
      const count = (db.prepare("SELECT COUNT(*) AS n FROM entities WHERE adapter = ?").get(adapter.id) as { n: number }).n;
      const obs = (db.prepare("SELECT COUNT(*) AS n FROM observations WHERE adapter = ?").get(adapter.id) as { n: number }).n;
      const warnings = result.warnings ?? [];
      db.prepare(
        "UPDATE adapters SET last_success = ?, last_status = ?, last_error = NULL, record_count = ?, warnings = ? WHERE id = ?",
      ).run(new Date().toISOString(), warnings.length ? "ok_with_warnings" : "ok", count + obs, JSON.stringify(warnings), adapter.id);
      db.prepare(
        "INSERT INTO runs (id, adapter, started, finished, status, added, updated, removed) VALUES (?, ?, ?, ?, 'ok', ?, ?, ?)",
      ).run(runId, adapter.id, started, new Date().toISOString(), stats.added, stats.updated, stats.removed);
      console.log(
        `\n  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s  +${stats.added} ~${stats.updated} -${stats.removed} =${stats.unchanged}` +
          (obs ? `  (${obs} observations)` : "") +
          (warnings.length ? `  ⚠ ${warnings.length} warning(s)` : ""),
      );
      for (const w of warnings.slice(0, 8)) console.log(`    ⚠ ${w}`);
      if (warnings.length > 8) console.log(`    … ${warnings.length - 8} more (see Sources page)`);
    } catch (err) {
      failures++;
      const msg = redact((err as Error).message);
      db.prepare("UPDATE adapters SET last_status = 'error', last_error = ? WHERE id = ?").run(msg, adapter.id);
      db.prepare("INSERT INTO runs (id, adapter, started, finished, status, error) VALUES (?, ?, ?, ?, 'error', ?)").run(
        runId, adapter.id, started, new Date().toISOString(), msg,
      );
      console.log(`\n  ✗ ${msg} (previous data kept)`);
    }
  }
  db.close();
  process.exit(failures ? 2 : 0);
}

const LOCK = join(process.cwd(), "data", ".ingest.lock");
/** Stale after 30 minutes (a crashed run must not block refreshes forever). */
function acquireLock(): boolean {
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 30 * 60_000) {
    const pid = Number(readFileSync(LOCK, "utf8"));
    try {
      process.kill(pid, 0);
      return false; // holder still alive
    } catch {
      // holder died; take over
    }
  }
  writeFileSync(LOCK, String(process.pid));
  return true;
}
function releaseLock() {
  try {
    if (existsSync(LOCK) && readFileSync(LOCK, "utf8") === String(process.pid)) rmSync(LOCK);
  } catch {
    // ignore
  }
}

main();
