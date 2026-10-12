import type { Source } from "../schema";

/** Kinds of entity stored in the intelligence database. */
export type EntityKind =
  | "jurisdiction"
  | "state_government"
  | "race"
  | "candidate"
  | "commission"
  | "docket"
  | "policy"
  | "bill"
  | "local_action"
  | "development"
  | "article"
  | "legislator"
  | "committee"
  | "finance";

/** A normalized record produced by an adapter. */
export interface Entity {
  /** Stable identifier, unique across kinds (e.g. "bill:VA-2026-HB1", "legislator:B001230") */
  id: string;
  kind: EntityKind;
  /** USPS code, "US" for federal/national */
  state?: string | null;
  /** 5-digit county FIPS for local records */
  county?: string | null;
  title: string;
  /** Most relevant date (latest action, publish date, election date) — YYYY-MM-DD */
  date?: string | null;
  status?: string | null;
  /** Free text indexed for search, in addition to title */
  searchText?: string;
  sources?: Source[];
  verifiedAt?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  data: unknown;
}

export interface Relation {
  src: string;
  dst: string;
  type: string;
  data?: unknown;
}

/** A point in a time series (e.g. gas price for an area on a date). */
export interface Observation {
  series: string;
  area: string;
  date: string;
  value: number;
  unit: string;
}

export interface AdapterResult {
  entities: Entity[];
  relations?: Relation[];
  observations?: Observation[];
  /** Human-readable notes about partial coverage discovered during the run */
  warnings?: string[];
}

export interface AdapterContext {
  fetch: (url: string, init?: RequestInit & { retries?: number }) => Promise<Response>;
  log: (msg: string) => void;
  env: NodeJS.ProcessEnv;
  /** Entities already ingested by other adapters in this run, for entity resolution */
  lookup: (kind: EntityKind) => Entity[];
}

export interface Adapter {
  id: string;
  name: string;
  /** Primary source URL */
  url: string;
  /** Position in the source hierarchy */
  sourceKind: Source["kind"];
  /** How data is collected */
  method: "api" | "bulk" | "html" | "curated" | "search-index";
  /** Intended refresh cadence, human readable */
  schedule: string;
  /** Minimum minutes between automatic refreshes (used by `ingest --due` and the scheduler) */
  refreshMinutes: number;
  /** Plain-language statement of what is and isn't covered */
  coverage: string;
  /** Env var that must be set for this adapter to run, if any */
  requiresEnv?: string;
  /** Keep records the source no longer returns (feeds that only show recent items). Default: remove them. */
  appendOnly?: boolean;
  /** Adapters whose entities this one needs via ctx.lookup */
  dependsOn?: string[];
  run(ctx: AdapterContext): Promise<AdapterResult>;
}
