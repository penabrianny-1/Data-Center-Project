import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { Adapter, AdapterContext } from "../../ingest/types";
import { addDonation, buildFinanceEntities, displayName, SINCE, type CandidateTotals, type Donor, type StatewideOffice } from "./contract";
import { CACHE_DIR, cachedDownload, credit, headerIndex, isSelf, lastModified, mdy, newCandidate, zipLines } from "./al";

/**
 * Massachusetts state campaign finance from OCPF's bulk data files
 * (ocpf-{YEAR}-reports.zip and ocpf-filers.zip on OCPF's Azure blob store,
 * linked from https://www.ocpf.us/Data).
 *
 * robots.txt (checked 2026-10-12): www.ocpf.us/robots.txt is "User-agent: *
 * Disallow:" (everything allowed); ocpf2.blob.core.windows.net has no
 * robots.txt (404). The files download without any challenge. (The Imperva
 * bot wall noted in the source map is on sec.state.ma.us, the Secretary of the
 * Commonwealth's lobbying search, not OCPF.) If a download is ever blocked,
 * save the three zips by hand to data/cache/ under the names below and set
 * MA_OCPF_LOCAL=1; the adapter then processes the local copies.
 *
 * Record layout: readme.txt inside each reports zip ("CURRENT REPORT DATA …
 * The records found in the accompanying files are from the latest version of
 * reports. Data from reports that have been amended has been excluded.").
 * Items are joined to reports.txt on Report_ID; the report's CPF_ID is the
 * filer. Record_Type_ID per the readme: 201 Individual Contribution,
 * 202 Committee Contribution, 203 Union/Association Contribution,
 * 211 Business/Corporation Contribution, 401/402/403/405 the matching in-kind
 * contributions. 220/420 (aggregated un-itemized), 204 (non-contribution
 * receipt), 206 (candidate loan), 207 (transfer from savings) and the rest are
 * not contributions from a donor and are skipped.
 */

const BLOB = "https://ocpf2.blob.core.windows.net/downloads/data2";
const PAGE = "https://www.ocpf.us/Data";
const AGENCY = "Massachusetts Office of Campaign and Political Finance (OCPF)";
const YEARS = [2025, 2026];

export const MA_CONTRIB_TYPES: Record<string, Donor["type"]> = {
  "201": "INDIVIDUAL", "401": "INDIVIDUAL",
  "202": "ENTITY", "402": "ENTITY",
  "203": "ENTITY", "403": "ENTITY",
  "211": "ENTITY", "405": "ENTITY",
};

/** Statewide offices on the 2026 ballot, as OCPF's "District Name Sought" for Office Type "Statewide". */
export const MA_STATEWIDE: Record<string, StatewideOffice> = {
  Governor: "Governor",
  "Lieutenant Governor": "Lieutenant Governor",
  "Attorney General": "Attorney General",
  "Secretary of State": "Secretary of State",
  "Treasurer of the Commonwealth": "Treasurer",
  Auditor: "Auditor",
};
/** Office types counted as state (not municipal/county) candidates for the all-candidate donor ranking. */
const STATE_OFFICE_TYPES = new Set(["Statewide", "House", "Senate", "Governor's Council"]);

/** OCPF text fields are tab-separated and wrapped in double quotes. */
export const splitOcpf = (line: string) => line.split("\t").map((v) => v.replace(/^"([\s\S]*)"$/, "$1").trim());

async function zipPath(ctx: AdapterContext, file: string): Promise<{ path: string; version: string | null }> {
  if (ctx.env.MA_OCPF_LOCAL) {
    const path = join(CACHE_DIR, file);
    if (!existsSync(path)) throw new Error(`MA_OCPF_LOCAL is set but data/cache/${file} is missing; download it from ${BLOB}/${file}`);
    return { path, version: statSync(path).mtime.toISOString() };
  }
  const url = `${BLOB}/${file}`;
  return cachedDownload(ctx.fetch, url, `ma-${file}`, await lastModified(ctx.fetch, url), ctx.log);
}

async function run(ctx: AdapterContext) {
  const { log, lookup } = ctx;
  const filersZip = await zipPath(ctx, "ocpf-filers.zip");
  const txt = strFromU8(unzipSync(new Uint8Array(readFileSync(filersZip.path)), { filter: (f) => f.name === "candidates.txt" })["candidates.txt"]);
  const lines = txt.split(/\r?\n/);
  const fi = headerIndex(splitOcpf(lines[0]));
  const cands = new Map<string, CandidateTotals>();
  const stateCands = new Map<string, string>(); // CPF ID → candidate name
  for (const l of lines.slice(1)) {
    if (!l.trim()) continue;
    const f = splitOcpf(l);
    if (!STATE_OFFICE_TYPES.has(f[fi["Office Type Sought"]])) continue;
    const id = f[fi["CPF ID"]];
    const name = displayName(`${f[fi["Candidate First Name"]]} ${f[fi["Candidate Last Name"]]}`);
    stateCands.set(id, name);
    const office = f[fi["Office Type Sought"]] === "Statewide" ? MA_STATEWIDE[f[fi["District Name Sought"]]] : undefined;
    if (office && !f[fi["Closed Date"]]) cands.set(id, newCandidate(id, name, office, [id]));
  }
  log(`OCPF: ${stateCands.size} state-office candidates, ${cands.size} open statewide committees`);

  const allDonors = new Map<string, Donor>();
  let kept = 0;
  let self = 0;
  let dataAsOf: string | null = null;
  for (const y of YEARS) {
    const { path, version } = await zipPath(ctx, `ocpf-${y}-reports.zip`);
    dataAsOf = version;
    const reportFiler = new Map<string, string>(); // Report_ID → CPF_ID (state candidates only)
    let rix: Record<string, number> | null = null;
    let iix: Record<string, number> | null = null;
    // reports.txt precedes report-items.txt in OCPF's archives; reports are read first regardless.
    for await (const { line } of zipLines(path, (n) => n === "reports.txt", "windows-1252")) {
      const f = splitOcpf(line);
      if (!rix) { rix = headerIndex(f); continue; }
      if (stateCands.has(f[rix.CPF_ID])) reportFiler.set(f[rix.Report_ID], f[rix.CPF_ID]);
    }
    for await (const { line } of zipLines(path, (n) => n === "report-items.txt", "windows-1252")) {
      const f = splitOcpf(line);
      if (!iix) { iix = headerIndex(f); continue; }
      const type = MA_CONTRIB_TYPES[f[iix.Record_Type_ID]];
      if (!type) continue;
      const cpf = reportFiler.get(f[iix.Report_ID]);
      if (!cpf) continue;
      const date = mdy(f[iix.Date]);
      const amount = Number(f[iix.Amount]);
      if (!date || date < SINCE || !(amount > 0)) continue;
      const name = type === "INDIVIDUAL" ? `${f[iix.First_Name]} ${f[iix.Name]}`.replace(/\s+/g, " ").trim() : f[iix.Name].replace(/\s+/g, " ").trim();
      if (!name) continue;
      // Candidate's own money, or money from the candidate's own committee
      if (f[iix.Related_CPF_ID] === cpf || (type === "INDIVIDUAL" && isSelf(name, stateCands.get(cpf)!))) { self++; continue; }
      const d: Omit<Donor, "amount" | "count"> = {
        name, type, employer: type === "INDIVIDUAL" ? f[iix.Employer] ?? "" : "", occupation: type === "INDIVIDUAL" ? f[iix.Occupation] ?? "" : "",
        city: f[iix.City] ?? "", state: f[iix.State] ?? "",
      };
      kept++;
      addDonation(allDonors, d, amount);
      const c = cands.get(cpf);
      if (c) credit(c, d, amount, date);
    }
  }
  log(`OCPF: kept ${kept} itemized contributions to state candidates since ${SINCE}; ${self} self-funding/own-committee items excluded`);
  return buildFinanceEntities({ state: "MA", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, [...cands.values()], allDonors, lookup);
}

export const adapters: Adapter[] = [
  {
    id: "state-ma-finance",
    name: "Massachusetts OCPF: state campaign finance",
    url: PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Daily (OCPF rebuilds the files nightly; re-downloaded only when Last-Modified changes)",
    refreshMinutes: 1440,
    coverage:
      "Massachusetts state races. Itemized contributions (money and in-kind) since Jan. 1, 2025 to candidates for Governor, Lieutenant Governor, Attorney General, Secretary of the Commonwealth, Treasurer and Auditor, plus the largest donors to all candidates for state office (statewide, legislature, Governor's Council). OCPF's files hold only the latest version of each report, so amended originals are already excluded. Candidates' own money and transfers from their own committees are excluded. Un-itemized receipts (under $50 a year from one source), loans and savings transfers aren't included; super PAC spending isn't counted.",
    run,
  },
];
