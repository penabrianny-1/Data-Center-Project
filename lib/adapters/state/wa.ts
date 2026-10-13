import type { Adapter, AdapterContext, Entity, EntityKind } from "../../ingest/types";
import {
  DATA_CENTER_RE, SINCE, buildFinanceEntities, donorKey, buildLobbyEntity,
  type Donor, type LobbyClient, type StateFinanceMeta, type StateLobbyMeta,
} from "./contract";

/**
 * Washington State campaign finance and lobbying from the Public Disclosure
 * Commission's open data on data.wa.gov (Socrata). Every query is filtered and
 * aggregated server-side with SoQL, so whole datasets are never downloaded.
 *
 * robots.txt (data.wa.gov, checked 2026-10-12): `Crawl-delay: 1`; only
 * /browse, /page and /catalog search URLs are disallowed. /resource/ (SODA)
 * and /api/views/ (metadata) are allowed. Requests are spaced ≥ 1 s apart.
 *
 * Terms: PDC datasets carry a "CONDITION OF RELEASE": the lists of
 * individuals "may not be used for commercial purposes" (RCW 42.56.070(9),
 * AGO 1975 No. 15). This app is a non-commercial research aggregator.
 *
 * Shared Socrata helpers used by the ny/hi/il state modules also live here.
 */

// ---------------------------------------------------------------------------
// Shared Socrata (SODA 2.1 / SoQL) helpers

export type SoqlParams = Partial<Record<"$select" | "$where" | "$group" | "$having" | "$order" | "$q", string>> & {
  $limit?: number;
  $offset?: number;
};

export function soqlUrl(domain: string, dataset: string, params: SoqlParams): string {
  const u = new URL(`https://${domain}/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

/** Socrata hosts publish `Crawl-delay: 1`; keep requests to one host at least this far apart. */
const CRAWL_DELAY_MS = 1_000;
const lastHit = new Map<string, number>();
async function crawlDelay(host: string) {
  const wait = (lastHit.get(host) ?? 0) + CRAWL_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

function sodaHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (env.SOCRATA_APP_TOKEN) h["X-App-Token"] = env.SOCRATA_APP_TOKEN; // optional; unauthenticated works
  return h;
}

/** One SoQL request. */
export async function soda<T = Record<string, string>>(ctx: Pick<AdapterContext, "fetch" | "env">, domain: string, dataset: string, params: SoqlParams): Promise<T[]> {
  await crawlDelay(domain);
  const res = await ctx.fetch(soqlUrl(domain, dataset, params), { headers: sodaHeaders(ctx.env) });
  return (await res.json()) as T[];
}

/** Page through a SoQL result with $limit/$offset. `$order` must make the order total for stable paging. */
export async function sodaAll<T = Record<string, string>>(
  ctx: Pick<AdapterContext, "fetch" | "env" | "log">, domain: string, dataset: string, params: SoqlParams, pageSize = 50_000,
): Promise<T[]> {
  if (!params.$order) throw new Error("sodaAll needs $order for stable paging");
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await soda<T>(ctx, domain, dataset, { ...params, $limit: pageSize, $offset: offset });
    for (const r of page) out.push(r);
    if (page.length < pageSize) break;
    ctx.log(`  ${dataset}: ${out.length} rows so far`);
  }
  return out;
}

/** Dataset "rows updated" time from Socrata view metadata (ISO), or null. */
export async function sodaUpdatedAt(ctx: Pick<AdapterContext, "fetch" | "env">, domain: string, dataset: string): Promise<string | null> {
  try {
    await crawlDelay(domain);
    const res = await ctx.fetch(`https://${domain}/api/views/${dataset}.json`, { headers: sodaHeaders(ctx.env), retries: 1 });
    const v = (await res.json()) as { rowsUpdatedAt?: number };
    return v.rowsUpdatedAt ? new Date(v.rowsUpdatedAt * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

/** Like contract.addDonation, for server-side grouped rows that already represent `count` receipts. */
export function addGrouped(map: Map<string, Donor>, d: Omit<Donor, "amount" | "count">, amount: number, count: number) {
  const k = donorKey(d);
  const cur = map.get(k) ?? { ...d, amount: 0, count: 0 };
  cur.amount += amount;
  cur.count += count > 0 ? count : 1;
  map.set(k, cur);
}

/** Quote a string literal for SoQL. */
export const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
export const ymd = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
export const normKey = (s: string) => s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** SoQL condition: any of `cols` (upper-cased) contains a data-center phrase. Mirrors DATA_CENTER_RE for server-side pre-filtering. */
export function dataCenterWhere(cols: string[]): string {
  const pats = ["%DATA CENTER%", "%DATA CENTRE%", "%DATACENTER%", "%DATA-CENTER%", "%HYPERSCAL%", "%LARGE LOAD%", "%LARGE-LOAD%"];
  return `(${cols.flatMap((c) => pats.map((p) => `upper(${c}) like '${p}'`)).join(" OR ")})`;
}

/** Normalize a bill number for matching ("LD 307" → "LD307", "S6394B" → "S6394", "E2SHB 1234" → "E2SHB1234"). */
export function normBill(s: string): string {
  const t = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = t.match(/^([A-Z]+(?:\d[A-Z]+)?)0*(\d+)[A-Z]?$/);
  return m ? `${m[1]}${m[2]}` : t;
}

/** Bill numbers of this state's data-center bills already in the database (bill entities whose title matches DATA_CENTER_RE). */
export function dataCenterBills(lookup: (k: EntityKind) => Entity[], state: string): Set<string> {
  const out = new Set<string>();
  for (const b of lookup("bill")) {
    if (b.state !== state || !DATA_CENTER_RE.test(b.title)) continue;
    const m = b.title.match(/^([A-Z]{1,5}\s?\d+[A-Z]?)\s*:/i);
    if (m) out.add(normBill(m[1]));
  }
  return out;
}

/** Accumulator for LobbyClient records keyed by normalized name. */
export class ClientBook {
  readonly map = new Map<string, LobbyClient>();
  get(name: string): LobbyClient {
    const k = normKey(name);
    let c = this.map.get(k);
    if (!c) {
      c = { name: name.trim(), amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: false };
      this.map.set(k, c);
    }
    return c;
  }
  has(name: string) {
    return this.map.has(normKey(name));
  }
  static push(arr: string[], v: string | null | undefined, max = 25) {
    const s = v?.replace(/\s+/g, " ").trim();
    if (s && arr.length < max && !arr.some((x) => x.toUpperCase() === s.toUpperCase())) arr.push(s.length > 240 ? `${s.slice(0, 237)}…` : s);
  }
  addAmount(name: string, amount: number) {
    const c = this.get(name);
    c.amount = (c.amount ?? 0) + amount;
  }
  list(): LobbyClient[] {
    return [...this.map.values()];
  }
}

// ---------------------------------------------------------------------------
// Washington campaign finance

const DOMAIN = "data.wa.gov";
/** Contributions to Candidates and Political Committees — https://data.wa.gov/d/kv7h-kjye */
const DS_CONTRIB = "kv7h-kjye";
/** Lobbyist Compensation and Expenses by Source (L2 monthly report summaries) — https://data.wa.gov/d/9nnw-c693 */
const DS_COMP = "9nnw-c693";
/** Lobbyist Employment Registrations (firm ↔ client, one row per year) — https://data.wa.gov/d/xhn7-64im */
const DS_EMPLOY = "xhn7-64im";
/** Lobbyist employers (individuals ↔ client) — https://data.wa.gov/d/e7sd-jbuy */
const DS_LOBBYIST_EMPLOYERS = "e7sd-jbuy";
/** Lobbyist Reporting History (filed L1/L2/L3 reports with JSON form data, incl. superseded versions) — https://data.wa.gov/d/nuwx-ay5h */
const DS_REPORTS = "nuwx-ay5h";

const PDC_AGENCY = "Washington Public Disclosure Commission (PDC)";

/**
 * Non-itemized lines on Form C3. The dataset docs (description column) say a C3 also carries
 * non-detailed cash: "Anonymous - Cash", "Candidates Personal Funds", "Miscellaneous Receipts",
 * "Contributions of $100 or less…"; on data.wa.gov these rows carry these contributor_name values.
 */
const WA_AGGREGATE_NAMES = ["SMALL CONTRIBUTIONS", "ANONYMOUS CONTRIBUTIONS", "MISCELLANEOUS RECEIPTS"];
/** State-level judicial offices (statewide or multi-county appellate); trial courts are local. */
const WA_STATE_JUDICIAL = ["STATE SUPREME COURT JUSTICE", "APPEALS COURT JUDGE"];

/**
 * SoQL filter for the WA donor ranking: since 2025, to state candidates (statewide executive,
 * legislative, Supreme Court / Court of Appeals) and to statewide ballot-measure committees.
 *  - `type`, `jurisdiction_type`, `office`, `for_or_against` per the kv7h-kjye column docs:
 *    ballot committees are political committees with a for/against position; jurisdiction_type
 *    'State' limits them to state measures.
 *  - Corrections (origin C.1 / C.3) are kept: per the docs "On corrections records, this field is
 *    the amount of the adjustment", so summing nets amendments out.
 *  - Self-transfers excluded: code 'Self' (candidate's own funds, docs "S: Self Pers. Fund") and
 *    rows where the contributor is the filer itself.
 */
export function waWhere(since = SINCE): string {
  return [
    `receipt_date >= '${since}T00:00:00'`,
    `((type = 'Candidate' AND (jurisdiction_type in ('Statewide','Legislative') OR office in (${WA_STATE_JUDICIAL.map(q).join(",")})))` +
      ` OR (type = 'Political Committee' AND jurisdiction_type = 'State' AND for_or_against IS NOT NULL))`,
    `(code IS NULL OR code != 'Self')`,
    `contributor_name != filer_name`,
    `upper(contributor_name) not in (${WA_AGGREGATE_NAMES.map(q).join(",")})`,
  ].join(" AND ");
}

export interface WaDonorRow {
  contributor_name?: string;
  code?: string;
  contributor_city?: string;
  contributor_state?: string;
  emp?: string;
  occ?: string;
  amt?: string;
  n?: string;
}

/** Fold grouped kv7h-kjye rows into the donor map. `code` 'Individual' (docs "I: Individual") → INDIVIDUAL, all other codes → ENTITY. */
export function waDonors(rows: WaDonorRow[], into = new Map<string, Donor>()): Map<string, Donor> {
  for (const r of rows) {
    const name = (r.contributor_name ?? "").trim();
    const amount = num(r.amt);
    if (!name || !amount) continue;
    const type = r.code === "Individual" ? "INDIVIDUAL" : "ENTITY";
    const d = { name, type, employer: r.emp ?? "", occupation: r.occ ?? "", city: r.contributor_city ?? "", state: r.contributor_state ?? "" } as const;
    addGrouped(into, d, amount, num(r.n));
  }
  return into;
}

const waFinance: Adapter = {
  id: "state-wa-finance",
  name: "Washington PDC: state campaign finance",
  url: "https://data.wa.gov/d/kv7h-kjye",
  sourceKind: "data",
  method: "api",
  schedule: "Daily (PDC refreshes data.wa.gov daily)",
  refreshMinutes: 1440,
  coverage:
    "Washington has no statewide executive offices on the 2026 ballot (they're elected in 2024 and 2028), so there are no per-candidate statewide totals. Instead this ranks the top donors since 1 Jan 2025 to all Washington state candidates (statewide, legislature, Supreme Court and Court of Appeals) and to statewide ballot-measure committees, such as those for and against the 2026 initiatives. Corrections are netted in. Excluded: candidates' own money, transfers from a committee to itself, and unitemized small, anonymous or miscellaneous receipts.",
  async run(ctx) {
    const dataAsOf = await sodaUpdatedAt(ctx, DOMAIN, DS_CONTRIB);
    const where = waWhere();
    const rows = await sodaAll<WaDonorRow>(ctx, DOMAIN, DS_CONTRIB, {
      $select: "contributor_name, code, contributor_city, contributor_state, max(contributor_employer_name) as emp, max(contributor_occupation) as occ, sum(amount) as amt, count(*) as n",
      $where: where,
      $group: "contributor_name, code, contributor_city, contributor_state",
      $order: "amt desc, contributor_name, code, contributor_city, contributor_state",
    });
    const donors = waDonors(rows);
    ctx.log(`PDC: ${rows.length} grouped contributor rows, ${donors.size} donors`);

    // Context: how the money splits between candidates and ballot-measure committees.
    const split = await soda(ctx, DOMAIN, DS_CONTRIB, {
      $select: "type, filer_name, ballot_number, for_or_against, sum(amount) as amt",
      $where: `${where} AND type = 'Political Committee'`,
      $group: "type, filer_name, ballot_number, for_or_against",
      $order: "amt desc",
      $limit: 8,
    });
    const warnings = [
      "Washington has no statewide executive races in 2026; statedonors:WA covers all state candidates plus statewide ballot-measure committees.",
      `Largest ballot-measure committees since 2025: ${split.map((s) => `${s.filer_name} (${s.for_or_against ?? ""} ${s.ballot_number ?? ""}) $${Math.round(num(s.amt)).toLocaleString("en-US")}`).join("; ")}`,
    ];
    const meta: StateFinanceMeta = { state: "WA", agency: PDC_AGENCY, sourceUrl: "https://data.wa.gov/d/kv7h-kjye", dataAsOf };
    return { ...buildFinanceEntities(meta, [], donors, ctx.lookup), warnings };
  },
};

// ---------------------------------------------------------------------------
// Washington lobbying

interface L2Report {
  sources?: { id: number; name: string }[];
  lobbying?: { source: number; subject?: string[]; issue?: string[]; bill_number?: string[] }[];
}

/** Clients whose L2 lobbying entries mention data centers (subject, issue or a known data-center bill). */
export function waL2DataCenter(reportJson: string, dcBills: Set<string>): { client: string; issue: string }[] {
  let r: L2Report;
  try {
    r = JSON.parse(reportJson) as L2Report;
  } catch {
    return [];
  }
  const names = new Map((r.sources ?? []).map((s) => [s.id, s.name]));
  const out: { client: string; issue: string }[] = [];
  for (const l of r.lobbying ?? []) {
    const text = [...(l.subject ?? []), ...(l.issue ?? []), ...(l.bill_number ?? [])].join("; ");
    const billHit = (l.bill_number ?? []).some((b) => dcBills.has(normBill(b)));
    const client = names.get(l.source);
    if (client && (DATA_CENTER_RE.test(text) || billHit)) out.push({ client, issue: (l.issue ?? []).join("; ") || (l.subject ?? []).join("; ") });
  }
  return out;
}

const waLobby: Adapter = {
  id: "state-wa-lobby",
  name: "Washington PDC: lobbying",
  url: "https://data.wa.gov/d/9nnw-c693",
  sourceKind: "data",
  method: "api",
  schedule: "Daily",
  refreshMinutes: 1440,
  dependsOn: ["curated", "openstates"],
  coverage:
    "Washington lobbyist clients since January 2025. Dollar figures are what lobbyists reported on their monthly L2 reports: compensation plus expenses for each client, net of payments to subcontracted lobbyists. Firm expenses not billed to a client, and spending that clients report themselves on their annual L3 reports, aren't included. Data-center flags come from the subjects, issues and bill numbers lobbyists listed on their current (non-superseded) 2025–26 L2 reports.",
  async run(ctx) {
    const dataAsOf = await sodaUpdatedAt(ctx, DOMAIN, DS_COMP);
    const book = new ClientBook();
    const idToName = new Map<string, string>();
    const sinceWhere = `filing_period >= '${SINCE}T00:00:00' AND type = 'Employer'`;

    // 1. Compensation + expenses per client. Docs: net_total = "total of all expenses and compensation,
    //    minus any amount paid to a subcontractor"; type 'Employer' rows are per-client (type 'Lobbyist'
    //    rows are firm expenses not reimbursed by a client).
    const comp = await sodaAll(ctx, DOMAIN, DS_COMP, {
      $select: "employer_id, employer_name, sum(net_total) as amt, count(*) as n",
      $where: sinceWhere,
      $group: "employer_id, employer_name",
      $order: "amt desc, employer_id, employer_name",
    });
    for (const r of comp) {
      const name = idToName.get(r.employer_id) ?? r.employer_name;
      if (!name) continue;
      idToName.set(r.employer_id, name);
      book.addAmount(name, num(r.amt));
      book.get(name).filings += num(r.n);
    }
    // 2. Firms (the PDC "lobbyist" is the registered firm) per client.
    const firms = await sodaAll(ctx, DOMAIN, DS_COMP, {
      $select: "employer_id, filer_name, count(*) as n", $where: sinceWhere,
      $group: "employer_id, filer_name", $order: "employer_id, filer_name",
    });
    for (const r of firms) {
      const name = idToName.get(r.employer_id);
      if (name) ClientBook.push(book.get(name).firms, r.filer_name);
    }
    // 3. Individual lobbyists registered for each client in 2025–26.
    const lobbyists = await sodaAll(ctx, DOMAIN, DS_LOBBYIST_EMPLOYERS, {
      $select: "employer_id, employer_title, agent_name", $where: "employment_year in (2025, 2026)",
      $group: "employer_id, employer_title, agent_name", $order: "employer_id, employer_title, agent_name",
    });
    for (const r of lobbyists) {
      const name = idToName.get(r.employer_id) ?? r.employer_title;
      if (name && book.has(name)) ClientBook.push(book.get(name).lobbyists, r.agent_name);
    }
    // 4. Registrations (firm–client contracts per year).
    const [reg] = await soda(ctx, DOMAIN, DS_EMPLOY, { $select: "count(*) as n", $where: "employment_year in (2025, 2026)" });
    // 5. Data-center mentions in current L2 reports (amended_by_report null = not superseded, per nuwx-ay5h docs).
    const dcBills = dataCenterBills(ctx.lookup, "WA");
    const billWhere = [...dcBills].map((b) => `report_data like ${q(`%${b}%`)}`);
    const reports = await sodaAll(ctx, DOMAIN, DS_REPORTS, {
      $select: "id, filer_name, report_data",
      $where: `year >= 2025 AND origin in ('L2','L2 AMENDED') AND amended_by_report IS NULL AND (${[dataCenterWhere(["report_data"]), ...billWhere].join(" OR ")})`,
      $order: "id",
    }, 5_000);
    let dcFilings = 0;
    for (const r of reports) {
      const hits = waL2DataCenter(r.report_data ?? "", dcBills);
      if (hits.length) dcFilings++;
      for (const h of hits) {
        const c = book.get(h.client);
        c.dataCenter = true;
        ClientBook.push(c.firms, r.filer_name);
        ClientBook.push(c.issues, h.issue);
      }
    }
    const clients = book.list();
    ctx.log(`PDC lobbying: ${clients.length} clients, ${reg?.n ?? 0} registrations, ${dcFilings} L2 reports mention data centers`);
    const meta: StateLobbyMeta = {
      state: "WA", agency: PDC_AGENCY, sourceUrl: "https://data.wa.gov/d/9nnw-c693", dataAsOf,
      amountMeaning: "Compensation plus expenses lobbyists reported for the client on monthly L2 reports (PDC net_total), January 2025 onward",
      period: "2025–2026 (L2 filing periods from January 2025; registrations for 2025 and 2026)",
    };
    return { entities: [buildLobbyEntity(meta, clients, num(reg?.n))] };
  },
};

export const adapters: Adapter[] = [waFinance, waLobby];
