import { strFromU8, unzipSync } from "fflate";
import type { AdapterContext, Entity, Relation } from "../../ingest/types";
import {
  addDonation, buildFinanceEntities, SINCE,
  type CandidateTotals, type Donor, type StateFinanceMeta, type StatewideOffice,
} from "./contract";
import { cachedDownload } from "./ky";

/**
 * Shared code for the Colorado (TRACER), Indiana (Campaign Finance), Oklahoma
 * (The Guardian) and Nebraska (NADC) campaign-finance adapters.
 *
 * All four states run the same vendor platform and publish bulk downloads at
 * /PublicSite/Docs/BulkDataDownloads/{YEAR}_....csv.zip (one CSV per zip).
 * The column layouts differ by state, so each state file maps its own columns
 * onto `Receipt`, and this module does the download/caching, CSV parsing,
 * office classification and aggregation.
 *
 * None of the four contribution files carries the office a candidate is
 * seeking. Offices are assigned, in order, from: (1) an office named in the
 * committee name ("… FOR GOVERNOR", "BRASHER FOR NE AG"); (2) a per-state
 * table of 2026 statewide candidates taken from the cited candidate lists;
 * (3) the curated governor candidates already in the database (ctx.lookup).
 * Candidate committees that match none of these count toward the state's
 * all-candidate donor totals but get no statewide candidate record.
 */

// ---------------------------------------------------------------------------
// Download + archive

/** Download (or reuse the cached copy of) a single-member bulk zip and return its text. One member is held in memory at a time. */
export async function fetchZipText(
  fetchFn: AdapterContext["fetch"], url: string, cacheName: string,
): Promise<{ text: string; lastModified: string | null; fromCache: boolean }> {
  const c = await cachedDownload(fetchFn, url, cacheName);
  const files = unzipSync(c.bytes, { filter: (f) => /\.csv$/i.test(f.name) });
  const name = Object.keys(files)[0];
  if (!name) throw new Error(`${url}: no CSV member in archive`);
  return { text: strFromU8(files[name]), lastModified: c.lastModified, fromCache: c.fromCache };
}

/** Bulk file years covering 2025-01-01 onward: these states split files by filing (or transaction) year. */
export function bulkYears(now = new Date()): string[] {
  const out: string[] = [];
  for (let y = 2025; y <= now.getUTCFullYear(); y++) out.push(String(y));
  return out;
}

// ---------------------------------------------------------------------------
// CSV

/**
 * Lenient, quote-aware CSV reader that calls `cb` once per record.
 * Handles quoted fields with embedded newlines, `""` escapes, and the
 * unescaped quotes inside quoted fields that appear in Indiana's export
 * (e.g. `"BIG "I" POLITICAL ACTION COMMITTEE"`): inside a quoted field, a
 * quote closes the field only when followed by a comma, line break or EOF.
 */
export function forEachCsvRow(text: string, cb: (fields: string[]) => void): void {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row: string[] = [];
  while (i < n) {
    let field: string;
    if (text[i] === '"') {
      i++;
      field = "";
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) { field += text.slice(i); i = n; break; }
        field += text.slice(i, q);
        const nx = text[q + 1];
        if (nx === '"') { field += '"'; i = q + 2; continue; }
        if (nx === undefined || nx === "," || nx === "\n" || nx === "\r") { i = q + 1; break; }
        field += '"'; // stray quote inside a quoted field
        i = q + 1;
      }
    } else {
      let j = i;
      while (j < n && text[j] !== "," && text[j] !== "\n" && text[j] !== "\r") j++;
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (text[i] === ",") {
      i++;
      if (i >= n) { row.push(""); cb(row); row = []; }
      continue;
    }
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    if (!(row.length === 1 && row[0] === "")) cb(row);
    row = [];
  }
}

/** Iterate CSV records as header-keyed objects. */
export function forEachCsvRecord(text: string, cb: (r: Record<string, string>) => void): void {
  let header: string[] | null = null;
  forEachCsvRow(text, (f) => {
    if (!header) { header = f.map((h) => h.trim()); return; }
    const r: Record<string, string> = {};
    for (let k = 0; k < header.length; k++) r[header[k]] = (f[k] ?? "").trim();
    cb(r);
  });
}

export function requireColumns(text: string, cols: string[], label: string): void {
  const nl = text.indexOf("\n");
  let header: string[] = [];
  forEachCsvRow(text.slice(0, nl < 0 ? text.length : nl), (f) => { header = f.map((h) => h.trim()); });
  const missing = cols.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${label}: missing column(s) ${missing.join(", ")}; the record layout may have changed`);
}

/** "2026-03-19 00:00:00" | "03/19/2026" → "2026-03-19" */
export function isoDate(s: string): string | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (b) return `${b[3]}-${b[1].padStart(2, "0")}-${b[2].padStart(2, "0")}`;
  return null;
}

// ---------------------------------------------------------------------------
// Names and offices

const SUFFIX = /^(JR|SR|II|III|IV|V|DR|MR|MRS|MS|HON)$/;
const NICK: Record<string, string> = {
  MIKE: "MICHAEL", BOB: "ROBERT", ROB: "ROBERT", JIM: "JAMES", JOEY: "JOSEPH", JOE: "JOSEPH", NICK: "NICHOLAS",
  BILL: "WILLIAM", TOM: "THOMAS", DAVE: "DAVID", DAN: "DANIEL", CHRIS: "CHRISTOPHER", BARB: "BARBARA",
  PHIL: "PHILIP", GREG: "GREGORY", JEFF: "JEFFREY", TONY: "ANTHONY", KATIE: "KATHERINE", SCOTT: "SCOTT",
};
const tokens = (s: string) =>
  s.toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\([^)]*\)/g, " ").replace(/[^A-Z\s-]/g, " ")
    .split(/[\s-]+/).filter((t) => t.length > 0 && !SUFFIX.test(t));
const canon = (t: string) => NICK[t] ?? t;

/** Same person? Last names must match; the listed first name must match any given-name token (nicknames and prefixes allowed). */
export function samePerson(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length < 2 || tb.length < 2 || ta.at(-1) !== tb.at(-1)) return false;
  const fa = ta.slice(0, -1).map(canon), fb = tb.slice(0, -1).map(canon);
  return fa.some((x) => fb.some((y) => x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y))));
}

/** Committee names that clearly belong to a non-statewide race. */
const OTHER_OFFICE_RE =
  /\b(MAYOR|COUNCIL|CITY|COUNTY|TOWNSHIP|LEGISLATURE|LEGISLATIVE|SENATE|SENATOR|HOUSE|REPRESENTATIVE|ASSEMBLY|REGENTS?|BOARD|SCHOOL|DISTRICT|SHERIFF|JUDGE|CLERK|CORONER|ASSESSOR|DA|HD\s?\d+|SD\s?\d+|CONGRESS)\b/;

const OFFICE_RE: [RegExp, StatewideOffice][] = [
  [/\b(LT\.?|LIEUTENANT)\s+GOV(ERNOR)?\b/, "Lieutenant Governor"],
  [/\bGOV(ERNOR)?\b/, "Governor"],
  [/\bATTORNEY\s+GENERAL\b|\bA\.?G\b/, "Attorney General"],
  [/\bSECRETARY\s+OF\s+STATE\b|\bSOS\b/, "Secretary of State"],
  [/\bTREASURER\b/, "Treasurer"],
  [/\bCOMPTROLLER\b/, "Comptroller"],
  [/\bAUDITOR\b/, "Auditor"],
  [/\bSUPERINTENDENT\b/, "Superintendent of Education"],
  [/\bLABOR\s+COMMISSIONER\b/, "Labor Commissioner"],
  [/\bINSURANCE\s+COMMISSIONER\b/, "Insurance Commissioner"],
  [/\bCORPORATION\s+COMMISSION(ER)?\b/, "Utility / Corporation Commissioner"],
];

/** Office named in a committee name, if it is one of `ballot` and the name doesn't also name a local office. */
export function officeFromCommitteeName(name: string, ballot: StatewideOffice[], alias: Partial<Record<StatewideOffice, StatewideOffice>> = {}): StatewideOffice | null {
  const n = name.toUpperCase().replace(/[^A-Z0-9.\s]/g, " ");
  if (/\bCOUNTY\b|\bCITY\b|\bMAYOR\b|\bTOWNSHIP\b/.test(n)) return null;
  for (const [re, office] of OFFICE_RE) {
    if (!re.test(n)) continue;
    const o = alias[office] ?? office;
    return ballot.includes(o) ? o : null;
  }
  return null;
}

export interface KnownCandidate { name: string; office: StatewideOffice }

/** How an office was assigned: from the committee's own name, or from the candidate-name tables. */
export interface OfficeMatch { office: StatewideOffice; via: "committee" | "candidate" }
export interface OfficeResolver {
  (committeeName: string, candidateName: string): OfficeMatch | null;
}

/**
 * Build a committee → statewide office resolver for one state.
 * `known` is the cited 2026 candidate table; governor candidates from the
 * database are added on top. Name-table matches are skipped when the
 * committee name points at another office (e.g. "JOEY SPELLERBERG FOR MAYOR").
 */
export function officeResolver(
  state: string, ballot: StatewideOffice[], known: KnownCandidate[],
  lookup: AdapterContext["lookup"], alias: Partial<Record<StatewideOffice, StatewideOffice>> = {},
): OfficeResolver {
  const govs = lookup("candidate")
    .filter((c) => c.id.startsWith(`candidate:2026-gov-${state}:`))
    .map((c) => (c.data as { name?: string }).name ?? c.title)
    .filter(Boolean);
  const table: KnownCandidate[] = [...known, ...govs.map((name) => ({ name, office: "Governor" as StatewideOffice }))];
  return (committeeName, candidateName) => {
    const fromName = officeFromCommitteeName(committeeName, ballot, alias);
    if (fromName) return { office: fromName, via: "committee" };
    if (!candidateName || OTHER_OFFICE_RE.test(committeeName.toUpperCase())) return null;
    const hit = table.find((k) => samePerson(k.name, candidateName));
    return hit ? { office: hit.office, via: "candidate" } : null;
  };
}

// ---------------------------------------------------------------------------
// Aggregation

/** One itemized contribution to a candidate committee, already filtered for type and amendment status by the state mapper. */
export interface Receipt {
  /** State record ID, for de-duplication across yearly files (null if the state publishes none) */
  id: string | null;
  committeeId: string;
  committeeName: string;
  candidateName: string; // as published, "FIRST LAST"
  date: string; // YYYY-MM-DD
  amount: number;
  donor: Omit<Donor, "amount" | "count">;
  /** Source is itself a candidate committee (state source-type field), used for own-committee transfer detection */
  fromCandidateCommittee: boolean;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Aggregate receipts into the contract shapes. A candidate's committees are
 * combined (same published candidate name; see below). Transfers between a candidate's own
 * committees are excluded: an entity donor whose name equals one of the
 * candidate's committee names or the candidate's own name, or a donor the
 * state marks as a candidate committee whose name contains the candidate's
 * last name.
 */
export function aggregate(receipts: Iterable<Receipt>, resolve: OfficeResolver): {
  candidates: CandidateTotals[]; allDonors: Map<string, Donor>; kept: number; selfTransfers: number; latest: string | null;
} {
  const rows: Receipt[] = [];
  const seen = new Set<string>();
  const committeesByCand = new Map<string, Set<string>>();
  for (const r of receipts) {
    if (r.id) {
      const k = `${r.committeeId}|${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    if (r.date < SINCE || !(r.amount > 0)) continue;
    rows.push(r);
    const ck = norm(r.candidateName) || `#${r.committeeId}`;
    (committeesByCand.get(ck) ?? committeesByCand.set(ck, new Set()).get(ck)!).add(norm(r.committeeName));
  }
  // Totals per committee first; a candidate's committees are combined afterwards.
  const officeCache = new Map<string, OfficeMatch | null>();
  type Part = CandidateTotals & { via: OfficeMatch["via"]; ck: string };
  const parts = new Map<string, Part>();
  const allDonors = new Map<string, Donor>();
  let kept = 0, selfTransfers = 0;
  let latest: string | null = null;
  for (const r of rows) {
    const ck = norm(r.candidateName) || `#${r.committeeId}`;
    if (r.donor.type === "ENTITY") {
      const dn = norm(r.donor.name);
      const last = tokens(r.candidateName).at(-1);
      if (committeesByCand.get(ck)!.has(dn) || dn === norm(r.candidateName) || (r.fromCandidateCommittee && last && last.length > 2 && dn.split(" ").includes(last))) {
        selfTransfers++;
        continue;
      }
    }
    kept++;
    if (!latest || r.date > latest) latest = r.date;
    addDonation(allDonors, r.donor, r.amount);
    const okey = `${r.committeeId}|${r.committeeName}|${r.candidateName}`;
    let m = officeCache.get(okey);
    if (m === undefined) { m = resolve(r.committeeName, r.candidateName); officeCache.set(okey, m); }
    if (!m) continue;
    const key = `${ck}|${m.office}|${r.committeeId}`;
    const c = parts.get(key) ?? {
      filerId: r.committeeId, name: titleCase(r.candidateName || r.committeeName), office: m.office, total: 0, count: 0, fromEntities: 0,
      latest: null, donors: new Map<string, Donor>(), committees: [r.committeeId], via: m.via, ck,
    };
    c.total += r.amount;
    c.count++;
    if (r.donor.type === "ENTITY") c.fromEntities += r.amount;
    if (!c.latest || r.date > c.latest) c.latest = r.date;
    addDonation(c.donors, r.donor, r.amount);
    parts.set(key, c);
  }
  // Combine per candidate and office: every committee whose own name names the
  // office, plus the candidate's largest committee matched only by candidate
  // name. Smaller name-only matches are left out (usually old or legislative
  // committees, e.g. a former House committee of a governor candidate).
  const groups = new Map<string, Part[]>();
  for (const p of parts.values()) {
    const g = `${p.ck}|${p.office}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(p);
  }
  const candidates: CandidateTotals[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.total - a.total);
    const byName = list.filter((p) => p.via === "candidate");
    const use = [...list.filter((p) => p.via === "committee"), ...byName.slice(0, 1)].sort((a, b) => b.total - a.total);
    const c: CandidateTotals = { ...use[0], donors: new Map(), committees: use.map((p) => p.filerId), total: 0, count: 0, fromEntities: 0, latest: null };
    for (const p of use) {
      c.total += p.total;
      c.count += p.count;
      c.fromEntities += p.fromEntities;
      if (p.latest && (!c.latest || p.latest > c.latest)) c.latest = p.latest;
      for (const [k, d] of p.donors) {
        const cur = c.donors.get(k);
        if (cur) { cur.amount += d.amount; cur.count += d.count; } else c.donors.set(k, { ...d });
      }
    }
    delete (c as Partial<Part>).via;
    delete (c as Partial<Part>).ck;
    candidates.push(c);
  }
  return { candidates, allDonors, kept, selfTransfers, latest };
}

/** "JENA GRISWOLD" → "Jena Griswold" (data is often all caps). */
export function titleCase(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-'.("])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`);
}

/** Finish: build contract entities and log the headline numbers. */
export function finish(
  meta: StateFinanceMeta, agg: ReturnType<typeof aggregate>, lookup: AdapterContext["lookup"], log: (m: string) => void,
): { entities: Entity[]; relations: Relation[] } {
  const statewide = agg.candidates.filter((c) => c.total >= 1000).length;
  log(`${meta.state}: kept ${agg.kept} itemized contributions since ${SINCE} (${agg.selfTransfers} own-committee transfers excluded); ${statewide} statewide candidates ≥ $1,000`);
  return buildFinanceEntities(meta, agg.candidates, agg.allDonors, lookup);
}

/** Donor type from a state's contributor-type text: individuals (incl. the candidate's own funds) vs everything else. */
export const isIndividual = (t: string) => /^(individual|self|candidate \(self\)|candidate\/spouse)/i.test(t.trim());
