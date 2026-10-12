import type { Adapter, AdapterContext } from "../../ingest/types";
import { DATA_CENTER_RE, buildLobbyEntity, type StateLobbyMeta } from "./contract";
import { ClientBook, dataCenterBills, normBill, num } from "./wa";

/**
 * Maine lobbying from the Commission on Governmental Ethics and Election
 * Practices' lobbying disclosure site (mainelobbying.com, run by vendor
 * MapLight). The public Angular app reads a JSON/CSV API at
 * api.mainelobbying.com; this adapter uses its public CSV exports (no key):
 *   /api/ClientRegistration/csv                                   registered clients: primary lobbyist(s), firm(s), legislative interest
 *   /api/advanced-search/monthly-report/compensation-for-lobbying/csv   Lobbying Year, Month, Primary Lobbyist, Client, Comp. for Lobbying
 *   /api/advanced-search/monthly-report/bills-and-issues/csv      Lobbying Year, Month, Primary Lobbyist, Client, Bill or Issue, Compensation
 *   /api/advanced-search/monthly-report/expenditures/csv          Lobbying Year, Month, Primary Lobbyist, Client, Amount, Officials / Family Members, Purpose
 * These are the same files the site's "Advanced Search" export buttons produce
 * (https://mainelobbying.com/public). Column meanings are taken from the
 * headers; the API has no published documentation. The exports carry one row
 * per (year, month, lobbyist, client); no duplicate amended versions were
 * present on 2026-10-12.
 *
 * Robots/terms (checked 2026-10-12): api.mainelobbying.com has no robots.txt
 * (404); mainelobbying.com/robots.txt is served by the SPA (no rules). No terms
 * of use restrict access. The adapter makes four requests per run.
 *
 * Maine campaign finance is out of scope here: the official site
 * (mainecampaignfinancedisclosure.com) sits behind a Cloudflare challenge.
 */

const API = "https://api.mainelobbying.com/api";
const AGENCY = "Maine Commission on Governmental Ethics and Election Practices";
const YEARS = new Set(["2025", "2026"]);

/** RFC 4180 CSV parser (quoted fields may span lines). Strips a BOM and NUL bytes, which the bills export contains. */
export function parseCsv(text: string): Record<string, string>[] {
  const s = text.replace(/^﻿/, "").replace(/\0/g, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** "$1,234.50" → 1234.5 */
export const money = (s: string | undefined) => num((s ?? "").replace(/[$,\s]/g, ""));

/** Split the client export's comma-joined list columns ("Maine Street Solutions, LLC, Maine Street Solutions, LLC"). */
function splitList(s: string | undefined): string[] {
  return (s ?? "").split(/,\s*(?!(?:LLC|L\.L\.C\.|Inc\.?|LLP|PLLC|P\.A\.|PA|Ltd\.?|Co\.)\b)/i).map((x) => x.trim()).filter(Boolean);
}

export interface MaineInputs {
  clients: Record<string, string>[];
  comp: Record<string, string>[];
  bills: Record<string, string>[];
  expenditures: Record<string, string>[];
}

export function maineClients(inp: MaineInputs, dcBills: Set<string>): ClientBook {
  const book = new ClientBook();
  const filings = new Set<string>();
  const inYears = (r: Record<string, string>) => YEARS.has(r["Lobbying Year"]);
  for (const r of inp.comp.filter(inYears)) {
    if (!r.Client) continue;
    book.addAmount(r.Client, money(r["Comp. for Lobbying"]));
    ClientBook.push(book.get(r.Client).lobbyists, r["Primary Lobbyist"]);
    filings.add(`${r.Client}|${r["Primary Lobbyist"]}|${r["Lobbying Year"]}|${r.Month}`);
  }
  for (const r of inp.expenditures.filter(inYears)) if (r.Client) book.addAmount(r.Client, money(r.Amount));
  for (const r of inp.bills.filter(inYears)) {
    if (!r.Client) continue;
    const issue = r["Bill or Issue"] ?? "";
    const c = book.get(r.Client);
    ClientBook.push(c.lobbyists, r["Primary Lobbyist"]);
    filings.add(`${r.Client}|${r["Primary Lobbyist"]}|${r["Lobbying Year"]}|${r.Month}`);
    if (DATA_CENTER_RE.test(issue) || dcBills.has(normBill(issue))) {
      c.dataCenter = true;
      ClientBook.push(c.issues, issue);
    }
  }
  for (const f of filings) book.get(f.split("|")[0]).filings++;
  // Registered clients: firms, lobbyists and the stated legislative interest.
  for (const r of inp.clients) {
    if (!r.Client) continue;
    const c = book.get(r.Client);
    for (const l of splitList(r["Primary Lobbyist"])) ClientBook.push(c.lobbyists, l);
    for (const f of new Set(splitList(r["Lobbying Firm"]))) if (f.toUpperCase() !== r.Client.toUpperCase()) ClientBook.push(c.firms, f);
    const interest = r["Legislative Interest"];
    if (interest) {
      if (DATA_CENTER_RE.test(interest)) c.dataCenter = true;
      if (!c.issues.length || DATA_CENTER_RE.test(interest)) ClientBook.push(c.issues, interest);
    }
  }
  return book;
}

async function getCsv(ctx: Pick<AdapterContext, "fetch">, path: string) {
  const res = await ctx.fetch(`${API}/${path}`, { headers: { Accept: "text/csv" } });
  return parseCsv(await res.text());
}

const meLobby: Adapter = {
  id: "state-me-lobby",
  name: "Maine Ethics Commission: lobbying",
  url: "https://mainelobbying.com/public",
  sourceKind: "data",
  method: "api",
  schedule: "Weekly",
  refreshMinutes: 10_080,
  dependsOn: ["curated", "openstates"],
  coverage:
    "Maine lobbying in the Commission's 2025 and 2026 lobbying years: each registered client, its lobbyists and firms, the compensation lobbyists reported on monthly reports, and expenditures on officials. A client is flagged for data centers when its stated legislative interest or a monthly-report issue mentions data centers, or when it lobbied on a data-center bill already tracked here, such as LD 307 or LD 713. Registered clients without monthly reports are included with no dollar amount.",
  async run(ctx) {
    const [clients, comp, bills, expenditures] = [
      await getCsv(ctx, "ClientRegistration/csv"),
      await getCsv(ctx, "advanced-search/monthly-report/compensation-for-lobbying/csv"),
      await getCsv(ctx, "advanced-search/monthly-report/bills-and-issues/csv"),
      await getCsv(ctx, "advanced-search/monthly-report/expenditures/csv"),
    ];
    const dcBills = dataCenterBills(ctx.lookup, "ME");
    const book = maineClients({ clients, comp, bills, expenditures }, dcBills);
    const list = book.list();
    ctx.log(`Maine: ${clients.length} registered clients, ${comp.length} compensation rows, ${bills.length} bill/issue rows; ${list.length} clients; data-center bills ${[...dcBills].join(", ")}`);
    const meta: StateLobbyMeta = {
      state: "ME", agency: AGENCY, sourceUrl: "https://mainelobbying.com/public", dataAsOf: new Date().toISOString(),
      amountMeaning: "Compensation for lobbying reported on monthly lobbyist reports, plus reported expenditures on officials (lobbying years 2025–2026)",
      period: "2025–2026 lobbying years (as labeled by the Commission)",
    };
    return { entities: [buildLobbyEntity(meta, list, clients.length)] };
  },
};

export const adapters: Adapter[] = [meLobby];
