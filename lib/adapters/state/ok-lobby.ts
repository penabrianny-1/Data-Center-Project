import { strFromU8, unzipSync } from "fflate";
import type { Adapter } from "../../ingest/types";
import { parseCsv } from "../fec";
import { buildLobbyEntity, DATA_CENTER_RE, type LobbyClient, type StateLobbyMeta } from "./contract";
import { cachedDownload, orgKey } from "./ky";

/**
 * Oklahoma lobbying from the Oklahoma Ethics Commission's Guardian bulk
 * downloads (https://guardian.ok.gov/PublicSite/DataDownload.aspx):
 * {YEAR}_LobbyistExpenditures.csv.zip for 2025 and 2026.
 *
 * Field meanings follow the commission's "Lobbyist Expenditures File Layout"
 * (https://guardian.ok.gov/PublicSite/Resources/PublicDocuments/OKLobbyistExpendituresFileLayout.pdf):
 * columns A–I are common to all expenditures (Expenditure ID, Lobbyist ID and
 * name, Expenditure Type, Date, Cost); J–U describe meals and gifts (meal
 * type, explanation, recipient and title/agency); V–AB are "Information for
 * lobbyist principal events": Principal Name ("the name of the lobbyist
 * principal related to the expenditure"), the principal's percentage of cost,
 * caucus, committee and event location.
 *
 * So this file is about gifts, meals and events given to state officials, not
 * lobbying registrations. A principal (client) is named only on
 * principal-event rows (about 2% of 2025–26 rows), so the client list is the
 * principals that sponsored reported events. It is not the full roster of
 * registered principals. That roster is only in the Guardian principal
 * search, an ASP.NET postback form; replaying it returned HTTP 500 on
 * 2026-10-12, so it isn't used. Oklahoma does not require lobbyists to report
 * compensation.
 *
 * guardian.ok.gov has no robots.txt (404, checked 2026-10-12). Zips are cached
 * in data/cache/ and re-downloaded only when Last-Modified changes.
 */

const PAGE = "https://guardian.ok.gov/PublicSite/DataDownload.aspx";
const zipUrl = (y: string) => `https://guardian.ok.gov/PublicSite/Docs/BulkDataDownloads/${y}_LobbyistExpenditures.csv.zip`;
const YEARS = ["2025", "2026"];

export interface OkExpenditure {
  lobbyistId: string;
  lobbyist: string;
  type: string;
  date: string;
  cost: number;
  principal: string;
  pct: number | null;
  text: string; // explanation + event fields, for data-center matching
}

export function parseOkExpenditures(text: string): OkExpenditure[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const h = rows[0] ?? [];
  const ix = Object.fromEntries(h.map((x, i) => [x.trim(), i]));
  for (const col of ["LobbyistID", "Expenditure Cost", "Principal Name"]) {
    if (ix[col] === undefined) throw new Error(`OK lobbyist expenditures: missing column "${col}"`);
  }
  const g = (f: string[], c: string) => (ix[c] === undefined ? "" : (f[ix[c]] ?? "").trim());
  const out: OkExpenditure[] = [];
  for (const f of rows.slice(1)) {
    if (f.length < 5 || !g(f, "LobbyistID")) continue;
    const pctRaw = g(f, "Principal's Percentage Cost");
    out.push({
      lobbyistId: g(f, "LobbyistID"),
      lobbyist: [g(f, "Lobbyist FirstName"), g(f, "Lobbyist LastName"), g(f, "Lobbyist Suffix")].filter(Boolean).join(" "),
      type: g(f, "Expenditure Type"),
      date: g(f, "Expenditure Date"),
      cost: Number(g(f, "Expenditure Cost").replace(/[$,]/g, "")) || 0,
      principal: g(f, "Principal Name"),
      pct: pctRaw && Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : null,
      text: [g(f, "Explanation"), g(f, "Other Meal Description"), g(f, "Event Location"), g(f, "Committee/Subcommittee")].join(" "),
    });
  }
  return out;
}

export function aggregateOk(rows: OkExpenditure[]): { clients: LobbyClient[]; registrations: number } {
  const clients = new Map<string, LobbyClient>();
  const pairs = new Set<string>();
  for (const r of rows) {
    if (!r.principal) continue;
    const k = orgKey(r.principal);
    let c = clients.get(k);
    if (!c) {
      c = { name: r.principal, amount: 0, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: false };
      clients.set(k, c);
    }
    // Principal's share of the event cost; the full cost when no percentage was given.
    c.amount = Math.round(((c.amount ?? 0) + r.cost * (r.pct === null ? 1 : r.pct / 100)) * 100) / 100;
    c.filings++;
    if (r.lobbyist && !c.lobbyists.includes(r.lobbyist)) c.lobbyists.push(r.lobbyist);
    if (DATA_CENTER_RE.test(r.text)) c.dataCenter = true;
    pairs.add(`${r.lobbyistId}|${k}`);
  }
  for (const c of clients.values()) if (DATA_CENTER_RE.test(c.name)) c.dataCenter = true;
  return { clients: [...clients.values()], registrations: pairs.size };
}

export const okLobbyAdapter: Adapter = {
  id: "state-ok-lobby",
  name: "Oklahoma Ethics Commission: lobbyist expenditures",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly (Guardian refreshes the 2026 file roughly weekly)",
  refreshMinutes: 10_080,
  coverage:
    "Oklahoma lobbyist gifts, meals and event expenditures for 2025–2026. Clients are only the principals named on principal-sponsored events. The full roster of registered principals is search-only and isn't included. 'Registrations' counts lobbyist–principal pairs on those events, not formal registrations. Oklahoma does not require compensation reporting.",
  async run({ fetch, log }) {
    const rows: OkExpenditure[] = [];
    let dataAsOf: string | null = null;
    for (const y of YEARS) {
      const r = await cachedDownload(fetch, zipUrl(y), `ok-guardian-${y}_LobbyistExpenditures.csv.zip`);
      if (r.lastModified && (!dataAsOf || Date.parse(r.lastModified) > Date.parse(dataAsOf))) dataAsOf = r.lastModified;
      const files = unzipSync(r.bytes, { filter: (f) => /\.csv$/i.test(f.name) });
      for (const [name, bytes] of Object.entries(files)) {
        const parsed = parseOkExpenditures(strFromU8(bytes));
        log(`Guardian ${name}: ${parsed.length} expenditures, ${parsed.filter((p) => p.principal).length} name a principal${r.fromCache ? " (cached)" : ""}`);
        rows.push(...parsed);
      }
    }
    const { clients, registrations } = aggregateOk(rows);
    const asOf = dataAsOf as string | null;
    const meta: StateLobbyMeta = {
      state: "OK",
      agency: "Oklahoma Ethics Commission (Guardian)",
      sourceUrl: PAGE,
      dataAsOf: asOf ? new Date(asOf).toISOString().slice(0, 10) : null,
      period: "2025–2026 lobbyist expenditure reports (principal-sponsored events only)",
      amountMeaning:
        "Principal's share (Expenditure Cost × Principal's Percentage of Cost; the full cost when no percentage was reported) of lobbyist-reported events, meals and gifts that name the principal, 2025–2026. Not compensation and not total lobbying spending.",
    };
    return { entities: [buildLobbyEntity(meta, clients, registrations)] };
  },
};

export const adapters: Adapter[] = [okLobbyAdapter];
