import type { Adapter } from "../../ingest/types";
import { DATA_CENTER_RE, buildLobbyEntity, type StateLobbyMeta } from "./contract";
import { ClientBook, sodaAll, sodaUpdatedAt } from "./wa";

/**
 * Illinois lobbying registrations from the Secretary of State's Lobbyist
 * Registration data on data.illinois.gov (Socrata).
 *
 * Dataset: "Lobbyist Entity Client Data Daily" — https://data.illinois.gov/d/9xbi-x7x8
 *   (API /resource/9xbi-x7x8.json). One row per lobbyist × lobbying entity × client × registration
 *   year (ent_reg_year). Columns have no published descriptions; names are used at face value.
 *   Rows with client_id "0" and an empty client_name list an entity's lobbyists without a client.
 *   When the entity has no named client that year it is lobbying for itself (e.g. 3M COMPANY's
 *   in-house lobbyists) and is its own client; when it does (contract lobbying firms), the
 *   client-less rows are just its roster and aren't counted as a client.
 *
 * Not covered: lobbyist expenditure reports live only in the ILSOS lobbyist search
 * (www.ilsos.gov), not in any open dataset, so no dollar figures are available. Illinois
 * campaign finance (ISBE) is out of scope here: www.elections.il.gov/robots.txt disallows all paths.
 *
 * robots.txt (data.illinois.gov, checked 2026-10-12): standard Socrata file, `Crawl-delay: 1`,
 * only /browse, /page and /catalog search URLs disallowed; /resource/ allowed. (The mirror host
 * illinois-edp.data.socrata.com disallows "/", so it is not used.)
 */

const DOMAIN = "data.illinois.gov";
const DS = "9xbi-x7x8";
const AGENCY = "Illinois Secretary of State, Lobbyist Registration";

export interface IlRow {
  ent_reg_year?: string;
  lobbyist_fname?: string;
  lobbyist_lname?: string;
  ent_id?: string;
  ent_name?: string;
  client_id?: string;
  client_name?: string;
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Fold registration rows into clients. Returns the book and the number of distinct entity–client–year registrations. */
export function ilClients(rows: IlRow[]): { book: ClientBook; registrations: number } {
  const book = new ClientBook();
  const regs = new Set<string>();
  const hasClients = new Set(rows.filter((r) => (r.client_name ?? "").trim()).map((r) => `${r.ent_id}|${r.ent_reg_year}`));
  for (const r of rows) {
    const ent = (r.ent_name ?? "").trim();
    const named = (r.client_name ?? "").trim();
    if (!named && hasClients.has(`${r.ent_id}|${r.ent_reg_year}`)) continue;
    const clientName = named || ent;
    if (!clientName) continue;
    const c = book.get(clientName);
    const regKey = `${r.ent_id}|${r.client_id}|${clientName}|${r.ent_reg_year}`;
    if (!regs.has(regKey)) {
      regs.add(regKey);
      c.filings++;
    }
    if (ent && ent.toUpperCase() !== clientName.toUpperCase()) ClientBook.push(c.firms, ent, 40);
    const lob = [r.lobbyist_fname, r.lobbyist_lname].filter(Boolean).join(" ").trim();
    if (lob) ClientBook.push(c.lobbyists, title(lob), 60);
    if (DATA_CENTER_RE.test(clientName) || DATA_CENTER_RE.test(ent)) c.dataCenter = true;
  }
  return { book, registrations: regs.size };
}

const ilLobby: Adapter = {
  id: "state-il-lobby",
  name: "Illinois Secretary of State: lobbying registrations",
  url: "https://data.illinois.gov/d/9xbi-x7x8",
  sourceKind: "data",
  method: "api",
  schedule: "Daily (dataset refreshed daily)",
  refreshMinutes: 1440,
  coverage:
    "Illinois lobbying registrations for 2025 and 2026: each client, the lobbying firms it hired and the individual lobbyists registered for it. Clients ranked by number of registrations. Illinois doesn't publish lobbying spending as open data, so no dollar amounts are shown. Registrations don't list issues either, so a client is flagged for data centers only when the client or firm name mentions them, such as the Data Center Coalition.",
  async run(ctx) {
    const dataAsOf = await sodaUpdatedAt(ctx, DOMAIN, DS);
    const rows = await sodaAll<IlRow>(ctx, DOMAIN, DS, {
      $select: "ent_reg_year, lobbyist_fname, lobbyist_lname, ent_id, ent_name, client_id, client_name",
      $where: "ent_reg_year in ('2025','2026')",
      $order: "ent_reg_year, ent_id, client_id, lobbyist_lname, lobbyist_fname, client_name",
    });
    const { book, registrations } = ilClients(rows);
    const clients = book.list();
    ctx.log(`ILSOS: ${rows.length} lobbyist rows, ${registrations} registrations, ${clients.length} clients`);
    const meta: StateLobbyMeta = {
      state: "IL", agency: AGENCY, sourceUrl: "https://data.illinois.gov/d/9xbi-x7x8", dataAsOf,
      amountMeaning: null,
      period: "2025–2026 registration years",
    };
    return { entities: [buildLobbyEntity(meta, clients, registrations)] };
  },
};

export const adapters: Adapter[] = [ilLobby];
