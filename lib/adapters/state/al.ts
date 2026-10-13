import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate, unzlibSync } from "fflate";
import { HTTP_CLIENT_ID } from "../../ingest/http";
import type { Adapter, AdapterContext } from "../../ingest/types";
import {
  addDonation, buildFinanceEntities, buildLobbyEntity, DATA_CENTER_RE, displayName, SINCE,
  type CandidateTotals, type Donor, type LobbyClient, type StatewideOffice,
} from "./contract";

/**
 * Alabama: campaign finance from the Secretary of State's FCPA Reporting
 * System bulk downloads, and lobbying registrations from the Alabama Ethics
 * Commission's public lists.
 *
 * This module also holds the small shared helpers (cached downloads,
 * streaming line readers, CSV splitting, cross-filing de-duplication, a
 * minimal .xls reader) used by the la/ma/mi/nm/pa adapters.
 *
 * robots.txt (checked 2026-10-12): fcpa.alabamavotes.gov/robots.txt redirects
 * to a login page (no rules published); ethics-form.alabama.gov/robots.txt is
 * a 404. Neither host shows a CAPTCHA or bot wall to scripted clients.
 */

// ---------------------------------------------------------------------------
// Shared helpers

export const CACHE_DIR = join(process.cwd(), "data", "cache");

type FetchFn = AdapterContext["fetch"];

/**
 * Download `url` to data/cache/<file> unless the cached copy matches `version`
 * (a Last-Modified header or the publisher's own "last updated" stamp). Streams
 * to disk, so memory stays bounded regardless of file size.
 */
export async function cachedDownload(
  fetchFn: FetchFn,
  url: string,
  file: string,
  version: string | null,
  log: (m: string) => void,
  init?: RequestInit,
): Promise<{ path: string; version: string | null }> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, file);
  const metaPath = `${path}.meta.json`;
  const meta = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")) as { lastModified: string | null }) : null;
  if (existsSync(path) && statSync(path).size > 0 && version && meta?.lastModified === version) return { path, version };
  log(`Downloading ${file}…`);
  const tmp = `${path}.${process.pid}.part`;
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, retries: 2 });
    if (!res.body) throw new Error(`empty body for ${url}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  } catch (err) {
    // ctx.fetch aborts after 60 s including the body, which some bulk files
    // (e.g. CFIS's 100 MB CSVs) exceed. Retry once with a longer deadline,
    // same request identity header, the way the other bulk adapters download large archives.
    if (!(err instanceof Error) || (err.name !== "TimeoutError" && err.name !== "AbortError")) throw err;
    log(`  ${file}: slow transfer, retrying with a 15-minute deadline`);
    res = await fetch(url, { ...init, headers: { "User-Agent": HTTP_CLIENT_ID, ...init?.headers }, signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} for ${url}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  }
  renameSync(tmp, path);
  const v = version ?? res.headers.get("last-modified");
  writeFileSync(metaPath, JSON.stringify({ lastModified: v, fetchedAt: new Date().toISOString() }));
  return { path, version: v };
}

/** HEAD request for Last-Modified (null if the server doesn't send one). */
export async function lastModified(fetchFn: FetchFn, url: string): Promise<string | null> {
  try {
    return (await fetchFn(url, { method: "HEAD", retries: 1 })).headers.get("last-modified");
  } catch {
    return null;
  }
}

/** Splits a decoded text stream into lines (CR stripped). */
class LineSplitter {
  private tail = "";
  private dec: TextDecoder;
  constructor(encoding: string) {
    this.dec = new TextDecoder(encoding);
  }
  push(chunk: Uint8Array, final: boolean, out: string[]) {
    const text = this.tail + this.dec.decode(chunk, { stream: !final });
    const parts = text.split("\n");
    this.tail = final ? "" : parts.pop()!;
    for (const p of parts) out.push(p.endsWith("\r") ? p.slice(0, -1) : p);
    if (final && out.length && out[out.length - 1] === "") out.pop();
  }
}

/** Lines of a local text file, streamed. */
export async function* fileLines(path: string, encoding = "utf-8"): AsyncGenerator<string> {
  const sp = new LineSplitter(encoding);
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    const out: string[] = [];
    sp.push(chunk as Uint8Array, false, out);
    yield* out;
  }
  const out: string[] = [];
  sp.push(new Uint8Array(0), true, out);
  yield* out;
}

/** Lines of the zip members accepted by `match`, streamed (members in archive order). */
export async function* zipLines(path: string, match: (name: string) => boolean, encoding = "utf-8"): AsyncGenerator<{ member: string; line: string }> {
  let queue: { member: string; line: string }[] = [];
  const errors: unknown[] = [];
  const uz = new Unzip((file) => {
    if (!match(file.name)) return;
    const sp = new LineSplitter(encoding);
    file.ondata = (err, data, final) => {
      if (err) return void errors.push(err);
      const out: string[] = [];
      sp.push(data, final, out);
      for (const line of out) queue.push({ member: file.name, line });
    };
    file.start();
  });
  uz.register(UnzipInflate);
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    uz.push(chunk as Uint8Array);
    if (errors.length) throw errors[0];
    const q = queue;
    queue = [];
    yield* q;
  }
  uz.push(new Uint8Array(0), true);
  if (errors.length) throw errors[0];
  yield* queue;
}

/**
 * Quote-aware CSV splitting for one physical line. Returns null when a quoted
 * field is still open at the end of the line (the record continues on the
 * next line); callers append "\n" + next line and retry.
 */
export function splitCsv(line: string, delim = ","): string[] | null {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  if (quoted) return null;
  out.push(field);
  return out;
}

/** Re-joins physical lines into CSV records (fields may contain quoted newlines). */
export async function* csvRecords(lines: AsyncIterable<string>, delim = ","): AsyncGenerator<string[]> {
  let pending: string | null = null;
  for await (const line of lines) {
    const text: string = pending === null ? line : `${pending}\n${line}`;
    const f = splitCsv(text, delim);
    if (f) {
      pending = null;
      yield f;
    } else if (text.length > 100_000) pending = null; // runaway quote: drop rather than buffer the file
    else pending = text;
  }
}

/** Header → column index. */
export const headerIndex = (h: string[]) => Object.fromEntries(h.map((x, i) => [x.replace(/^﻿/, "").trim(), i])) as Record<string, number>;

/** Uppercase, strip punctuation and collapse spaces (for name comparisons). */
export const norm = (s: string) => s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Counts each itemized transaction once when a filer reports the same
 * contribution (same contributor, date and amount) on more than one filing,
 * as happens when an amended or follow-up report repeats items from an
 * earlier one. Repeats within a single filing are kept (they are separate
 * contributions).
 */
export class CrossFilingDedupe {
  private seen = new Map<string, string>();
  dropped = 0;
  /** true if this transaction should be counted */
  accept(recipient: string, contributor: string, date: string, amount: number, filing: string): boolean {
    const k = `${recipient}|${norm(contributor)}|${date}|${amount.toFixed(2)}`;
    const prev = this.seen.get(k);
    if (prev === undefined) {
      this.seen.set(k, filing);
      return true;
    }
    if (prev === filing) return true;
    this.dropped++;
    return false;
  }
}

/** Whether a contributor is the candidate (personal funds) or one of the candidate's own committees. */
export function isSelf(contributor: string, candidateName: string, ownCommittees: string[] = []): boolean {
  const c = norm(contributor);
  if (!c) return false;
  if (ownCommittees.some((n) => norm(n) === c)) return true;
  const parts = norm(candidateName).split(" ").filter((p) => p.length > 1 && !/^(JR|SR|II|III|IV)$/.test(p));
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1];
  const cp = c.split(" ").filter((p) => !/^(JR|SR|II|III|IV)$/.test(p));
  if (!cp.includes(last) || !cp.includes(parts[0])) return false;
  // "Last First", "First M Last", "Last, First" — or the candidate's own committee, e.g. "Aric Nesbitt for State Senate"
  return cp.length <= parts.length + 2 || /\b(FOR|COMMITTEE|CMTE|FRIENDS|ELECT|CAMPAIGN|FUND)\b/.test(c);
}

/** MM/DD/YYYY (optionally followed by a time) → YYYY-MM-DD */
export function mdy(s: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s ?? "");
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export function newCandidate(filerId: string, name: string, office: StatewideOffice, committees: string[] = []): CandidateTotals {
  return { filerId, name, office, total: 0, count: 0, fromEntities: 0, latest: null, donors: new Map(), committees };
}

export function credit(c: CandidateTotals, d: Omit<Donor, "amount" | "count">, amount: number, date: string) {
  c.total += amount;
  c.count++;
  if (d.type === "ENTITY") c.fromEntities += amount;
  if (!c.latest || date > c.latest) c.latest = date;
  addDonation(c.donors, d, amount);
}

/**
 * Minimal reader for legacy Excel .xls files (OLE compound document holding
 * a BIFF8 "Workbook" stream). Returns the cell text of the first worksheet.
 * Handles shared strings (SST/CONTINUE), LABEL, NUMBER, RK and MULRK cells,
 * which covers report-generator exports like the Alabama Ethics lists.
 */
export function readXls(buf: Uint8Array): string[][] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0xe011cfd0) throw new Error("not an OLE compound file");
  const secSize = 1 << dv.getUint16(0x1e, true);
  const off = (s: number) => 512 + s * secSize;
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) difat.push(dv.getInt32(0x4c + i * 4, true));
  let dif = dv.getInt32(0x44, true);
  for (let n = dv.getUint32(0x48, true); n > 0 && dif >= 0; n--) {
    for (let i = 0; i < secSize / 4 - 1; i++) difat.push(dv.getInt32(off(dif) + i * 4, true));
    dif = dv.getInt32(off(dif) + secSize - 4, true);
  }
  const fat: number[] = [];
  for (const s of difat.slice(0, dv.getUint32(0x2c, true))) for (let i = 0; i < secSize / 4; i++) fat.push(dv.getInt32(off(s) + i * 4, true));
  const chain = (start: number) => {
    const secs: number[] = [];
    for (let s = start; s >= 0 && secs.length <= fat.length; s = fat[s]) secs.push(s);
    const out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(buf.subarray(off(s), off(s) + secSize), i * secSize));
    return out;
  };
  const dir = chain(dv.getInt32(0x30, true));
  const ddv = new DataView(dir.buffer);
  let wb: Uint8Array | null = null;
  for (let e = 0; e + 128 <= dir.length; e += 128) {
    const nlen = ddv.getUint16(e + 0x40, true);
    let name = "";
    for (let i = 0; i < nlen / 2 - 1; i++) name += String.fromCharCode(ddv.getUint16(e + i * 2, true));
    if (name === "Workbook" || name === "Book") {
      const size = ddv.getUint32(e + 0x78, true);
      if (size < dv.getUint32(0x38, true)) throw new Error("workbook stored in mini stream is not supported");
      wb = chain(ddv.getInt32(e + 0x74, true)).subarray(0, size);
    }
  }
  if (!wb) throw new Error("no Workbook stream");
  const w = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const sst: string[] = [];
  const rows: string[][] = [];
  const set = (r: number, c: number, v: string) => ((rows[r] ??= [])[c] = v);
  const rk = (v: number) => {
    let n: number;
    if (v & 2) n = v >> 2;
    else {
      const b = new DataView(new ArrayBuffer(8));
      b.setUint32(4, v & 0xfffffffc, true);
      n = b.getFloat64(0, true);
    }
    return v & 1 ? n / 100 : n;
  };
  let pos = 0;
  let sheet = -2; // first BOF opens the workbook globals (-1), the second the first worksheet (0)
  while (pos + 4 <= wb.length) {
    const type = w.getUint16(pos, true);
    const len = w.getUint16(pos + 2, true);
    const start = pos + 4;
    pos = start + len;
    if (pos > wb.length) break;
    if (type === 0x0809) {
      if (++sheet > 0) break;
      continue;
    }
    if (type === 0x00fc) {
      const segs: [number, number][] = [[start, start + len]];
      while (pos + 4 <= wb.length && w.getUint16(pos, true) === 0x003c) {
        const l = w.getUint16(pos + 2, true);
        segs.push([pos + 4, pos + 4 + l]);
        pos += 4 + l;
      }
      let si = 0;
      let p = start + 8;
      const next = () => {
        if (p >= segs[si][1] && si + 1 < segs.length) p = segs[++si][0];
      };
      const skip = (n: number) => {
        while (n > 0 && si < segs.length) {
          next();
          const k = Math.min(n, segs[si][1] - p);
          if (k <= 0) break;
          p += k;
          n -= k;
        }
      };
      const total = w.getUint32(start + 4, true);
      for (let s = 0; s < total && si < segs.length; s++) {
        next();
        const cch = w.getUint16(p, true);
        p += 2;
        next();
        let flags = wb[p++];
        let runs = 0;
        let ext = 0;
        if (flags & 8) { next(); runs = w.getUint16(p, true); p += 2; }
        if (flags & 4) { next(); ext = w.getUint32(p, true); p += 4; }
        let str = "";
        for (let left = cch; left > 0;) {
          if (p >= segs[si][1]) {
            if (si + 1 >= segs.length) break;
            p = segs[++si][0];
            flags = wb[p++]; // a string continued in a CONTINUE record restates its width flag
          }
          const hi = flags & 1;
          const k = Math.min(left, Math.floor((segs[si][1] - p) / (hi ? 2 : 1)));
          for (let i = 0; i < k; i++) str += String.fromCharCode(hi ? w.getUint16(p + i * 2, true) : wb[p + i]);
          p += k * (hi ? 2 : 1);
          left -= k;
        }
        skip(runs * 4 + ext);
        sst.push(str);
      }
      continue;
    }
    if (sheet !== 0 || len < 6) continue;
    const r = w.getUint16(start, true);
    const c = w.getUint16(start + 2, true);
    if (type === 0x00fd) set(r, c, sst[w.getUint32(start + 6, true)] ?? "");
    else if (type === 0x0203) set(r, c, String(w.getFloat64(start + 6, true)));
    else if (type === 0x027e) set(r, c, String(rk(w.getInt32(start + 6, true))));
    else if (type === 0x00bd) {
      const last = w.getUint16(start + len - 2, true);
      for (let k = 0; c + k <= last; k++) set(r, c + k, String(rk(w.getInt32(start + 4 + k * 6 + 2, true))));
    } else if (type === 0x0204) {
      const cch = w.getUint16(start + 6, true);
      const hi = wb[start + 8] & 1;
      let s = "";
      for (let i = 0; i < cch; i++) s += String.fromCharCode(hi ? w.getUint16(start + 9 + i * 2, true) : wb[start + 9 + i]);
      set(r, c, s);
    }
  }
  return Array.from(rows, (row) => Array.from(row ?? [], (v) => v ?? ""));
}

// ---------------------------------------------------------------------------
// Alabama campaign finance

const AL_BASE = "https://fcpa.alabamavotes.gov/page.request.do";
const AL_PAGE = `${AL_BASE}?page=page.acfPublicDownloadData`;
const AL_LIST = `${AL_BASE}?page=com.acf.common.page.transactiondatadownloadsresults&pageSize=100`;
const AL_AGENCY = "Alabama Secretary of State (FCPA Reporting System)";

/**
 * Office ids from the FCPA "Principal Campaign Committee Search" office list
 * (page.acfPublicPrincipalCampaignCommitteeSearch). Statewide offices on the
 * 2026 Alabama ballot: Governor, Lt. Governor, Attorney General, Secretary of
 * State, State Treasurer, State Auditor, Commissioner of Agriculture &
 * Industries and Public Service Commissioner (Places 1 and 2).
 */
export const AL_STATEWIDE: Record<string, StatewideOffice> = {
  "23": "Governor",
  "26": "Lieutenant Governor",
  "3": "Attorney General",
  "36": "Secretary of State",
  "42": "Treasurer",
  "38": "Auditor",
  "10": "Agriculture Commissioner",
  "31": "Utility / Corporation Commissioner",
};
/** Other state-level offices whose candidates count toward "all state candidates". */
const AL_OTHER_STATE = ["40", "41", "39", "32", "34", "35", "9", "19"]; // State Rep, State Senator, State BOE, PSC President, Supreme Court, appellate courts

interface AlCommittee { committeeId: string; candidateFirstName?: string; candidateLastName?: string; office: string; committeeStatus?: string }

/**
 * Cash Contributions File Layout (FCPA "Download Data File Key",
 * page.request.do?page=getResource&resource=cashContributionsExportLayout):
 * A ORG ID (recipient committee), B CONTRIBUTION AMOUNT, C CONTRIBUTION DATE,
 * D LAST NAME ("If not an individual, the entity full name will be in LAST
 * NAME field"), E FIRST NAME, F MI, G SUFFIX, H ADDRESS, I CITY, J STATE,
 * K ZIP, L CONTRIBUTION ID (unique), M FILED DATE, N CONTRIBUTION TYPE,
 * O CONTRIBUTOR TYPE, P COMMITTEE TYPE, Q COMMITTEE NAME, R CANDIDATE NAME,
 * S AMENDED ("Y/N indicator to show if an amendment was filed for this record").
 *
 * The file is comma-separated without quoting; addresses occasionally contain
 * line breaks, so a short row is joined with the following line(s). Rows that
 * come out with extra columns (an unquoted comma inside a value) are skipped
 * and counted.
 */
export const AL_COLS = 19;
export async function* alRows(lines: AsyncIterable<string>): AsyncGenerator<string[] | "bad"> {
  let header = true;
  let pending: string[] | null = null;
  for await (const line of lines) {
    if (header) { header = false; continue; }
    let f = line.split(",");
    if (pending) {
      const joined = [...pending.slice(0, -1), `${pending[pending.length - 1]} ${f[0]}`, ...f.slice(1)];
      f = joined;
      pending = null;
    }
    if (f.length < AL_COLS) { pending = f; continue; }
    yield f.length === AL_COLS ? f : "bad";
  }
}

export function alDonor(f: string[]): Omit<Donor, "amount" | "count"> | null {
  const ctype = f[14].trim();
  if (ctype === "Returned (Cash Only)") return null;
  const last = f[3].trim();
  const first = f[4].trim();
  const type: Donor["type"] = ctype === "Individual" || (!ctype && first) ? "INDIVIDUAL" : "ENTITY";
  // SUFFIX (column G) is left out: in practice it often repeats one value across a committee's whole report.
  const name = type === "INDIVIDUAL" ? [first, f[5].trim(), last].filter(Boolean).join(" ") : last;
  if (!name) return null;
  return { name: name.replace(/\s+/g, " "), type, employer: "", occupation: "", city: f[8].trim(), state: f[9].trim() };
}

async function alCommittees(ctx: AdapterContext, officeId: string): Promise<AlCommittee[]> {
  const out: AlCommittee[] = [];
  for (let page = 1; page < 40; page++) {
    const criteria = JSON.stringify([
      { field_key: "office", comparison_type: "equalTo", comparison_value_1: officeId },
      { field_key: "committeeType", comparison_type: "equalTo", comparison_value_1: "1" }, // pccTypeId: principal campaign committee
    ]);
    const qs = new URLSearchParams({ page: "com.acf.common.page.committeesearchresults", pageNumber: String(page), pageSize: "500", sortDirection: "ASC", sortBy: "candidateLastName", criteria });
    const j = (await (await ctx.fetch(`${AL_BASE}?${qs}`)).json()) as { data: { list: AlCommittee[]; totalRecords: number } };
    out.push(...j.data.list);
    if (out.length >= j.data.totalRecords || !j.data.list.length) break;
  }
  return out;
}

async function runAlFinance(ctx: AdapterContext) {
  const { log, lookup } = ctx;
  const listing = (await (await ctx.fetch(AL_LIST)).json()) as { data: { list: { DATATYPE: string; YEAR: number; LASTUPDATEDRAW: string; DOWNLOAD: number }[] } };
  const files = listing.data.list.filter((r) => r.DATATYPE === "Cash Contribution" && r.YEAR >= 2025);
  if (!files.length) throw new Error("FCPA listing has no 2025–26 Cash Contribution files");

  // Which committees are statewide candidates (and which are state-level at all)
  const cands = new Map<string, CandidateTotals>();
  const stateLevel = new Set<string>();
  for (const [id, office] of Object.entries(AL_STATEWIDE)) {
    for (const c of await alCommittees(ctx, id)) {
      stateLevel.add(c.committeeId);
      const name = displayName([c.candidateFirstName, c.candidateLastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      cands.set(c.committeeId, newCandidate(c.committeeId, name.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()), office, [c.committeeId]));
    }
  }
  for (const id of AL_OTHER_STATE) for (const c of await alCommittees(ctx, id)) stateLevel.add(c.committeeId);
  log(`FCPA: ${cands.size} statewide-office committees, ${stateLevel.size} state-level committees`);

  const allDonors = new Map<string, Donor>();
  const dedupe = new CrossFilingDedupe();
  let dataAsOf: string | null = null;
  let bad = 0;
  let kept = 0;
  for (const f of files.sort((a, b) => a.YEAR - b.YEAR)) {
    const { path } = await cachedDownload(ctx.fetch, `${AL_BASE}?page=getTransactionData&id=${f.DOWNLOAD}`, `al-fcpa-cash-${f.YEAR}.zip`, f.LASTUPDATEDRAW, log);
    dataAsOf = f.LASTUPDATEDRAW;
    for await (const row of alRows(mapLines(zipLines(path, (n) => /\.csv$/i.test(n), "windows-1252")))) {
      if (row === "bad") { bad++; continue; }
      // Itemized contributions only (cash and in-kind); non-itemized lumps have no donor.
      if (!/^(Cash|In-Kind) \(Itemized\)$/.test(row[13].trim())) continue;
      if (row[15].trim() !== "Principal Campaign Committee" || !stateLevel.has(row[0])) continue;
      const date = mdy(row[2]);
      const amt = Number(row[1]);
      if (!date || date < SINCE || !(amt > 0)) continue;
      const d = alDonor(row);
      if (!d) continue;
      const cand = cands.get(row[0]);
      const candName = row[17].trim() || cand?.name || "";
      if (isSelf(d.name, candName, [row[16]])) continue;
      if (!dedupe.accept(row[0], d.name, date, amt, row[12])) continue;
      kept++;
      addDonation(allDonors, d, amt);
      if (cand) credit(cand, d, amt, date);
    }
  }
  log(`FCPA: kept ${kept} itemized contributions to state candidates since ${SINCE}; ${dedupe.dropped} repeated across filings; ${bad} malformed rows skipped`);
  const warnings = bad ? [`${bad} FCPA rows had unquoted commas inside values and were skipped`] : [];
  return {
    ...buildFinanceEntities({ state: "AL", agency: AL_AGENCY, sourceUrl: AL_PAGE, dataAsOf }, [...cands.values()], allDonors, lookup),
    warnings,
  };
}

/** Adapts {member,line} records to plain lines. */
async function* mapLines(src: AsyncIterable<{ line: string }>): AsyncGenerator<string> {
  for await (const r of src) yield r.line;
}

// ---------------------------------------------------------------------------
// Alabama lobbying

const AL_LOBBY_PAGE = "https://ethics.alabama.gov/lobbyists.aspx";
const AL_LOBBY_BASE = "https://ethics-form.alabama.gov/entity/FileUpload2015/RegisteredLobbyist";

/** Text runs (font, x, string) from an uncompressed PDF content stream, in order. */
export function pdfTextRuns(content: string): { font: string; size: number; x: number; text: string }[] {
  const out: { font: string; size: number; x: number; text: string }[] = [];
  const re = /\/(F\d+)\s+([\d.]+)\s+Tf[^(]*?([\d.]+)\s+([\d.]+)\s+Td\s*\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  for (let m; (m = re.exec(content));) {
    const text = m[5].replace(/\\([()\\])/g, "$1").replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\s+/g, " ").trim();
    out.push({ font: m[1], size: Number(m[2]), x: Number(m[3]), text });
  }
  return out;
}

/**
 * The "Registered Lobbyist List" PDF prints each lobbyist's name in the left
 * column (larger bold font at the left margin) followed by address lines and,
 * in the right column, the principals that lobbyist represents. Returns
 * lobbyist → principals.
 */
export function parseAlLobbyistPdf(buf: Uint8Array): Map<string, string[]> {
  const s = Buffer.from(buf).toString("latin1");
  const map = new Map<string, string[]>();
  let current: string | null = null;
  const re = /stream\r?\n/g;
  for (let m; (m = re.exec(s));) {
    const st = m.index + m[0].length;
    const en = s.indexOf("endstream", st);
    if (en < 0) break;
    let content: string;
    try {
      content = Buffer.from(unzlibSync(buf.subarray(st, en))).toString("latin1");
    } catch {
      continue;
    }
    const runs = pdfTextRuns(content);
    if (!runs.length) continue;
    const nameSize = Math.max(...runs.filter((r) => r.x < 100 && r.size < 12).map((r) => r.size));
    for (const r of runs) {
      // The closing page is the Commission's contact block, not a lobbyist entry.
      if (/please contact our office/i.test(r.text)) return map;
      if (/^\d+ of \d+$/.test(r.text)) continue; // page footer
      if (r.x < 100 && r.size === nameSize && !/^Updated:|REGISTERED LOBBYIST LIST/i.test(r.text)) {
        current = r.text;
        if (!map.has(current)) map.set(current, []);
      } else if (current && r.x > 200 && r.size < nameSize && !/^\d{3}-\d{3}-\d{4}$/.test(r.text)) {
        map.get(current)!.push(r.text);
      }
    }
  }
  return map;
}

async function runAlLobby(ctx: AdapterContext) {
  const { log } = ctx;
  const lob = await cachedDownload(ctx.fetch, `${AL_LOBBY_BASE}/WebDataLobbyistsPDF_2010.aspx`, "al-ethics-lobbyists.pdf", null, log);
  const pri = await cachedDownload(ctx.fetch, `${AL_LOBBY_BASE}/rptPrincipalsListing_Excel.aspx`, "al-ethics-principals.xls", null, log);
  const byLobbyist = parseAlLobbyistPdf(new Uint8Array(readFileSync(lob.path)));
  const principals = readXls(new Uint8Array(readFileSync(pri.path)));
  const hdr = principals.findIndex((r) => r[0] === "Principal Name");
  const clients = new Map<string, LobbyClient>();
  const client = (name: string) => {
    const k = norm(name);
    const c = clients.get(k) ?? { name: name.trim(), amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: DATA_CENTER_RE.test(name) };
    clients.set(k, c);
    return c;
  };
  for (const r of principals.slice(hdr + 1)) if (r[0]?.trim()) client(r[0]).filings++;
  for (const [lobbyist, ps] of byLobbyist) {
    for (const p of ps) {
      const c = client(p);
      if (!c.lobbyists.includes(lobbyist)) c.lobbyists.push(lobbyist);
    }
  }
  // No spending is disclosed in these lists, so rank by number of registered lobbyists.
  const ranked = [...clients.values()].map((c) => ({ ...c, filings: Math.max(c.filings, c.lobbyists.length) }));
  log(`AL Ethics: ${byLobbyist.size} registered lobbyists, ${clients.size} principals`);
  return {
    entities: [
      buildLobbyEntity(
        {
          state: "AL", agency: "Alabama Ethics Commission", sourceUrl: AL_LOBBY_PAGE, dataAsOf: new Date().toISOString().slice(0, 10),
          amountMeaning: null, period: `${new Date().getFullYear()} registrations`,
        },
        ranked,
        byLobbyist.size,
      ),
    ],
  };
}

export const adapters: Adapter[] = [
  {
    id: "state-al-finance",
    name: "Alabama Secretary of State: state campaign finance (FCPA)",
    url: AL_PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Daily (FCPA rebuilds the files nightly; re-downloaded only when the published 'last updated' stamp changes)",
    refreshMinutes: 1440,
    coverage:
      "Alabama state races. Itemized cash and in-kind contributions since Jan. 1, 2025 to principal campaign committees of candidates for Governor, Lieutenant Governor, Attorney General, Secretary of State, Treasurer, Auditor, Agriculture Commissioner and Public Service Commission, plus the largest donors to all state-level candidates (legislature, State Board of Education and appellate courts included). Office is the one the committee registered for. A contribution repeated on more than one filing is counted once; candidates' own money and transfers from their own committees are excluded. PAC-to-PAC money and non-itemized receipts aren't included.",
    dependsOn: ["curated"],
    run: runAlFinance,
  },
  {
    id: "state-al-lobby",
    name: "Alabama Ethics Commission: registered lobbyists and principals",
    url: AL_LOBBY_PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Weekly",
    refreshMinutes: 10_080,
    coverage:
      "Current-year Alabama lobbyist and principal registrations: which principals (clients) are registered and which lobbyists represent each. The lists carry no dollar amounts; Alabama's quarterly spending reports are only in the Ethics Commission's per-filer search, with no bulk file. Data-center flags come from principal names only.",
    run: runAlLobby,
  },
];

