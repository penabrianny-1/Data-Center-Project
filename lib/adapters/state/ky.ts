import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, AdapterContext } from "../../ingest/types";
import { buildLobbyEntity, DATA_CENTER_RE, type LobbyClient, type StateLobbyMeta } from "./contract";

/**
 * Kentucky legislative-branch lobbying from the Kentucky Legislative Ethics
 * Commission (KLEC) report files published at
 * https://klec.ky.gov/Reports/Pages/Employers-and-Legislative-Agents.aspx
 *
 * Files used (current year = 2026, "Prior" = 2025):
 *  - LAComp.txt / LACompPrior.txt: "Legislative Agent Compensation", semicolon
 *    delimited: Legislative Agent;Report Period;Employer;Compensation
 *  - EmpExp2015.txt / EmpExp2015Prior.txt: "Employer Reporting Period Statement
 *    Totals by Employer", semicolon delimited, no header row in the TXT. The
 *    RTF/PDF version of the same report labels the columns
 *    EMP AE | EMP RME | EMP EXP | LA COMP | TOTAL, which follow categories A–D
 *    of KLEC's "Employer's Updated Registration Statement" (KRS 6.821; form at
 *    https://klec.ky.gov/Forms/Forms/2016%20Employer%20Long%20Form.doc):
 *      A  advertising during a session that supports/opposes legislation
 *      B  receptions, meals or events qualifying under KRS 6.611(2)(b)8, 11, 12
 *      C  other expenses directly associated with the employer's lobbying,
 *         including reimbursements to lobbyists
 *      D  compensation paid to lobbyists (prorated, accrual basis)
 *      TOTAL of all categories
 *  - EmpExpNOB.txt / EmpExpNOBPrior.txt: same totals prefixed with the
 *    employer's industry ("by Industry" report; the form's "Nature of business")
 *  - lecbills2026.rtf / lecbills2025.rtf: "Kentucky Registered Employer Bill
 *    Numbers": per employer and period, the bills/issues lobbied as reported
 *    on the form ("List the specific bills/resolutions/issues ... lobbied on").
 *
 * Legislative branch only: executive-branch lobbying is registered with the
 * Executive Branch Ethics Commission and is not included.
 *
 * Robots/terms: klec.ky.gov has no robots.txt (404, checked 2026-10-12) and the
 * files are linked publicly for download. Files are cached in data/cache/ and
 * only re-downloaded when the server's Last-Modified changes.
 */

const PAGE = "https://klec.ky.gov/Reports/Pages/Employers-and-Legislative-Agents.aspx";
const BASE = "https://klec.ky.gov/Reports/Reports/";
const CACHE_DIR = join(process.cwd(), "data", "cache");

// ---------------------------------------------------------------------------
// Shared download cache (also used by the other state lobbying adapters)

export interface Cached {
  bytes: Uint8Array;
  lastModified: string | null;
  fromCache: boolean;
}

/**
 * Download `url` into data/cache/<name>, reusing the cached copy when the
 * server's Last-Modified (via HEAD) is unchanged. For generated endpoints that
 * send no Last-Modified, pass `maxAgeMinutes` to reuse a recent copy instead.
 */
export async function cachedDownload(
  fetchFn: AdapterContext["fetch"],
  url: string,
  name: string,
  opts: { maxAgeMinutes?: number; head?: boolean } = {},
): Promise<Cached> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, name);
  const metaFile = `${file}.meta.json`;
  const meta = existsSync(metaFile) && existsSync(file)
    ? (JSON.parse(readFileSync(metaFile, "utf8")) as { lastModified: string | null; fetchedAt: string })
    : null;
  if (meta && opts.maxAgeMinutes && Date.now() - Date.parse(meta.fetchedAt) < opts.maxAgeMinutes * 60_000) {
    return { bytes: new Uint8Array(readFileSync(file)), lastModified: meta.lastModified, fromCache: true };
  }
  if (meta?.lastModified && opts.head !== false) {
    const lm = (await fetchFn(url, { method: "HEAD" })).headers.get("last-modified");
    if (lm && lm === meta.lastModified) return { bytes: new Uint8Array(readFileSync(file)), lastModified: lm, fromCache: true };
  }
  const res = await fetchFn(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const lastModified = res.headers.get("last-modified");
  writeFileSync(file, bytes);
  writeFileSync(metaFile, JSON.stringify({ lastModified, fetchedAt: new Date().toISOString() }));
  return { bytes, lastModified, fromCache: false };
}

/** Uppercased alphanumeric key for matching the same organization across files. */
export const orgKey = (s: string) =>
  s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\b(THE|INC|LLC|CORP|CORPORATION|CO|LTD|LP|PLLC)\b/g, " ").replace(/\s+/g, "").trim();

const cp1252 = new TextDecoder("windows-1252");
export const decode1252 = (b: Uint8Array) => cp1252.decode(b);

// ---------------------------------------------------------------------------
// Parsers (exported for tests)

const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const PERIOD_RE = /^\d\d\/\d\d\/\d{4}\s+(?:-\s+)?\d\d\/\d\d\/\d{4}$/;

export interface KyCompRow {
  lobbyist: string;
  period: string;
  employer: string;
  compensation: number;
}

/**
 * LAComp.txt. Long employer names wrap onto a following one-field line (often
 * after a repeated page header), which is appended to the previous row.
 */
export function parseKyComp(text: string): KyCompRow[] {
  const rows: KyCompRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const f = line.split(";");
    if (f.length === 4) {
      if (f[0] === "Legislative Agent") continue; // header (repeats on each page)
      if (!PERIOD_RE.test(f[1].trim())) continue;
      rows.push({ lobbyist: f[0].replace(/\s+/g, " ").trim(), period: f[1].trim(), employer: f[2].trim(), compensation: money(f[3]) });
    } else if (f.length === 1 && rows.length && !/^Legislative Agent Compensation$|^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(line.trim())) {
      const last = rows[rows.length - 1];
      last.employer = `${last.employer.replace(/,?\s*$/, (m) => (m.includes(",") ? ", " : " "))}${line.trim()}`.replace(/\s+/g, " ").trim();
    }
  }
  return rows;
}

export interface KyExpRow {
  employer: string;
  industry: string | null;
  period: string;
  advertising: number; // category A (EMP AE)
  receptions: number; // category B (EMP RME)
  otherExpenses: number; // category C (EMP EXP)
  lobbyistCompensation: number; // category D (LA COMP)
  total: number; // TOTAL of all categories
}

/** EmpExp2015*.txt (7 fields) or EmpExpNOB*.txt (8 fields, industry first). */
export function parseKyExp(text: string): KyExpRow[] {
  const rows: KyExpRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const f = raw.trimEnd().split(";");
    const off = f.length === 8 ? 1 : f.length === 7 ? 0 : -1;
    if (off < 0 || !PERIOD_RE.test(f[1 + off].trim())) continue;
    rows.push({
      employer: f[off].trim(),
      industry: off ? f[0].trim() : null,
      period: f[1 + off].replace(/\s+/g, " ").trim(),
      advertising: money(f[2 + off]),
      receptions: money(f[3 + off]),
      otherExpenses: money(f[4 + off]),
      lobbyistCompensation: money(f[5 + off]),
      total: money(f[6 + off]),
    });
  }
  return rows;
}

const unRtf = (s: string) =>
  s.replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => cp1252.decode(new Uint8Array([parseInt(h, 16)]))).replace(/\\([\\{}])/g, "$1");

/**
 * lecbills{YEAR}.rtf. Each text run is a positioned paragraph; employer names
 * are bold 10pt runs at the left margin (posx720), bill/issue text runs sit in
 * the right column (posx5459, not bold), period labels at posx734. Page
 * headers ("Employer Name", "Bills Lobbied", title, date, page number) use
 * other fonts/positions and are skipped.
 */
export function parseKyBillsRtf(rtf: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /\\posx(\d+)[^\n]*\r?\n\{\\f(\d)\\fs(\d+)(\\b)?\\cf1\r?\n((?:[^}\\]|\\.)*)\}/g;
  let employer: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (!employer || !t) return;
    const list = out.get(employer)!;
    if (!list.includes(t)) list.push(t); // the same text is often repeated period after period
  };
  for (let m = re.exec(rtf); m; m = re.exec(rtf)) {
    const [, posx, , fs, bold, body] = m;
    const text = unRtf(body).trim();
    if (posx === "720" && bold && fs === "20") {
      flush();
      employer = text;
      if (!out.has(employer)) out.set(employer, []);
    } else if (posx === "5459" && !bold && employer) buf.push(text);
    else if (posx === "734") flush(); // period label ends that period's text
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------


/** Combine parsed KLEC files into client rows (exported for tests). */
export function aggregateKy(
  comp: KyCompRow[],
  exp: KyExpRow[],
  nob: KyExpRow[],
  bills: Map<string, string[]>,
): { clients: LobbyClient[]; registrations: number } {
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
  for (const r of exp) {
    const c = get(r.employer);
    c.amount = (c.amount ?? 0) + r.total;
    c.filings++; // one employer updated registration statement per period
  }
  const pairs = new Set<string>();
  for (const r of comp) {
    const c = get(r.employer);
    if (!c.lobbyists.includes(r.lobbyist)) c.lobbyists.push(r.lobbyist);
    pairs.add(`${orgKey(r.employer)}|${r.lobbyist.toUpperCase()}`);
  }
  for (const r of nob) {
    if (!r.industry) continue;
    const c = clients.get(orgKey(r.employer));
    if (c && !c.issues.includes(r.industry)) c.issues.push(r.industry);
  }
  const fullText = new Map<string, string[]>();
  for (const [employer, texts] of bills) {
    const k = orgKey(employer);
    const c = clients.get(k);
    if (!c) continue;
    fullText.set(k, [...(fullText.get(k) ?? []), ...texts]);
    // Keep the distinct bill/issue statements, longest-first, trimmed for display.
    for (const t of texts) {
      const short = t.length > 300 ? `${t.slice(0, 297)}…` : t;
      if (!/^none\.?$/i.test(t) && !c.issues.includes(short) && c.issues.length < 12) c.issues.push(short);
    }
  }
  for (const [k, c] of clients) {
    if (c.amount !== null) c.amount = Math.round(c.amount * 100) / 100;
    // Flag on the full (untrimmed) statements, not just the display copies.
    c.dataCenter = DATA_CENTER_RE.test(c.name) || c.issues.some((i) => DATA_CENTER_RE.test(i)) || (fullText.get(k) ?? []).some((t) => DATA_CENTER_RE.test(t));
  }
  return { clients: [...clients.values()], registrations: pairs.size };
}

export const kyLobbyAdapter: Adapter = {
  id: "state-ky-lobby",
  name: "Kentucky Legislative Ethics Commission: legislative lobbying",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly (KLEC posts updated statements monthly)",
  refreshMinutes: 10_080,
  coverage:
    "Kentucky General Assembly (legislative-branch) lobbying for 2025 and 2026 to date: employers, their registered lobbyists, employer-reported lobbying expenditures (advertising, events, other expenses and lobbyist compensation), industry, and bills/issues lobbied. Executive-branch lobbying (Executive Branch Ethics Commission) is not included. KLEC lists no lobbying firms, only individuals.",
  async run({ fetch, log }) {
    const get = async (f: string) => {
      const r = await cachedDownload(fetch, BASE + f, `ky-klec-${f}`);
      log(`KLEC ${f}: ${r.bytes.length} bytes${r.fromCache ? " (cached)" : ""}${r.lastModified ? `, Last-Modified ${r.lastModified}` : ""}`);
      return { text: decode1252(r.bytes), lastModified: r.lastModified };
    };
    const files = {
      comp: ["LAComp.txt", "LACompPrior.txt"],
      exp: ["EmpExp2015.txt", "EmpExp2015Prior.txt"],
      nob: ["EmpExpNOB.txt", "EmpExpNOBPrior.txt"],
      bills: ["lecbills2026.rtf", "lecbills2025.rtf"],
    };
    const warnings: string[] = [];
    let dataAsOf: string | null = null;
    const load = async (names: string[]) => {
      const texts: string[] = [];
      for (const n of names) {
        try {
          const { text, lastModified } = await get(n);
          if (lastModified && (!dataAsOf || Date.parse(lastModified) > Date.parse(dataAsOf))) dataAsOf = lastModified;
          texts.push(text);
        } catch (e) {
          warnings.push(`KLEC ${n}: ${(e as Error).message}`);
        }
      }
      return texts;
    };
    const comp = (await load(files.comp)).flatMap(parseKyComp);
    const exp = (await load(files.exp)).flatMap(parseKyExp);
    const nob = (await load(files.nob)).flatMap(parseKyExp);
    const bills = new Map<string, string[]>();
    for (const t of await load(files.bills)) for (const [k, v] of parseKyBillsRtf(t)) bills.set(k, [...(bills.get(k) ?? []), ...v]);
    if (!comp.length || !exp.length) throw new Error("KLEC compensation or expenditure file was empty or unreadable");

    const { clients, registrations } = aggregateKy(comp, exp, nob, bills);
    log(`KLEC: ${exp.length} employer statements, ${comp.length} lobbyist compensation rows, ${clients.length} employers, ${registrations} lobbyist–employer pairs`);
    const asOf = dataAsOf as string | null;
    const meta: StateLobbyMeta = {
      state: "KY",
      agency: "Kentucky Legislative Ethics Commission (KLEC)",
      sourceUrl: PAGE,
      dataAsOf: asOf ? new Date(asOf).toISOString().slice(0, 10) : null,
      period: "2025–2026 employer statements (Jan 2025 through the latest posted 2026 period)",
      amountMeaning:
        "Employer-reported legislative lobbying expenditures: the TOTAL of KLEC employer statement categories A–D (advertising, receptions/meals/events, other lobbying expenses incl. lobbyist reimbursements, and compensation paid to lobbyists), summed over 2025–2026 statement periods.",
    };
    return { entities: [buildLobbyEntity(meta, clients, registrations)], warnings };
  },
};

export const adapters: Adapter[] = [kyLobbyAdapter];
