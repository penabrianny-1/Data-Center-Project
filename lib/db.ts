/**
 * SQLite intelligence store (node:sqlite, built into Node ≥ 22).
 *
 * Model:
 *   entities         one row per normalized record (bill, race, docket, …) with
 *                    filter columns + full JSON payload; stable ids
 *   sources          deduplicated source documents (by URL)
 *   entity_sources   which sources support which entity
 *   relations        typed edges between entities (candidate_in, member_of, …)
 *   history          prior versions of entities whose content changed
 *   changes          append-only audit feed: added / updated / removed
 *   observations     time series (gas prices, …)
 *   adapters, runs   source registry + freshness / error tracking
 *   entities_fts     full-text search
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Adapter, AdapterResult } from "./ingest/types";

export const DB_PATH = process.env.INTEL_DB_PATH ?? join(process.cwd(), "data", "intel.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT,
  county TEXT,
  title TEXT NOT NULL,
  date TEXT,
  status TEXT,
  confidence TEXT,
  verified_at TEXT,
  adapter TEXT NOT NULL,
  hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entities_kind_state ON entities(kind, state);
CREATE INDEX IF NOT EXISTS entities_kind_date ON entities(kind, date);
CREATE INDEX IF NOT EXISTS entities_county ON entities(county);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  kind TEXT,
  published TEXT,
  doc_id TEXT
);
CREATE TABLE IF NOT EXISTS entity_sources (
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  excerpt TEXT,
  PRIMARY KEY (entity_id, source_id)
);
CREATE TABLE IF NOT EXISTS relations (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  type TEXT NOT NULL,
  adapter TEXT NOT NULL,
  data TEXT,
  PRIMARY KEY (src, dst, type)
);
CREATE INDEX IF NOT EXISTS relations_dst ON relations(dst, type);

CREATE TABLE IF NOT EXISTS history (
  entity_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_entity ON history(entity_id);

CREATE TABLE IF NOT EXISTS changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT,
  title TEXT,
  change TEXT NOT NULL CHECK (change IN ('added', 'updated', 'removed')),
  fields TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_at ON changes(at);

CREATE TABLE IF NOT EXISTS observations (
  series TEXT NOT NULL,
  area TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  adapter TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (series, area, date)
);

CREATE TABLE IF NOT EXISTS adapters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  method TEXT NOT NULL,
  schedule TEXT NOT NULL,
  coverage TEXT NOT NULL,
  requires_env TEXT,
  last_attempt TEXT,
  last_success TEXT,
  last_status TEXT,
  last_error TEXT,
  record_count INTEGER DEFAULT 0,
  warnings TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  started TEXT NOT NULL,
  finished TEXT,
  status TEXT NOT NULL,
  added INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  removed INTEGER DEFAULT 0,
  error TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(id UNINDEXED, kind UNINDEXED, title, body, tokenize = 'porter unicode61');
`;

export function openDb(path = DB_PATH, { readonly = false } = {}): DatabaseSync {
  if (!readonly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly: readonly });
  if (!readonly) {
    // Rollback journal (not WAL): the app holds long-lived read-only connections,
    // and WAL checkpoints under a read-only reader can surface as "malformed".
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Writing (ingestion)

export function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Stable JSON (sorted keys) so content hashes don't change with key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Top-level keys whose values differ between two payloads. */
export function changedFields(a: unknown, b: unknown): string[] {
  const ao = (a ?? {}) as Record<string, unknown>;
  const bo = (b ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  return [...keys].filter((k) => stableStringify(ao[k]) !== stableStringify(bo[k])).sort();
}

export function registerAdapter(db: DatabaseSync, a: Adapter) {
  db.prepare(
    `INSERT INTO adapters (id, name, url, source_kind, method, schedule, coverage, requires_env)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, source_kind=excluded.source_kind,
       method=excluded.method, schedule=excluded.schedule, coverage=excluded.coverage, requires_env=excluded.requires_env`,
  ).run(a.id, a.name, a.url, a.sourceKind, a.method, a.schedule, a.coverage, a.requiresEnv ?? null);
}

export interface ApplyStats {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * Upsert an adapter's full result set. Records the adapter previously produced
 * but no longer returns are removed (kept in history + change feed). Content
 * changes archive the prior version to `history`.
 */
export function applyResult(
  db: DatabaseSync,
  adapterId: string,
  runId: string,
  result: AdapterResult,
  now = new Date().toISOString(),
  { appendOnly = false }: { appendOnly?: boolean } = {},
): ApplyStats {
  const stats: ApplyStats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const getExisting = db.prepare("SELECT hash, data, updated_at FROM entities WHERE id = ?");
  const insertEntity = db.prepare(
    `INSERT INTO entities (id, kind, state, county, title, date, status, confidence, verified_at, adapter, hash, first_seen, updated_at, retrieved_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateEntity = db.prepare(
    `UPDATE entities SET kind=?, state=?, county=?, title=?, date=?, status=?, confidence=?, verified_at=?, adapter=?, hash=?, updated_at=?, retrieved_at=?, data=? WHERE id=?`,
  );
  const touch = db.prepare("UPDATE entities SET retrieved_at = ? WHERE id = ?");
  const archive = db.prepare("INSERT INTO history (entity_id, hash, data, valid_from, valid_to) VALUES (?, ?, ?, ?, ?)");
  const logChange = db.prepare(
    "INSERT INTO changes (run_id, entity_id, kind, state, title, change, fields, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const delFts = db.prepare("DELETE FROM entities_fts WHERE id = ?");
  const insFts = db.prepare("INSERT INTO entities_fts (id, kind, title, body) VALUES (?, ?, ?, ?)");
  const upsertSource = db.prepare(
    `INSERT INTO sources (id, url, title, publisher, kind, published, doc_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, publisher=excluded.publisher, kind=excluded.kind,
       published=COALESCE(excluded.published, sources.published), doc_id=COALESCE(excluded.doc_id, sources.doc_id)`,
  );
  const clearEntitySources = db.prepare("DELETE FROM entity_sources WHERE entity_id = ?");
  const linkSource = db.prepare("INSERT OR IGNORE INTO entity_sources (entity_id, source_id, excerpt) VALUES (?, ?, ?)");

  db.exec("BEGIN");
  try {
    const seen = new Set<string>();
    for (const e of result.entities) {
      if (seen.has(e.id)) continue; // first occurrence wins; adapters should dedupe
      seen.add(e.id);
      const payload = { ...e, sources: e.sources ?? [] };
      const json = stableStringify(payload);
      const hash = sha(json);
      const prev = getExisting.get(e.id) as { hash: string; data: string; updated_at: string } | undefined;
      const cols = [
        e.kind, e.state ?? null, e.county ?? null, e.title, e.date ?? null, e.status ?? null,
        e.confidence ?? null, e.verifiedAt ?? null, adapterId,
      ] as const;

      if (!prev) {
        insertEntity.run(e.id, ...cols, hash, now, now, now, json);
        logChange.run(runId, e.id, e.kind, e.state ?? null, e.title, "added", null, now);
        stats.added++;
      } else if (prev.hash !== hash) {
        archive.run(e.id, prev.hash, prev.data, prev.updated_at, now);
        updateEntity.run(...cols, hash, now, now, json, e.id);
        const fields = changedFields(JSON.parse(prev.data).data, e.data);
        logChange.run(runId, e.id, e.kind, e.state ?? null, e.title, "updated", JSON.stringify(fields), now);
        stats.updated++;
      } else {
        touch.run(now, e.id);
        stats.unchanged++;
        continue;
      }

      delFts.run(e.id);
      insFts.run(e.id, e.kind, e.title, e.searchText ?? "");
      clearEntitySources.run(e.id);
      for (const s of e.sources ?? []) {
        const sid = sha(s.url);
        upsertSource.run(sid, s.url, s.title, s.publisher, s.kind, s.published ?? null, s.docId ?? null);
        linkSource.run(e.id, sid, s.excerpt ?? null);
      }
    }

    // Removals: anything this adapter produced before but not now (skipped for append-only sources).
    const stale = appendOnly ? [] : db
      .prepare("SELECT id, kind, state, title, hash, data, updated_at FROM entities WHERE adapter = ?")
      .all(adapterId) as { id: string; kind: string; state: string | null; title: string; hash: string; data: string; updated_at: string }[];
    for (const row of stale) {
      if (seen.has(row.id)) continue;
      archive.run(row.id, row.hash, row.data, row.updated_at, now);
      db.prepare("DELETE FROM entities WHERE id = ?").run(row.id);
      delFts.run(row.id);
      clearEntitySources.run(row.id);
      logChange.run(runId, row.id, row.kind, row.state, row.title, "removed", null, now);
      stats.removed++;
    }

    db.prepare("DELETE FROM relations WHERE adapter = ?").run(adapterId);
    const insRel = db.prepare("INSERT OR REPLACE INTO relations (src, dst, type, adapter, data) VALUES (?, ?, ?, ?, ?)");
    for (const r of result.relations ?? []) {
      insRel.run(r.src, r.dst, r.type, adapterId, r.data === undefined ? null : JSON.stringify(r.data));
    }

    const insObs = db.prepare(
      `INSERT INTO observations (series, area, date, value, unit, adapter, retrieved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(series, area, date) DO UPDATE SET value=excluded.value, retrieved_at=excluded.retrieved_at`,
    );
    for (const o of result.observations ?? []) insObs.run(o.series, o.area, o.date, o.value, o.unit, adapterId, now);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return stats;
}
