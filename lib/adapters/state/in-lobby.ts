import { strFromU8, unzipSync } from "fflate";
import type { Adapter } from "../../ingest/types";
import { buildLobbyEntity, DATA_CENTER_RE, type LobbyClient, type StateLobbyMeta } from "./contract";
import { cachedDownload, orgKey } from "./ky";

/**
 * Indiana lobbying from the Indiana Lobby Registration Commission (ILRC)
 * spreadsheets on https://www.in.gov/ilrc/lobbying-data/ (Employer and
 * Compensated "Lobbyist Total" XLSX files, one per year).
 *
 * Under Indiana's lobbying law (IC 2-7) both the organizations that hire
 * lobbyists ("employer lobbyists") and the people/firms paid to lobby
 * ("compensated lobbyists") register and file activity reports for two
 * periods a year. Columns, as headed in the files:
 *  - {YEAR}-Employer-Lobbyist-Total.xlsx: Year, Lobbyist (the employer),
 *    Terminated, then per period: Compensation, Reimbursements, Receptions,
 *    Other Entertainment, Other Gifts, Expenditures All Members, Gifts,
 *    Registration/Late Fees, Other Expenses, Net Expenditures (and Grand Totals).
 *  - {YEAR}-Compensated-Lobbyist-Total.xlsx: Year, Lobbyist (person or firm,
 *    only on the first row of its block), Client, Terminated, then per period
 *    the same categories plus Gross Expenditures, Deductions, Net Expenditures.
 * Header spellings vary by year ("Reimbrsemts", "Net Exps"), so columns are
 * found by pattern, not position. The 2026 files cover only the first period
 * as of their June 2026 posting.
 *
 * Amounts: the employer's own reported "Net Expenditures" (sum of all periods
 * posted). Clients that appear only as clients of compensated lobbyists have
 * no employer filing in these files and get amount null.
 *
 * Firm vs. individual: the files don't label compensated lobbyists as firms
 * or individuals. Names written "Last, First" are treated as individuals and
 * everything else as a firm (a heuristic).
 *
 * File names are not consistent across years, so links are taken from the
 * lobbying-data page. www.in.gov/robots.txt (checked 2026-10-12) has no
 * Disallow rules.
 */

const PAGE = "https://www.in.gov/ilrc/lobbying-data/";
const YEARS = ["2025", "2026"];

// ---------------------------------------------------------------------------
// Minimal XLSX reader (first worksheet, shared + inline strings)

const xmlText = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** Rows of the first sheet as column-letter → string maps (exported for tests). */
export function readXlsx(bytes: Uint8Array): Record<string, string>[] {
  const files = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(f.name) });
  const ss: string[] = [];
  const sst = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    ss.push(xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  }
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw new Error("XLSX has no first worksheet");
  const out: Record<string, string>[] = [];
  for (const r of strFromU8(sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Record<string, string> = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, attrs, body = ""] = c;
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (type === "s" && v !== undefined) row[col] = ss[Number(v)] ?? "";
      else if (type === "inlineStr") row[col] = xmlText([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else row[col] = v !== undefined ? xmlText(v) : "";
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------

const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isTotalRow = (s: string) => /^REPORT(ING)? TOTALS?$/i.test(s.trim());
const colsMatching = (header: Record<string, string>, re: RegExp) => Object.entries(header).filter(([, h]) => re.test(h)).map(([c]) => c);

export interface InEmployerRow {
  year: string;
  employer: string;
  net: number;
}
export interface InCompRow {
  year: string;
  lobbyist: string;
  client: string;
  compensation: number;
}

/** Employer Lobbyist Total sheet (exported for tests). */
export function parseInEmployer(rows: Record<string, string>[], year: string): InEmployerRow[] {
  const hi = rows.findIndex((r) => Object.values(r).some((v) => /Net Exp/i.test(v)));
  if (hi < 0) throw new Error("ILRC employer file: no Net Expenditures header");
  const header = rows[hi];
  const nameCol = colsMatching(header, /^Lobbyist$/i)[0] ?? "B";
  const netCols = colsMatching(header, /Net Exp/i);
  const out: InEmployerRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const name = (r[nameCol] ?? "").replace(/\s+/g, " ").trim();
    if (!name || isTotalRow(name)) continue;
    out.push({ year, employer: name, net: netCols.reduce((n, c) => n + num(r[c]), 0) });
  }
  return out;
}

/** Compensated Lobbyist Total sheet (exported for tests). */
export function parseInCompensated(rows: Record<string, string>[], year: string): InCompRow[] {
  const hi = rows.findIndex((r) => Object.values(r).some((v) => /^Client$/i.test(v.trim())));
  if (hi < 0) throw new Error("ILRC compensated file: no Client header");
  const header = rows[hi];
  const lobCol = colsMatching(header, /^Lobbyist$/i)[0] ?? "B";
  const clientCol = colsMatching(header, /^Client$/i)[0] ?? "C";
  const compCols = colsMatching(header, /Period Compensation/i);
  const out: InCompRow[] = [];
  let lobbyist = "";
  for (const r of rows.slice(hi + 1)) {
    const l = (r[lobCol] ?? "").trim();
    if (l) lobbyist = l; // the lobbyist is named only on the first row of its block
    const client = (r[clientCol] ?? "").replace(/\s+/g, " ").trim();
    if (!client || !lobbyist || isTotalRow(client)) continue;
    out.push({ year, lobbyist: lobbyist.replace(/\s+/g, " "), client, compensation: compCols.reduce((n, c) => n + num(r[c]), 0) });
  }
  return out;
}

/** "Last, First" → individual; anything else → firm (heuristic, see header). */
export const looksLikePerson = (s: string) => /^[A-Za-z'.\- ]+,\s*[A-Za-z'.\- ]+$/.test(s.trim()) && !/\b(LLC|LLP|Inc|PC|Group|Associates)\b/i.test(s);

export function aggregateIn(emp: InEmployerRow[], comp: InCompRow[]): { clients: LobbyClient[]; registrations: number } {
  const clients = new Map<string, LobbyClient>();
  const get = (name: string) => {
    const k = orgKey(name);
    let c = clients.get(k);
    if (!c) {
      c = { name, amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: false };
      clients.set(k, c);
    }
    return c;
  };
  for (const r of emp) {
    const c = get(r.employer);
    c.amount = Math.round(((c.amount ?? 0) + r.net) * 100) / 100;
    c.filings++; // one employer-lobbyist registration year
  }
  for (const r of comp) {
    // A firm registered as its own client is the firm's in-house filing, not a client relationship.
    if (orgKey(r.client) === orgKey(r.lobbyist)) continue;
    const c = get(r.client);
    c.filings++; // one compensated-lobbyist engagement year
    const list = looksLikePerson(r.lobbyist) ? c.lobbyists : c.firms;
    if (!list.includes(r.lobbyist)) list.push(r.lobbyist);
  }
  for (const c of clients.values()) c.dataCenter = DATA_CENTER_RE.test(c.name);
  return { clients: [...clients.values()], registrations: emp.length + comp.filter((r) => orgKey(r.client) !== orgKey(r.lobbyist)).length };
}

/** Find the year's two "…Lobbyist-Total(s).xlsx" links on the ILRC page (exported for tests). */
export function findInLinks(html: string, year: string): { employer?: string; compensated?: string } {
  const links = [...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => new URL(m[1].replace(/\\/g, "/"), PAGE).toString());
  const forYear = links.filter((u) => u.includes(`/${year}-`));
  return {
    employer: forYear.find((u) => /Employer-Lobbyist-Totals?\.xlsx$/i.test(u)),
    compensated: forYear.find((u) => /Compensated-Lobbyist-Totals?\.xlsx$/i.test(u)),
  };
}

export const inLobbyAdapter: Adapter = {
  id: "state-in-lobby",
  name: "Indiana Lobby Registration Commission: lobbyist activity totals",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly (ILRC posts totals after each reporting period)",
  refreshMinutes: 10_080,
  coverage:
    "Indiana lobbying for 2025 and 2026 (2026 first period only, as posted): employers that hire lobbyists with their reported net lobbying expenditures, and the contract lobbyists and firms each client retained. No issue or subject fields are in the spreadsheets.",
  async run({ fetch, log }) {
    const page = await (await fetch(PAGE)).text();
    const emp: InEmployerRow[] = [];
    const comp: InCompRow[] = [];
    const warnings: string[] = [];
    let dataAsOf: string | null = null;
    for (const y of YEARS) {
      const links = findInLinks(page, y);
      for (const [kind, url] of Object.entries(links)) {
        if (!url) continue;
        const r = await cachedDownload(fetch, url, `in-ilrc-${y}-${kind}.xlsx`);
        if (r.lastModified && (!dataAsOf || Date.parse(r.lastModified) > Date.parse(dataAsOf))) dataAsOf = r.lastModified;
        const rows = readXlsx(r.bytes);
        if (kind === "employer") emp.push(...parseInEmployer(rows, y));
        else comp.push(...parseInCompensated(rows, y));
        log(`ILRC ${y} ${kind}: ${rows.length} sheet rows${r.fromCache ? " (cached)" : ""}`);
      }
      if (!links.employer) warnings.push(`ILRC: no ${y} Employer Lobbyist Total file linked`);
      if (!links.compensated) warnings.push(`ILRC: no ${y} Compensated Lobbyist Total file linked`);
    }
    if (!emp.length && !comp.length) throw new Error("ILRC: no lobbying spreadsheets found on the lobbying-data page");
    const { clients, registrations } = aggregateIn(emp, comp);
    const asOf = dataAsOf as string | null;
    const meta: StateLobbyMeta = {
      state: "IN",
      agency: "Indiana Lobby Registration Commission (ILRC)",
      sourceUrl: PAGE,
      dataAsOf: asOf ? new Date(asOf).toISOString().slice(0, 10) : null,
      period: "2025 (both periods) and 2026 (first period) activity reports",
      amountMeaning:
        "Net Expenditures reported by the employer lobbyist on its ILRC activity reports (compensation, reimbursements, receptions, entertainment, gifts, member-wide expenditures, registration fees and other expenses), summed over the posted 2025–2026 periods. Null for clients with no employer filing.",
    };
    return { entities: [buildLobbyEntity(meta, clients, registrations)], warnings };
  },
};

export const adapters: Adapter[] = [inLobbyAdapter];
