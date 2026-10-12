import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createInflateRaw } from "node:zlib";
import type { Adapter, AdapterContext } from "../../ingest/types";
import { USER_AGENT } from "../../ingest/http";
import {
  addDonation, buildFinanceEntities, buildLobbyEntity, DATA_CENTER_RE, donorKey, SINCE,
  type CandidateTotals, type Donor, type LobbyClient, type StatewideOffice,
} from "./contract";

/**
 * California campaign finance and lobbying from the Secretary of State's
 * CAL-ACCESS raw export (official): one ZIP of tab-delimited tables, refreshed
 * daily. https://www.sos.ca.gov/campaign-lobbying/helpful-resources/raw-data-campaign-finance-and-lobbying-activity
 *
 * Access: robots.txt on www.sos.ca.gov is empty (nothing disallowed) and the
 * CDN host campaignfinance.cdn.sos.ca.gov serves no robots.txt (S3 AccessDenied).
 * The raw-data page offers the ZIP "to allow people with technical expertise to
 * create their own databases" and states no restriction on automated download.
 * Checked 2026-10-12.
 *
 * Field meanings below cite the official guides shipped in
 * calaccess-documentation.zip:
 *   [TABLES] DBInfo/CalAccessTablesWeb.pdf  "Cal-Access Tables, Columns, Indexes"
 *   [FAQ]    DBInfo/FAQ.pdf                 "Top 10 Frequently Asked Questions"
 *   [CAL]    CalFormat/cal_format_201.pdf   "CAL format 2.01" (code values)
 *   [F635]   Forms/635.pdf                  Form 635, Report of Lobbyist Employer
 *
 * The archive is ~1.6 GB compressed / ~10.5 GB uncompressed (RCPT_CD alone is
 * 3.9 GB), so members are inflated as streams one at a time and scanned line by
 * line; nothing larger than a line is held as a string.
 */

const PAGE = "https://www.sos.ca.gov/campaign-lobbying/helpful-resources/raw-data-campaign-finance-and-lobbying-activity";
const URL_ZIP = "https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip";
const CACHE = join(process.cwd(), "data", "cache");
const ZIP = join(CACHE, "calaccess-dbwebexport.zip");
const META = join(CACHE, "calaccess-dbwebexport.meta.json");
const AGENCY = "California Secretary of State (CAL-ACCESS)";
const DATA = "CalAccess/DATA/";
const UNTIL = [new Date().toISOString().slice(0, 10), "2026-12-31"].sort()[0];

// ---------------------------------------------------------------------------
// Code tables

/** [CAL] p.12 "Office codes used on forms & schedules", statewide offices on the 2026 ballot. */
export const STATEWIDE: Record<string, StatewideOffice> = {
  GOV: "Governor",
  LTG: "Lieutenant Governor",
  ATT: "Attorney General",
  SOS: "Secretary of State",
  TRE: "Treasurer",
  CON: "Comptroller", // "State Controller"
  INS: "Insurance Commissioner",
  SUP: "Superintendent of Education", // "Superintendent of Public Instruction"
};
/** [CAL] p.12 "State District Offices": State Senator, Assembly, Board of Equalization. */
const STATE_DISTRICT = new Set(["SEN", "ASM", "BOE"]);

/** Words the committee name must contain for each statewide office code (guards against mis-keyed office codes). */
const OFFICE_WORDS: Record<string, RegExp> = {
  GOV: /\bGOV(ERNOR)?\b/i,
  LTG: /\b(LT\.?|LIEUTENANT|LIEUT\.?)\s*GOV/i,
  ATT: /\bATTORNEY\s+GENERAL\b|\bA\.?G\.?\b/i,
  SOS: /\bSECRETARY\s+OF\s+STATE\b|\bSOS\b/i,
  TRE: /\bTREASURER\b/i,
  CON: /\bCONTROLLER\b/i,
  INS: /\bINSURANCE\b/i,
  SUP: /\bSUPERINTENDENT\b|\bSPI\b|\bPUBLIC\s+INSTRUCTION\b/i,
};

/**
 * Committee filer entity codes on the campaign cover page [CAL] p.10:
 * CAO = candidate/officeholder, CTL = controlled committee, RCP = recipient committee.
 * RCP covers that name a candidate are only accepted when the committee name contains the candidate's last name.
 */
const CANDIDATE_ENTITIES = new Set(["CAO", "CTL"]);
const NOT_CAMPAIGN = /\bBALLOT\s+MEASURE\b|\bOFFICE\s*HOLDER\b|\bLEGAL\s+DEFENSE\b|\bRECALL\b/i;

/** Bill codes recognised by CAL-ACCESS in lobbying activity descriptions [CAL] p.11. */
const BILL_RE = /\b(ACA|ACR|AJR|SCA|SCR|SJR|AB|AC|HR|SB|SR)\s*(X\s*\d\s*)?-?\s*(\d{1,4})\b/gi;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)

/** CAL-ACCESS dates look like "1/27/2000 12:00:00 AM" (or "01/01/2025"). Returns YYYY-MM-DD or null. */
export function calDate(s: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((s ?? "").trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Split a tab-delimited CAL-ACCESS row (CRLF terminated). */
export const splitTsv = (line: string): string[] => line.replace(/\r$/, "").split("\t");

export const headerIndex = (header: string): Record<string, number> =>
  Object.fromEntries(splitTsv(header).map((h, i) => [h.trim().toUpperCase(), i]));

/**
 * Latest amendment per filing. [FAQ] Q6: "Amendment number zero (0) represents the original filing ...
 * To find the most current amendment, find the maximum number for a given filing. Campaign amendments
 * replace the filing" and "Amendments to Lobbyist disclosure docs (i.e., 615, 625, 635, 645) are complete
 * replacements like their Campaign counterparts."
 */
export class LatestAmendments<T> {
  private readonly best = new Map<string, { amend: number; value: T }>();
  offer(filingId: string, amendId: string | number, value: T) {
    const amend = Number(amendId) || 0;
    const cur = this.best.get(filingId);
    if (!cur || amend > cur.amend) this.best.set(filingId, { amend, value });
  }
  /** True when (filing, amendment) is the current version of that filing. */
  isLatest(filingId: string, amendId: string | number) {
    const cur = this.best.get(filingId);
    return !!cur && cur.amend === (Number(amendId) || 0);
  }
  get(filingId: string) { return this.best.get(filingId)?.value; }
  amend(filingId: string) { return this.best.get(filingId)?.amend; }
  entries() { return [...this.best.entries()].map(([id, v]) => [id, v.value, v.amend] as const); }
  get size() { return this.best.size; }
}

/** Normalize an organization/committee name for matching. */
export const normOrg = (s: string) =>
  s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(THE|INC|INCORPORATED|LLC|LLP|LP|CORP|CORPORATION|CO|COMPANY|LTD)\b/g, " ").replace(/\s+/g, " ").trim();

/** Person key "FIRST|LAST" (first token of first name, last token of last name). */
export function personKey(last: string, first: string): string {
  const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\b(JR|SR|II|III|IV|DR|MR|MRS|MS|HON)\b\.?/g, " ").replace(/[^A-Z\s-]/g, " ").trim();
  const l = clean(last).split(/[\s-]+/).filter(Boolean).at(-1) ?? "";
  const f = clean(first).split(/\s+/).filter((p) => p.length > 1)[0] ?? clean(first).split(/\s+/)[0] ?? "";
  return `${f}|${l}`;
}

/**
 * Election year a committee is for. FPPC Regulation 18402 requires a candidate-controlled committee's name to
 * include the candidate's name, the office sought and the year of the election, so a 4-digit year in the
 * name wins; otherwise the cover page ELECT_DATE ("Date of the General Election", [TABLES] CVR_CAMPAIGN_DISCLOSURE).
 */
export function committeeElectionYear(name: string, electDate: string | null): number | null {
  const years = [...name.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length) return years.at(-1)!;
  return electDate ? Number(electDate.slice(0, 4)) : null;
}

export interface Cover {
  filingId: string;
  form: string;
  filerId: string;
  entity: string;
  filerName: string;
  candLast: string;
  candFirst: string;
  office: string;
  electDate: string | null;
  from: string | null;
  thru: string | null;
  rptDate: string | null;
}

export type CommitteeKind = { kind: "statewide"; office: StatewideOffice } | { kind: "state" } | null;

/** Is this (latest) F460 cover a candidate-controlled committee for a California state office, and is it a 2026 statewide campaign? */
export function classifyCommittee(c: Pick<Cover, "entity" | "filerName" | "candLast" | "candFirst" | "office" | "electDate">): CommitteeKind {
  if (!c.candLast.trim()) return null;
  if (NOT_CAMPAIGN.test(c.filerName)) return null;
  const isState = STATEWIDE[c.office] || STATE_DISTRICT.has(c.office);
  if (!isState) return null;
  const lastWord = personKey(c.candLast, c.candFirst).split("|")[1];
  if (!CANDIDATE_ENTITIES.has(c.entity)) {
    if (c.entity !== "RCP" || !lastWord || !normOrg(c.filerName).includes(lastWord)) return null;
  }
  const office = STATEWIDE[c.office];
  if (office && OFFICE_WORDS[c.office].test(c.filerName) && committeeElectionYear(c.filerName, c.electDate) === 2026) {
    return { kind: "statewide", office };
  }
  return { kind: "state" };
}

/** Donor from a RCPT (Schedule A/C) or S497 row. [CAL] p.11 RCPT entity codes: COM, RCP, IND, OTH, PTY, SCC. */
export function donorFrom(entityCd: string, last: string, first: string, city: string, st: string, emp: string, occ: string): Omit<Donor, "amount" | "count"> {
  const type = entityCd === "IND" ? "INDIVIDUAL" : "ENTITY";
  const name = (type === "INDIVIDUAL" ? [first, last] : [last, first]).map((s) => s.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  return { name, type, employer: emp.trim(), occupation: occ.trim(), city: city.trim(), state: st.trim() };
}

/** Bill numbers mentioned in a lobbying activity description, normalized "AB 123" / "SBX1 2". */
export function extractBills(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BILL_RE)) {
    const x = m[2] ? `X${m[2].replace(/\D/g, "")}` : "";
    out.add(`${m[1].toUpperCase()}${x} ${Number(m[3])}`);
  }
  return [...out];
}

/** Add an amount to a donor map, letting refunds (negative amounts, TRAN_TYPE R) reduce an existing total. */
export function applyAmount(map: Map<string, Donor>, d: Omit<Donor, "amount" | "count">, amount: number) {
  if (amount > 0) return addDonation(map, d, amount);
  const cur = map.get(donorKey(d));
  if (cur) cur.amount += amount;
}

// ---------------------------------------------------------------------------
// ZIP access (streamed, one member at a time)

interface ZipEntry { name: string; method: number; compSize: number; size: number; localOffset: number }

/** Parse the ZIP central directory (with ZIP64 records, which this >4 GB archive uses). */
export function readCentralDirectory(path: string): Map<string, ZipEntry> {
  const fd = openSync(path, "r");
  try {
    const fileSize = statSync(path).size;
    const tailLen = Math.min(fileSize, 66_000 + 22);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, fileSize - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("ZIP end of central directory not found (incomplete download?)");
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    let count = tail.readUInt16LE(eocd + 10);
    const loc = eocd - 20;
    if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
      const z64Off = Number(tail.readBigUInt64LE(loc + 8));
      const z = Buffer.alloc(56);
      readSync(fd, z, 0, 56, z64Off);
      if (z.readUInt32LE(0) === 0x06064b50) {
        count = Number(z.readBigUInt64LE(32));
        cdSize = Number(z.readBigUInt64LE(40));
        cdOffset = Number(z.readBigUInt64LE(48));
      }
    }
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);
    const out = new Map<string, ZipEntry>();
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(q)); }
        }
        e += 4 + len;
      }
      out.set(name, { name, method, compSize, size, localOffset });
      p = end + commentLen;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

/** Stream the lines of one archive member (inflated on the fly; bounded memory). */
async function* memberLines(path: string, entry: ZipEntry): AsyncGenerator<string> {
  const fd = openSync(path, "r");
  const lh = Buffer.alloc(30);
  readSync(fd, lh, 0, 30, entry.localOffset);
  closeSync(fd);
  if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const start = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  if (entry.compSize === 0) return;
  const raw = createReadStream(path, { start, end: start + entry.compSize - 1, highWaterMark: 1 << 20 });
  const src = entry.method === 8 ? raw.pipe(createInflateRaw({ chunkSize: 1 << 20 })) : raw;
  // CAL-ACCESS TSVs are mostly ASCII; decode as UTF-8 (invalid bytes become U+FFFD rather than failing).
  const dec = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of src as AsyncIterable<Buffer>) {
    const text = rest + dec.write(chunk);
    let from = 0;
    for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", from)) {
      yield text.slice(from, nl);
      from = nl + 1;
    }
    rest = text.slice(from);
  }
  rest += dec.end();
  if (rest) yield rest;
}

/**
 * Scan one table. `pre` is a cheap test on the raw line (before splitting) to skip rows early.
 * Rows shorter than the header are counted as malformed and skipped (a handful of CAL-ACCESS rows contain
 * stray line breaks inside free-text fields).
 */
async function scanTable(
  zip: Map<string, ZipEntry>, table: string,
  onRow: (f: string[], ix: Record<string, number>) => void,
  pre?: (line: string) => boolean,
): Promise<{ rows: number; malformed: number }> {
  const entry = zip.get(`${DATA}${table}.TSV`);
  if (!entry) throw new Error(`CAL-ACCESS archive has no ${table}.TSV (format change?)`);
  let ix: Record<string, number> | null = null;
  let width = 0;
  let rows = 0, malformed = 0;
  for await (const line of memberLines(ZIP, entry)) {
    if (!ix) { ix = headerIndex(line); width = Object.keys(ix).length; continue; }
    if (!line || (pre && !pre(line))) continue;
    const f = splitTsv(line);
    if (f.length < width - 1) { malformed++; continue; }
    rows++;
    onRow(f, ix);
  }
  return { rows, malformed };
}

const firstField = (line: string) => line.slice(0, line.indexOf("\t"));

let pending: Promise<string | null> | null = null;
/** Download the archive into data/cache only when the server's Last-Modified changes (shared by both adapters). */
function ensureZip(ctx: AdapterContext): Promise<string | null> {
  pending ??= (async () => {
    mkdirSync(CACHE, { recursive: true });
    const meta = existsSync(META) ? (JSON.parse(readFileSync(META, "utf8")) as { lastModified: string | null }) : null;
    const have = existsSync(ZIP) && statSync(ZIP).size > 1e9;
    let lm: string | null = null;
    try {
      lm = (await ctx.fetch(URL_ZIP, { method: "HEAD" })).headers.get("last-modified");
    } catch (e) {
      if (have) { ctx.log(`CAL-ACCESS HEAD failed (${(e as Error).message}); using cached archive`); return meta?.lastModified ?? statSync(ZIP).mtime.toUTCString(); }
      throw e;
    }
    if (have && meta?.lastModified === lm) return lm;
    ctx.log("Downloading CAL-ACCESS raw export (~1.6 GB)…");
    const res = await fetch(URL_ZIP, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`CAL-ACCESS download failed: ${res.status}`);
    const tmp = `${ZIP}.part`;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    renameSync(tmp, ZIP);
    writeFileSync(META, JSON.stringify({ lastModified: lm }));
    return lm;
  })();
  return pending;
}

const isoLm = (lm: string | null) => (lm && !Number.isNaN(Date.parse(lm)) ? new Date(lm).toISOString() : lm);

// ---------------------------------------------------------------------------
// Campaign finance

async function runFinance(ctx: AdapterContext) {
  const lm = await ensureZip(ctx);
  const zip = readCentralDirectory(ZIP);
  const warnings: string[] = [];

  // 1. Cover pages. [TABLES] CVR_CAMPAIGN_DISCLOSURE: one row per (FILING_ID, AMEND_ID); FORM_TYPE F460 =
  //    recipient committee campaign statement, F497 = late contribution report.
  const covers = new LatestAmendments<Cover | null>();
  const ownNames = new Map<string, Set<string>>(); // person key -> normalized names of every committee that names them as candidate
  const ownIds = new Map<string, Set<string>>(); // person key -> committee filer ids
  const cvr = await scanTable(zip, "CVR_CAMPAIGN_DISCLOSURE_CD", (f, ix) => {
    const form = f[ix.FORM_TYPE];
    if (form !== "F460" && form !== "F497") return;
    const fid = f[ix.FILING_ID];
    const cover: Cover = {
      filingId: fid, form, filerId: f[ix.FILER_ID].trim(), entity: f[ix.ENTITY_CD].trim().toUpperCase(),
      filerName: [f[ix.FILER_NAML], f[ix.FILER_NAMF]].map((s) => s.trim()).filter(Boolean).join(" "),
      candLast: f[ix.CAND_NAML] ?? "", candFirst: f[ix.CAND_NAMF] ?? "", office: (f[ix.OFFICE_CD] ?? "").trim().toUpperCase(),
      electDate: calDate(f[ix.ELECT_DATE]), from: calDate(f[ix.FROM_DATE]), thru: calDate(f[ix.THRU_DATE]), rptDate: calDate(f[ix.RPT_DATE]),
    };
    if (cover.candLast.trim()) {
      const pk = personKey(cover.candLast, cover.candFirst);
      (ownNames.get(pk) ?? ownNames.set(pk, new Set()).get(pk)!).add(normOrg(cover.filerName));
      (ownIds.get(pk) ?? ownIds.set(pk, new Set()).get(pk)!).add(cover.filerId);
    }
    const relevant = form === "F460" ? (cover.thru ?? "") >= SINCE : (cover.rptDate ?? "") >= SINCE;
    // Every amendment is offered so the maximum AMEND_ID wins even when it is an irrelevant row; only 2025+ covers keep data.
    covers.offer(fid, f[ix.AMEND_ID], relevant ? cover : null);
  });
  if (cvr.malformed) warnings.push(`CVR_CAMPAIGN_DISCLOSURE: ${cvr.malformed} malformed rows skipped`);

  // 2. Classify committees from their latest 2025+ F460 cover; keep current versions of their filings.
  const latest460 = new Map<string, Cover>(); // filer -> cover with latest period
  for (const [, c] of covers.entries()) {
    if (!c || c.form !== "F460") continue;
    const cur = latest460.get(c.filerId);
    if (!cur || (c.thru ?? "") > (cur.thru ?? "") || ((c.thru ?? "") === (cur.thru ?? "") && Number(c.filingId) > Number(cur.filingId))) latest460.set(c.filerId, c);
  }
  const committees = new Map<string, { kind: NonNullable<CommitteeKind>; pk: string; cover: Cover }>();
  for (const [filer, c] of latest460) {
    const k = classifyCommittee(c);
    if (k) committees.set(filer, { kind: k, pk: personKey(c.candLast, c.candFirst), cover: c });
  }
  // A committee sometimes files a second original for the same period instead of an amendment; keep the most recent filing per (filer, period).
  const byPeriod = new Map<string, Cover>();
  const accepted = new Map<string, { filer: string; form: string }>(); // filing id -> committee
  const lastThru = new Map<string, string>();
  let dupPeriods = 0;
  for (const [fid, c] of covers.entries()) {
    if (!c || !committees.has(c.filerId)) continue;
    if (c.form === "F460") {
      const key = `${c.filerId}|${c.from}|${c.thru}`;
      const prev = byPeriod.get(key);
      if (prev) {
        dupPeriods++;
        if (Number(prev.filingId) > Number(fid)) continue;
        accepted.delete(prev.filingId);
      }
      byPeriod.set(key, c);
      if ((c.thru ?? "") > (lastThru.get(c.filerId) ?? "")) lastThru.set(c.filerId, c.thru ?? "");
    }
    accepted.set(fid, { filer: c.filerId, form: c.form });
  }
  ctx.log(`CAL-ACCESS: ${committees.size} state candidate committees with 2025+ statements (${[...committees.values()].filter((c) => c.kind.kind === "statewide").length} for 2026 statewide offices); ${accepted.size} current filings; ${dupPeriods} duplicate-period 460s superseded`);

  const allDonors = new Map<string, Donor>();
  const cands = new Map<string, CandidateTotals & { perCommittee: Map<string, number>; nameVotes: Map<string, number> }>();
  let kept = 0, transfers = 0;
  const take = (filer: string, d: Omit<Donor, "amount" | "count">, cmteId: string, amount: number, date: string) => {
    const cm = committees.get(filer)!;
    // Transfers among a candidate's own committees (e.g. a prior-campaign committee moving money into the 2026 one) would double count.
    if (d.type === "ENTITY" && ((cmteId && ownIds.get(cm.pk)?.has(cmteId)) || ownNames.get(cm.pk)?.has(normOrg(d.name)))) { transfers++; return; }
    kept++;
    applyAmount(allDonors, d, amount);
    if (cm.kind.kind !== "statewide") return;
    const key = `${cm.kind.office}|${cm.pk}`;
    const display = `${cm.cover.candFirst.trim()} ${cm.cover.candLast.trim()}`.replace(/\s+/g, " ");
    const ca = cands.get(key) ?? {
      filerId: filer, name: display, office: cm.kind.office, total: 0, count: 0, fromEntities: 0, latest: null,
      donors: new Map(), committees: [], perCommittee: new Map(), nameVotes: new Map(),
    };
    ca.total += amount;
    if (amount > 0) ca.count++;
    if (d.type === "ENTITY") ca.fromEntities += amount;
    if (!ca.latest || date > ca.latest) ca.latest = date;
    applyAmount(ca.donors, d, amount);
    ca.perCommittee.set(filer, (ca.perCommittee.get(filer) ?? 0) + amount);
    // Prefer a mixed-case spelling of the candidate's name over SOS data-entry capitals.
    ca.nameVotes.set(display, (ca.nameVotes.get(display) ?? 0) + (display === display.toUpperCase() ? 1 : 1000));
    cands.set(key, ca);
  };

  // 3. Itemized receipts. [TABLES] RCPT: FORM_TYPE "Sched A, C, I, A-1, F401A"; Schedule A = monetary contributions,
  //    Schedule C = nonmonetary contributions (Form 460). MEMO_CODE "X" rows are informational sub-itemizations that
  //    "do not count toward any schedule or summary page dollar totals" ([CAL] p.17) and are skipped.
  const rc = await scanTable(zip, "RCPT_CD", (f, ix) => {
    const fid = f[ix.FILING_ID];
    if (!covers.isLatest(fid, f[ix.AMEND_ID])) return;
    const form = f[ix.FORM_TYPE].trim().toUpperCase();
    if (form !== "A" && form !== "C") return;
    if (f[ix.MEMO_CODE]?.trim().toUpperCase() === "X") return;
    const date = calDate(f[ix.RCPT_DATE]);
    if (!date || date < SINCE || date > UNTIL) return;
    const amount = Number(f[ix.AMOUNT]);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = donorFrom(f[ix.ENTITY_CD].trim().toUpperCase(), f[ix.CTRIB_NAML], f[ix.CTRIB_NAMF], f[ix.CTRIB_CITY], f[ix.CTRIB_ST], f[ix.CTRIB_EMP], f[ix.CTRIB_OCC]);
    take(accepted.get(fid)!.filer, d, f[ix.CMTE_ID]?.trim() ?? "", amount, date);
  }, (line) => { const a = accepted.get(firstField(line)); return !!a && a.form === "F460"; });
  if (rc.malformed) warnings.push(`RCPT: ${rc.malformed} malformed rows skipped`);
  const from460 = kept;

  // 4. Late contribution reports filed after a committee's most recent Form 460 period. [TABLES] S497: FORM_TYPE
  //    F497P1 = contributions received, F497P2 = made. Earlier 497 items are re-itemized on the next 460, so only
  //    contributions dated after the committee's latest 460 "through" date are added.
  await scanTable(zip, "S497_CD", (f, ix) => {
    const fid = f[ix.FILING_ID];
    if (!covers.isLatest(fid, f[ix.AMEND_ID]) || f[ix.FORM_TYPE].trim().toUpperCase() !== "F497P1") return;
    if (f[ix.MEMO_CODE]?.trim().toUpperCase() === "X") return;
    const filer = accepted.get(fid)!.filer;
    const date = calDate(f[ix.CTRIB_DATE]);
    if (!date || date < SINCE || date > UNTIL || date <= (lastThru.get(filer) ?? "")) return;
    const amount = Number(f[ix.AMOUNT]);
    if (!Number.isFinite(amount) || amount === 0) return;
    const d = donorFrom(f[ix.ENTITY_CD].trim().toUpperCase(), f[ix.ENTY_NAML], f[ix.ENTY_NAMF], f[ix.ENTY_CITY], f[ix.ENTY_ST], f[ix.CTRIB_EMP], f[ix.CTRIB_OCC]);
    take(filer, d, f[ix.CMTE_ID]?.trim() ?? "", amount, date);
  }, (line) => accepted.get(firstField(line))?.form === "F497");
  ctx.log(`CAL-ACCESS: kept ${from460} Form 460 itemizations + ${kept - from460} later Form 497 contributions since 2025; ${transfers} own-committee transfers excluded`);

  const candidates: CandidateTotals[] = [...cands.values()].map((c) => {
    const main = [...c.perCommittee].sort((a, b) => b[1] - a[1])[0][0];
    const name = [...c.nameVotes].sort((a, b) => b[1] - a[1])[0][0];
    return { filerId: main, name, office: c.office, total: c.total, count: c.count, fromEntities: c.fromEntities, latest: c.latest, donors: c.donors, committees: [...c.perCommittee.keys()] };
  });
  const { entities, relations } = buildFinanceEntities(
    { state: "CA", agency: AGENCY, sourceUrl: PAGE, dataAsOf: isoLm(lm) }, candidates, allDonors, ctx.lookup,
  );
  return { entities, relations, warnings };
}

// ---------------------------------------------------------------------------
// Lobbying

interface ClientAgg extends LobbyClient { ids: Set<string>; bills: Map<string, number>; interests: Set<string> }

async function runLobby(ctx: AdapterContext) {
  const lm = await ensureZip(ctx);
  const zip = readCentralDirectory(ZIP);
  const inPeriod = (d: string | null) => !!d && d >= SINCE && d <= UNTIL;

  // 1. Disclosure cover pages. [TABLES] CVR_LOBBY_DISCLOSURE: F615 lobbyist report, F625 lobbying firm report,
  //    F635 lobbyist employer / coalition report (ENTITY_CD LEM / LCO, [CAL] p.10), quarterly; LBY_ACTVTY =
  //    "Description of lobbying activity". FIRM_ID/FIRM_NAME on a F615 = the firm or employer the lobbyist reports through.
  interface LCover { form: string; filerId: string; name: string; firmId: string; firmName: string; activity: string }
  const lcov = new LatestAmendments<LCover | null>();
  await scanTable(zip, "CVR_LOBBY_DISCLOSURE_CD", (f, ix) => {
    const form = f[ix.FORM_TYPE].trim().toUpperCase();
    if (form !== "F615" && form !== "F625" && form !== "F635") return;
    const ok = inPeriod(calDate(f[ix.FROM_DATE]));
    lcov.offer(f[ix.FILING_ID], f[ix.AMEND_ID], ok ? {
      form, filerId: f[ix.FILER_ID].trim(), firmId: f[ix.FIRM_ID]?.trim() ?? "", firmName: f[ix.FIRM_NAME]?.trim() ?? "",
      name: (form === "F615" ? [f[ix.FILER_NAMF], f[ix.FILER_NAML]] : [f[ix.FILER_NAML], f[ix.FILER_NAMF]]).map((s) => s.trim()).filter(Boolean).join(" "),
      activity: f[ix.LBY_ACTVTY]?.trim() ?? "",
    } : null);
  });

  const clients = new Map<string, ClientAgg>();
  const client = (name: string): ClientAgg => {
    const k = normOrg(name);
    let c = clients.get(k);
    if (!c) {
      c = { name: name.trim(), amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: DATA_CENTER_RE.test(name), ids: new Set(), bills: new Map(), interests: new Set() };
      clients.set(k, c);
    }
    return c;
  };
  const addText = (c: ClientAgg, text: string) => {
    if (!text) return;
    if (DATA_CENTER_RE.test(text)) c.dataCenter = true;
    for (const b of extractBills(text)) c.bills.set(b, (c.bills.get(b) ?? 0) + 1);
  };
  const addFirm = (c: ClientAgg, firm: string) => { if (firm && !c.firms.some((x) => normOrg(x) === normOrg(firm))) c.firms.push(firm); };

  const employerFilings = new Map<string, ClientAgg>(); // F635 filing id -> employer
  const firmFilings = new Map<string, string>(); // F625 filing id -> firm name
  const lobbyistsByFirmId = new Map<string, Set<string>>();
  const firmIdByName = new Map<string, string>();
  for (const [fid, c] of lcov.entries()) {
    if (!c) continue;
    if (c.form === "F635") {
      const e = client(c.name);
      e.filings++;
      e.ids.add(c.filerId);
      addText(e, c.activity);
      employerFilings.set(fid, e);
    } else if (c.form === "F625") {
      firmFilings.set(fid, c.name);
      firmIdByName.set(normOrg(c.name), c.filerId);
    } else if (c.firmId) {
      (lobbyistsByFirmId.get(c.firmId) ?? lobbyistsByFirmId.set(c.firmId, new Set()).get(c.firmId)!).add(c.name);
    }
  }

  // 2. Employer totals. [TABLES] SMRY: summary totals per filing; [CAL] p.73 codes F635 lines A, B, C, D, ABCD, E; [F635]
  //    "Summary of payments this period": A in-house employee lobbyists, B lobbying firms, C activity expenses,
  //    D other payments to influence, GRAND TOTAL (A + B + C + D) = line ABCD. Line E (PUC activities) is not in the grand total.
  await scanTable(zip, "SMRY_CD", (f, ix) => {
    if (f[ix.FORM_TYPE].trim().toUpperCase() !== "F635" || f[ix.LINE_ITEM].trim().toUpperCase() !== "ABCD") return;
    if (!lcov.isLatest(f[ix.FILING_ID], f[ix.AMEND_ID])) return;
    const e = employerFilings.get(f[ix.FILING_ID]);
    const amt = Number(f[ix.AMOUNT_A]);
    if (e && Number.isFinite(amt)) e.amount = (e.amount ?? 0) + amt;
  }, (line) => employerFilings.has(firstField(line)));

  // 3. Firm <-> client links. [TABLES] LPAY: F625P2 = payments received by a firm from each employer (EMPLR_NAML =
  //    "Name of firm, employer, coalition"; LBY_ACTVTY = description of lobbying activity); F635P3B = an employer's payments to firms.
  const memoOwner = new Map<string, ClientAgg>(); // filing|memo ref -> client, for linked text memos
  await scanTable(zip, "LPAY_CD", (f, ix) => {
    const fid = f[ix.FILING_ID];
    if (!lcov.isLatest(fid, f[ix.AMEND_ID]) || f[ix.MEMO_CODE]?.trim().toUpperCase() === "X") return;
    const form = f[ix.FORM_TYPE].trim().toUpperCase();
    const other = [f[ix.EMPLR_NAML], f[ix.EMPLR_NAMF]].map((s) => s.trim()).filter(Boolean).join(" ");
    if (!other) return;
    let c: ClientAgg | undefined;
    if (form === "F625P2" && firmFilings.has(fid)) {
      c = client(other);
      addFirm(c, firmFilings.get(fid)!);
    } else if (form === "F635P3B" && employerFilings.has(fid)) {
      c = employerFilings.get(fid)!;
      addFirm(c, other);
    }
    if (!c) return;
    addText(c, f[ix.LBY_ACTVTY]?.trim() ?? "");
    const ref = f[ix.MEMO_REFNO]?.trim();
    if (ref) memoOwner.set(`${fid}|${ref}`, c);
  }, (line) => { const id = firstField(line); return firmFilings.has(id) || employerFilings.has(id); });

  // 4. 2025–26 registrations. [TABLES] CVR_REGISTRATION: F601 firm, F602 employer authorization of a firm,
  //    F603 employer/coalition, F604 lobbyist certification; LS_BEG_YR = year the legislative session begins.
  //    DESCRIP_1/DESCRIP_2/LOBBY_INT describe business activity and lobbying interests.
  const reg = new LatestAmendments<{ form: string; filerId: string; name: string; text: string } | null>();
  await scanTable(zip, "CVR_REGISTRATION_CD", (f, ix) => {
    const form = f[ix.FORM_TYPE].trim().toUpperCase();
    if (!/^F60[1-4]$/.test(form)) return;
    const session = f[ix.LS_BEG_YR]?.trim();
    const ok = session === "2025" || (!session && inPeriod(calDate(f[ix.RPT_DATE])));
    reg.offer(f[ix.FILING_ID], f[ix.AMEND_ID], ok ? {
      form, filerId: f[ix.FILER_ID].trim(), name: [f[ix.FILER_NAML], f[ix.FILER_NAMF]].map((s) => s.trim()).filter(Boolean).join(" "),
      text: [f[ix.DESCRIP_1], f[ix.DESCRIP_2], f[ix.LOBBY_INT]].map((s) => s?.trim() ?? "").filter(Boolean).join(" | "),
    } : null);
  });
  const registrants = new Set<string>();
  const firmRegs = new Map<string, string>(); // F601 filing id -> firm name
  for (const [fid, r] of reg.entries()) {
    if (!r) continue;
    registrants.add(r.filerId || `${r.form}:${normOrg(r.name)}`);
    if (r.form === "F601") firmRegs.set(fid, r.name);
    if (r.form === "F603" && r.text) {
      const c = clients.get(normOrg(r.name));
      if (c) { addText(c, r.text); c.interests.add(r.text.slice(0, 160)); }
    }
  }

  // 5. Clients listed on 2025–26 firm registrations. [TABLES] LEMP: "Lobbyist Employers/Subcontracted Clients data
  //    from Form 601 filings"; CLI_NAML = employing client, DESCRIP = "Description of employer/client lobbying interests".
  await scanTable(zip, "LEMP_CD", (f, ix) => {
    const fid = f[ix.FILING_ID];
    if (!reg.isLatest(fid, f[ix.AMEND_ID])) return;
    const name = [f[ix.CLI_NAML], f[ix.CLI_NAMF]].map((s) => s.trim()).filter(Boolean).join(" ");
    if (!name) return;
    const c = client(name);
    addFirm(c, firmRegs.get(fid)!);
    const desc = f[ix.DESCRIP]?.trim() ?? "";
    if (desc) { addText(c, desc); c.interests.add(desc.slice(0, 160)); }
  }, (line) => firmRegs.has(firstField(line)));

  // 6. Extended activity descriptions. [TABLES] TEXT_MEMO: "all text memos attached to electronic filings"; REF_NO links a
  //    memo to a specific record ([CAL] p.11: extra lobbying-activity description goes in a text memo).
  await scanTable(zip, "TEXT_MEMO_CD", (f, ix) => {
    const fid = f[ix.FILING_ID];
    if (!lcov.isLatest(fid, f[ix.AMEND_ID])) return;
    const text = f[ix.TEXT4000] ?? "";
    const c = memoOwner.get(`${fid}|${f[ix.REF_NO]?.trim()}`) ?? employerFilings.get(fid);
    if (c) addText(c, text);
  }, (line) => { const id = firstField(line); return employerFilings.has(id) || firmFilings.has(id); });

  // Lobbyists: in-house lobbyists report through their employer's id, contract lobbyists through their firm's id (F615 FIRM_ID).
  const out: LobbyClient[] = [];
  for (const c of clients.values()) {
    const lob = new Set<string>();
    for (const id of c.ids) for (const n of lobbyistsByFirmId.get(id) ?? []) lob.add(n);
    for (const firm of c.firms) { const id = firmIdByName.get(normOrg(firm)); for (const n of (id && lobbyistsByFirmId.get(id)) || []) lob.add(n); }
    const bills = [...c.bills].sort((a, b) => b[1] - a[1]).map(([b]) => b);
    out.push({
      name: c.name, amount: c.amount === null ? null : Math.round(c.amount * 100) / 100, filings: c.filings,
      lobbyists: [...lob].slice(0, 25), firms: c.firms.slice(0, 15),
      issues: [...[...c.interests].slice(0, 3), ...bills.slice(0, 20)], dataCenter: c.dataCenter,
    });
  }
  const entity = buildLobbyEntity({
    state: "CA", agency: AGENCY, sourceUrl: PAGE, dataAsOf: isoLm(lm), period: "2025–2026 legislative session",
    amountMeaning: "Lobbyist employer and coalition spending reported on Form 635 (grand total of payments to in-house lobbyists, payments to lobbying firms, activity expenses and other payments to influence), summed over 2025–26 quarterly reports, latest amendment of each",
  }, out, registrants.size);
  ctx.log(`CAL-ACCESS lobbying: ${employerFilings.size} employer reports, ${firmFilings.size} firm reports, ${registrants.size} registrants, ${out.length} clients (${out.filter((c) => c.dataCenter).length} mention data centers)`);
  return { entities: [entity] };
}

// ---------------------------------------------------------------------------

const common = {
  url: PAGE,
  sourceKind: "data" as const,
  method: "bulk" as const,
  schedule: "Daily (SOS rebuilds the export nightly; re-downloaded only when Last-Modified changes)",
  refreshMinutes: 1440,
};

export const adapters: Adapter[] = [
  {
    ...common,
    id: "state-ca-finance",
    name: "California Secretary of State (CAL-ACCESS): state campaign finance",
    coverage:
      "California state races only. Itemized 2025–2026 contributions (Form 460 Schedules A and C, plus Form 497 late contributions received after each committee's latest 460) to candidate committees for the 2026 statewide offices: Governor, Lieutenant Governor, Attorney General, Secretary of State, Treasurer, Controller, Insurance Commissioner and Superintendent of Public Instruction. Top donors cover all state candidate committees, legislature and Board of Equalization included. Only the latest amendment of each filing is used and transfers between a candidate's own committees are excluded. Unitemized contributions under $100, officeholder and ballot-measure committees a candidate controls, and independent expenditures aren't counted.",
    run: runFinance,
  },
  {
    ...common,
    id: "state-ca-lobby",
    name: "California Secretary of State (CAL-ACCESS): state lobbying",
    coverage:
      "California state lobbying for the 2025–26 session: lobbyist employers and coalitions with their reported Form 635 spending, the lobbying firms they pay (Forms 625 and 635) or that list them as clients (Form 601), lobbyists reporting through them (Form 615), bills named in activity descriptions, and whether any of their filings mention data centers. Firm-only clients without their own Form 635 show no dollar amount. Local lobbying isn't covered.",
    run: runLobby,
  },
];
