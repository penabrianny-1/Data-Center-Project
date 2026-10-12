/**
 * Read-side queries for the UI. All functions are synchronous reads against
 * the SQLite store built by `npm run ingest`. If the database hasn't been
 * built yet, every query returns empty results and `dbStatus()` says so.
 */
import "server-only";
import { existsSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { DB_PATH, openDb } from "./db";
import type { EntityKind } from "./ingest/types";
import type {
  Bill, Candidate, Commission, Development, Docket, LocalAction, Race, Source, StateGovernment, StatePolicy,
} from "./schema";
import type { Article, StateEntry } from "./types";
import { classify, type ClassifiedNews, type NewsData } from "./news-meta";
import { outletTypeFor } from "./outlets";

let db: DatabaseSync | null = null;
let openedAt = 0;
/** Read-only connection, reopened whenever `npm run ingest` rewrites the file. */
function conn(): DatabaseSync | null {
  if (!existsSync(DB_PATH)) return null;
  const mtime = statSync(DB_PATH).mtimeMs;
  if (db && mtime === openedAt) return db;
  db?.close();
  db = openDb(DB_PATH, { readonly: true });
  openedAt = mtime;
  return db;
}

export function dbStatus(): { ready: boolean; path: string } {
  return { ready: conn() !== null, path: DB_PATH };
}

export interface Row<T> {
  id: string;
  kind: EntityKind;
  state: string | null;
  county: string | null;
  title: string;
  date: string | null;
  status: string | null;
  confidence: "high" | "medium" | "low" | null;
  verifiedAt: string | null;
  retrievedAt: string;
  updatedAt: string;
  adapter: string;
  sources: Source[];
  data: T;
}

interface RawRow {
  id: string;
  kind: EntityKind;
  state: string | null;
  county: string | null;
  title: string;
  date: string | null;
  status: string | null;
  confidence: Row<unknown>["confidence"];
  verified_at: string | null;
  retrieved_at: string;
  updated_at: string;
  adapter: string;
  data: string;
}

function toRow<T>(r: RawRow): Row<T> {
  const payload = JSON.parse(r.data) as { data: T; sources?: Source[] };
  return {
    id: r.id, kind: r.kind, state: r.state, county: r.county, title: r.title, date: r.date, status: r.status,
    confidence: r.confidence, verifiedAt: r.verified_at, retrievedAt: r.retrieved_at, updatedAt: r.updated_at,
    adapter: r.adapter, sources: payload.sources ?? [], data: payload.data,
  };
}

function all<T>(sql: string, ...params: (string | number | null)[]): Row<T>[] {
  const c = conn();
  if (!c) return [];
  return (c.prepare(sql).all(...params) as unknown as RawRow[]).map((r) => toRow<T>(r));
}
function one<T>(sql: string, ...params: (string | number | null)[]): Row<T> | null {
  return all<T>(sql, ...params)[0] ?? null;
}
function scalarRows<T>(sql: string, ...params: (string | number | null)[]): T[] {
  const c = conn();
  // node:sqlite returns null-prototype rows; copy to plain objects so they can cross to Client Components.
  return c ? (c.prepare(sql).all(...params) as object[]).map((r) => ({ ...r }) as T) : [];
}

export const byKind = <T>(kind: EntityKind, state?: string) =>
  state
    ? all<T>("SELECT * FROM entities WHERE kind = ? AND state = ? ORDER BY date DESC, title", kind, state)
    : all<T>("SELECT * FROM entities WHERE kind = ? ORDER BY date DESC, title", kind);

export const getEntity = <T>(id: string) => one<T>("SELECT * FROM entities WHERE id = ?", id);

// ---------------------------------------------------------------------------
// Domain helpers

export type StateJurisdiction = { type: "state"; fips: string; name: string; restriction: StateEntry | null };
export type CountyJurisdiction = { type: "county"; fips: string; name: string };

export const getStates = () =>
  all<StateJurisdiction>("SELECT * FROM entities WHERE kind = 'jurisdiction' AND id LIKE 'state:%' ORDER BY title");
export const getState = (code: string) => getEntity<StateJurisdiction>(`state:${code}`);
export const getCounty = (fips: string) => getEntity<CountyJurisdiction>(`county:${fips}`);
export const getCountiesInState = (code: string) =>
  all<CountyJurisdiction>("SELECT * FROM entities WHERE kind = 'jurisdiction' AND id LIKE 'county:%' AND state = ? ORDER BY title", code);

export const getStateGovernments = () => byKind<StateGovernment>("state_government");
export const getStateGovernment = (code: string) => getEntity<StateGovernment>(`stategov:${code}`);
export const getPolicies = () => byKind<StatePolicy>("policy");
export const getPolicy = (code: string) => getEntity<StatePolicy>(`policy:${code}`);
export const getCommissions = () => byKind<Commission>("commission");
export const getCommission = (code: string) => getEntity<Commission>(`commission:${code}`);
export const getDockets = (state?: string) => byKind<Docket>("docket", state);
export const getBills = (state?: string) => byKind<Bill>("bill", state).filter((b) => b.id.startsWith("bill:"));
export const getLocalActions = (state?: string) => byKind<LocalAction>("local_action", state);
export const getLocalActionsInCounty = (fips: string) =>
  all<LocalAction>("SELECT * FROM entities WHERE kind = 'local_action' AND county = ? ORDER BY date DESC", fips);
export const getDevelopments = () =>
  all<Development>("SELECT * FROM entities WHERE kind = 'development' ORDER BY json_extract(data, '$.data.severity') DESC, date DESC");
export const getDevelopmentsForState = (code: string) =>
  all<Development>(
    "SELECT * FROM entities WHERE kind = 'development' AND EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.data.states')) WHERE value = ?) ORDER BY date DESC",
    code,
  );
export const getArticles = () => byKind<Article>("article");

export const getRaces = (state?: string) =>
  (state
    ? all<Race>("SELECT * FROM entities WHERE kind = 'race' AND state = ? ORDER BY title", state)
    : all<Race>("SELECT * FROM entities WHERE kind = 'race' ORDER BY title"));
export const getRace = (id: string) => getEntity<Race>(`race:${id}`);

export type CandidateData = Candidate & { raceId: string; office: string; state: string; district: string | null };
export const getCandidatesForRace = (raceEntityId: string) =>
  all<CandidateData>(
    "SELECT e.* FROM relations r JOIN entities e ON e.id = r.src WHERE r.dst = ? AND r.type = 'candidate_in' ORDER BY e.title",
    raceEntityId,
  );

export interface FinanceData {
  fecId: string;
  name: string;
  office: string;
  state: string;
  district: string | null;
  party: string;
  status: string | null;
  receipts: number;
  disbursements: number;
  cashOnHand: number;
  individualContributions: number;
  pacContributions: number;
  partyContributions: number;
  candidateSelfFunding: number;
  debts: number;
  coverageEnd: string | null;
  fecUrl: string;
  recentIeFilings: {
    date: string | null; amount: number; side: "support" | "oppose"; spender: string; spenderId: string;
    purpose: string; payee: string; filingUrl: string | null;
  }[];
}
export interface IeTotals {
  fecId: string;
  support: number;
  oppose: number;
  topSpenders: { committeeId: string; name: string; side: string; total: number }[];
}

export const getFinance = (state?: string) =>
  (state
    ? all<FinanceData>("SELECT * FROM entities WHERE kind = 'finance' AND id LIKE 'finance:%' AND state = ? ORDER BY json_extract(data,'$.data.receipts') DESC", state)
    : all<FinanceData>("SELECT * FROM entities WHERE kind = 'finance' AND id LIKE 'finance:%' ORDER BY json_extract(data,'$.data.receipts') DESC"));
export const getIeTotals = () => all<IeTotals>("SELECT * FROM entities WHERE kind = 'finance' AND id LIKE 'ie:%'");
export const getFinanceFor = (entityId: string) =>
  all<FinanceData>(
    "SELECT e.* FROM relations r JOIN entities e ON e.id = r.dst WHERE r.src = ? AND r.type = 'has_finance'",
    entityId,
  );

export interface LegislatorData {
  bioguide: string;
  name: string;
  lastName: string;
  chamber: "Senate" | "House";
  state: string;
  district?: number;
  senateClass?: number;
  party: string;
  termStart: string;
  termEnd: string;
  up2026: boolean;
  url?: string;
  fecIds: string[];
}
export const getLegislators = (state?: string) =>
  (state
    ? all<LegislatorData>("SELECT * FROM entities WHERE kind = 'legislator' AND state = ? ORDER BY title", state)
    : all<LegislatorData>("SELECT * FROM entities WHERE kind = 'legislator' ORDER BY title"));

export interface CommitteeData {
  thomasId: string;
  chamber: "house" | "senate" | "joint";
  name: string;
  url?: string;
  parent: string | null;
  jurisdiction: string | null;
  relevance: { id: string; topics: string[]; relevance: string; keySubcommittees: string[] } | null;
  keySubcommittee?: boolean;
}
export const getCommittees = (relevantOnly = true) =>
  all<CommitteeData>(
    `SELECT * FROM entities WHERE kind = 'committee' ${relevantOnly ? "AND status = 'relevant'" : ""} ORDER BY title`,
  );
export const getCommittee = (id: string) => getEntity<CommitteeData>(`committee:${id}`);

export interface Membership {
  legislator: Row<LegislatorData>;
  side: "majority" | "minority";
  rank: number | null;
  title: string | null;
}
export function getCommitteeMembers(committeeId: string): Membership[] {
  const c = conn();
  if (!c) return [];
  const rows = c
    .prepare(
      "SELECT e.*, r.data AS rel FROM relations r JOIN entities e ON e.id = r.src WHERE r.dst = ? AND r.type = 'member_of'",
    )
    .all(`committee:${committeeId}`) as unknown as (RawRow & { rel: string })[];
  return rows
    .map((r) => ({ legislator: toRow<LegislatorData>(r), ...(JSON.parse(r.rel) as Omit<Membership, "legislator">) }))
    .sort((a, b) => (a.side === b.side ? (a.rank ?? 99) - (b.rank ?? 99) : a.side === "majority" ? -1 : 1));
}
export function getMemberCommittees(legislatorId: string) {
  const c = conn();
  if (!c) return [];
  return (
    c
      .prepare(
        "SELECT e.*, r.data AS rel FROM relations r JOIN entities e ON e.id = r.dst WHERE r.src = ? AND r.type = 'member_of' ORDER BY e.title",
      )
      .all(legislatorId) as unknown as (RawRow & { rel: string })[]
  ).map((r) => ({ committee: toRow<CommitteeData>(r), ...(JSON.parse(r.rel) as { side: string; rank: number | null; title: string | null }) }));
}

export const getIncumbentRace = (legislatorId: string) =>
  one<Race>("SELECT e.* FROM relations r JOIN entities e ON e.id = r.dst WHERE r.src = ? AND r.type = 'incumbent_in'", legislatorId);
export const getIncumbentForRace = (raceEntityId: string) =>
  one<LegislatorData>("SELECT e.* FROM relations r JOIN entities e ON e.id = r.src WHERE r.dst = ? AND r.type = 'incumbent_in'", raceEntityId);

export const getOfficialBillRecord = (billEntityId: string) =>
  one<{ latestAction: { actionDate: string; text: string } | null; url: string; cosponsorCount: number; laws: unknown[] }>(
    "SELECT e.* FROM relations r JOIN entities e ON e.id = r.src WHERE r.dst = ? AND r.type = 'official_record_of'",
    billEntityId,
  );

// ---------------------------------------------------------------------------
// Observations

export interface Observation {
  series: string;
  area: string;
  date: string;
  value: number;
  unit: string;
  retrieved_at: string;
}
export const getSeries = (series: string, area: string, since = "0000") =>
  scalarRows<Observation>("SELECT * FROM observations WHERE series = ? AND area = ? AND date >= ? ORDER BY date", series, area, since);
export const getLatestByArea = (series: string) =>
  scalarRows<Observation>(
    "SELECT o.* FROM observations o JOIN (SELECT area, MAX(date) d FROM observations WHERE series = ? GROUP BY area) m ON o.area = m.area AND o.date = m.d WHERE o.series = ? ORDER BY o.area",
    series, series,
  );

// ---------------------------------------------------------------------------
// Sources registry, freshness, changes, search

export interface AdapterRow {
  id: string;
  name: string;
  url: string;
  source_kind: string;
  method: string;
  schedule: string;
  coverage: string;
  requires_env: string | null;
  last_attempt: string | null;
  last_success: string | null;
  last_status: string | null;
  last_error: string | null;
  record_count: number;
  warnings: string | null;
}
export const getAdapters = () => scalarRows<AdapterRow>("SELECT * FROM adapters ORDER BY id");
export const getAdapter = (id: string) => scalarRows<AdapterRow>("SELECT * FROM adapters WHERE id = ?", id)[0] ?? null;

export interface ChangeRow {
  seq: number;
  entity_id: string;
  kind: string;
  state: string | null;
  title: string;
  change: "added" | "updated" | "removed";
  fields: string | null;
  at: string;
}
/** Change feed, excluding the bulk "added" events from a first-ever ingest of each adapter. */
export const getChanges = (limit = 200, since?: string) =>
  scalarRows<ChangeRow>(
    `SELECT c.* FROM changes c
     WHERE c.kind NOT IN ('jurisdiction') ${since ? "AND c.at > ?" : ""}
       AND NOT (c.change = 'added' AND c.run_id = (SELECT id FROM runs WHERE adapter = (SELECT adapter FROM runs WHERE id = c.run_id) AND status = 'ok' ORDER BY started LIMIT 1))
     ORDER BY c.seq DESC LIMIT ${Number(limit)}`,
    ...(since ? [since] : []),
  );
export const getBaselineCounts = () =>
  scalarRows<{ adapter: string; started: string; added: number }>(
    "SELECT adapter, MIN(started) started, added FROM runs WHERE status = 'ok' GROUP BY adapter",
  );

export function search(q: string, limit = 60) {
  const c = conn();
  const terms = q
    .replace(/["*():^]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" ");
  if (!c || !terms) return [];
  const rows = c
    .prepare(
      `SELECT e.* FROM entities_fts f JOIN entities e ON e.id = f.id
       WHERE entities_fts MATCH ? ORDER BY bm25(entities_fts, 0, 0, 10, 1) LIMIT ?`,
    )
    .all(terms, limit) as unknown as RawRow[];
  return rows.map((r) => toRow<unknown>(r));
}

export function countsByState() {
  return scalarRows<{ state: string; kind: string; n: number }>(
    "SELECT state, kind, COUNT(*) n FROM entities WHERE state IS NOT NULL AND kind NOT IN ('jurisdiction','finance','legislator','candidate') GROUP BY state, kind",
  );
}

/** All archived news stories, classified (category, status signal, international flag), newest first. */
export function getNews(): ClassifiedNews[] {
  return all<NewsData & { publisherDomain?: string }>("SELECT * FROM entities WHERE kind = 'article' AND id LIKE 'news:%' ORDER BY date DESC")
    // Re-apply outlet rules on read so newly blocked publishers drop out of the archive too.
    .filter((a) => !a.data.publisherDomain || outletTypeFor(a.data.publisherDomain) !== null)
    .map((a) => classify({ id: a.id, title: a.title, date: a.date, data: a.data }));
}

export interface DiscoveredBill {
  jurisdiction: string;
  session: string;
  identifier: string;
  title: string;
  chamber: string | null;
  status: string;
  introduced: string | null;
  latestAction: { date: string; text: string };
  sponsors: { name: string; party?: string }[];
  abstract: string | null;
  url: string;
  openstatesUrl: string;
}
/** Bills found automatically (Open States) that aren't linked to a curated record. */
export const getDiscoveredBills = (state?: string) =>
  all<DiscoveredBill>(
    `SELECT * FROM entities e WHERE e.id LIKE 'openstates:%' ${state ? "AND e.state = ?" : ""}
     AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.src = e.id AND r.type = 'official_record_of')
     ORDER BY e.date DESC`,
    ...(state ? [state] : []),
  );
