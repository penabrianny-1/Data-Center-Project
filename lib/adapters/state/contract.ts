/**
 * Shared output contract for state campaign-finance and lobbying adapters.
 * Every state adapter aggregates its own source format into these shapes so
 * pages, linking and tests treat all states identically.
 *
 * Entities produced:
 *   statecand:XX:<filerId>   one per statewide 2026 candidate with ≥ $1,000 itemized receipts since 2025-01-01
 *   statedonors:XX           top donors to all state candidates (+ statewide candidate totals)
 *   statelobby:XX            state lobbying summary (top clients/firms, spending where disclosed, data-center mentions)
 * Relations:
 *   candidate:2026-gov-XX:* --has_state_finance--> statecand:XX:<filerId>   (matched by last name)
 */
import type { Entity, EntityKind, Relation } from "../../ingest/types";
import { nameKey } from "../resolve";

export const SINCE = "2025-01-01";

/** Normalized statewide offices (map each state's office codes onto these). */
export type StatewideOffice =
  | "Governor" | "Lieutenant Governor" | "Attorney General" | "Secretary of State" | "Treasurer"
  | "Comptroller" | "Auditor" | "Superintendent of Education" | "Agriculture Commissioner"
  | "Insurance Commissioner" | "Labor Commissioner" | "Land Commissioner" | "Utility / Corporation Commissioner"
  | "Railroad Commissioner";

export interface Donor {
  name: string;
  type: "ENTITY" | "INDIVIDUAL";
  employer: string;
  occupation: string;
  city: string;
  state: string;
  amount: number;
  count: number;
}

export interface CandidateTotals {
  filerId: string;
  name: string; // display "First Last"
  office: StatewideOffice;
  total: number;
  count: number;
  fromEntities: number;
  latest: string | null; // YYYY-MM-DD
  donors: Map<string, Donor>;
  committees: string[];
}

export interface StateFinanceMeta {
  state: string; // USPS code
  agency: string; // e.g. "California Secretary of State (Cal-Access)"
  sourceUrl: string; // public data page
  dataAsOf: string | null; // file Last-Modified or latest filing date
}

/** Canonical donor key: type + normalized name (+ city for individuals). */
export function donorKey(d: Omit<Donor, "amount" | "count">): string {
  const n = d.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return `${d.type}|${n}|${d.type === "INDIVIDUAL" ? d.city.toUpperCase() : ""}`;
}

export function addDonation(map: Map<string, Donor>, d: Omit<Donor, "amount" | "count">, amount: number) {
  const k = donorKey(d);
  const cur = map.get(k) ?? { ...d, amount: 0, count: 0 };
  cur.amount += amount;
  cur.count++;
  map.set(k, cur);
}

/** "Last, First (Title)" → "First Last" */
export const displayName = (s: string) =>
  s.replace(/\s*\((The Honorable|Hon\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\)/gi, "").replace(/^(.+?),\s*(.+)$/, "$2 $1").replace(/\s+/g, " ").trim();

/** Build the standard entities and governor-candidate links from aggregated totals. */
export function buildFinanceEntities(
  meta: StateFinanceMeta,
  candidates: CandidateTotals[],
  allDonors: Map<string, Donor>,
  lookup: (kind: EntityKind) => Entity[],
): { entities: Entity[]; relations: Relation[] } {
  const src = { title: `${meta.agency} campaign finance data`, url: meta.sourceUrl, publisher: meta.agency, kind: "data" as const };
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const govCands = lookup("candidate").filter((c) => c.id.startsWith(`candidate:2026-gov-${meta.state}:`));
  const govRace = lookup("race").find((r) => r.id === `race:2026-gov-${meta.state}`);

  const kept = candidates.filter((c) => c.total >= 1000).sort((a, b) => b.total - a.total);
  for (const c of kept) {
    const id = `statecand:${meta.state}:${c.filerId}`;
    entities.push({
      id,
      kind: "finance",
      state: meta.state,
      title: c.name,
      date: c.latest,
      status: "state_candidate_money",
      sources: [src],
      confidence: "high",
      data: {
        filerIdent: c.filerId, name: c.name, office: c.office, total: c.total, count: c.count,
        fromEntities: c.fromEntities, fromIndividuals: c.total - c.fromEntities, latest: c.latest, since: SINCE,
        topDonors: [...c.donors.values()].sort((a, b) => b.amount - a.amount).slice(0, 20),
        committees: c.committees, archiveLastModified: meta.dataAsOf, agency: meta.agency,
      },
    });
    if (c.office === "Governor") {
      const last = nameKey(c.name).last;
      const cand = govCands.find((g) => nameKey((g.data as { name: string }).name).last === last);
      if (cand) {
        relations.push({ src: cand.id, dst: id, type: "has_state_finance" });
        if (govRace) relations.push({ src: id, dst: govRace.id, type: "money_in" });
      }
    }
  }
  const ranked = [...allDonors.values()].sort((a, b) => b.amount - a.amount);
  entities.push({
    id: `statedonors:${meta.state}`,
    kind: "finance",
    state: meta.state,
    title: `Top donors to ${meta.state} state candidates (2025–26)`,
    status: "state_donors",
    sources: [src],
    confidence: "high",
    data: {
      since: SINCE,
      total: ranked.reduce((n, d) => n + d.amount, 0),
      topEntities: ranked.filter((d) => d.type === "ENTITY").slice(0, 30),
      topIndividuals: ranked.filter((d) => d.type === "INDIVIDUAL").slice(0, 30),
      statewide: kept.map((c) => ({ filerIdent: c.filerId, name: c.name, office: c.office, total: c.total })),
      archiveLastModified: meta.dataAsOf,
      agency: meta.agency,
    },
  });
  return { entities, relations };
}

// ---------------------------------------------------------------------------
// Lobbying

export interface LobbyClient {
  name: string;
  amount: number | null; // disclosed spending/compensation if the state reports it
  filings: number;
  lobbyists: string[];
  firms: string[];
  issues: string[];
  dataCenter: boolean; // any filing text mentions data centers
}

export interface StateLobbyMeta extends StateFinanceMeta {
  /** What the dollar figures mean in this state (e.g. "compensation paid to lobbyists", "total expenditures") */
  amountMeaning: string | null;
  period: string; // e.g. "2025–2026 registrations"
}

export function buildLobbyEntity(meta: StateLobbyMeta, clients: LobbyClient[], registrations: number): Entity {
  const ranked = [...clients].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || b.filings - a.filings);
  return {
    id: `statelobby:${meta.state}`,
    kind: "lobbying",
    state: meta.state,
    title: `${meta.state} state lobbying`,
    status: "state_lobbying",
    sources: [{ title: `${meta.agency} lobbying data`, url: meta.sourceUrl, publisher: meta.agency, kind: "data" }],
    confidence: "high",
    data: {
      state: meta.state, agency: meta.agency, period: meta.period, amountMeaning: meta.amountMeaning, dataAsOf: meta.dataAsOf,
      registrations, clientCount: clients.length,
      topClients: ranked.slice(0, 40),
      dataCenterClients: ranked.filter((c) => c.dataCenter).slice(0, 40),
    },
  };
}

export const DATA_CENTER_RE = /\bdata[- ]?cent(?:er|re)s?\b|\bhyperscal\w*|\blarge[- ]load\b/i;
