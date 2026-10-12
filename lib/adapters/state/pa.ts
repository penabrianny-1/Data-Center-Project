import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import type { Adapter, AdapterContext } from "../../ingest/types";
import { addDonation, buildFinanceEntities, displayName, SINCE, type CandidateTotals, type Donor, type StatewideOffice } from "./contract";
import { cachedDownload, credit, CrossFilingDedupe, csvRecords, headerIndex, isSelf, lastModified, newCandidate, norm, splitCsv, zipLines } from "./al";

/**
 * Pennsylvania state campaign finance from the Department of State's annual
 * full exports ({YEAR}.zip of comma-delimited filer/contrib/debt/expense/
 * receipt files) at
 * https://www.pa.gov/agencies/dos/resources/voting-and-elections-resources/campaign-finance-data.
 *
 * robots.txt (checked 2026-10-12): www.pa.gov/robots.txt disallows only a form
 * page and two unrelated /content/dam/…/voting-and-elections/ folders
 * (directives-and-guidance/archived, voting-and-election-statistics); the
 * campaign-finance-data folder is allowed.
 *
 * Record layout: readme-cf-data.txt in the same folder lists the columns.
 *   Filer File: CampaignfinanceID, FILERID, EYEAR, SubmittedDate, CYCLE, AMMEND,
 *     TERMINATE, FILERTYPE, FILERNAME, OFFICE, DISTRICT, PARTY, …
 *   Contribution File: CampaignFinanceID, FilerID, EYEAR, SubmittedDate, CYCLE,
 *     Section, CONTRIBUTOR, ADDRESS1, ADDRESS2, CITY, STATE, ZIPCODE,
 *     OCCUPATION, ENAME (employer), …, CONTDATE1, CONTAMT1, CONTDATE2,
 *     CONTAMT2, CONTDATE3, CONTAMT3, CONTDESC
 * Each filer-file row is one filed report (CampaignfinanceID). The readme does
 * not expand the codes, so they are used conservatively:
 *  - OFFICE "GOV" / "LTG" are the Governor / Lieutenant Governor filers (the
 *    filers carrying them are Shapiro, Garrity, Davis etc. and their
 *    committees). Only those two offices are on the 2026 statewide ballot.
 *  - Section codes beginning "I" but not "II" are the contribution schedule
 *    (the form's Schedule I); "II…" rows (in-kind schedule) are left out.
 *  - Up to three dated amounts per contributor row are each counted.
 *  - A report flagged AMMEND = "Y" supersedes earlier reports by the same
 *    filer for the same election year and cycle; in addition a contribution
 *    repeated on more than one report is counted once.
 *  - The export has no contributor type, so organizations are recognized by
 *    their names (PAC, LLC, Inc., union, committee …); everyone else is
 *    treated as an individual.
 */

const DAM = "https://www.pa.gov/content/dam/copapwp-pagov/en/dos/resources/voting-and-elections/campaign-finance/campaign-finance-data";
const PAGE = "https://www.pa.gov/agencies/dos/resources/voting-and-elections-resources/campaign-finance-data";
const AGENCY = "Pennsylvania Department of State (Bureau of Campaign Finance)";
const YEARS = [2025, 2026];

export const PA_STATEWIDE: Record<string, StatewideOffice> = { GOV: "Governor", LTG: "Lieutenant Governor" };
/** Office codes treated as state offices for the all-candidate donor ranking. */
const PA_STATE_OFFICES = new Set(["GOV", "LTG", "ATT", "AUD", "TRE", "STS", "STH"]);

const ORG_RE = /\b(PAC|P\.?A\.?C|LLC|L\.?L\.?C|INC|CORP|CORPORATION|COMPANY|CO|LP|LLP|PC|PLLC|UNION|LOCAL|COUNCIL|ASSOCIATION|ASSN|ASSOC|COMMITTEE|CMTE|FUND|PARTY|FOR|FRIENDS|CAMPAIGN|TRUST|FOUNDATION|GROUP|PARTNERS|HOLDINGS|INDUSTRIES|ENTERPRISES|BANK|ACTION|POLITICAL|DEMOCRATIC|REPUBLICAN|FEDERATION|BROTHERHOOD|INTERNATIONAL|SOCIETY|LEAGUE|COALITION|VICTORY|LEADERSHIP|PENNSYLVANIANS|PENNSYLVANIA)\b/i;
const UNION_RE = /\b(COPE|AFSCME|SEIU|IBEW|UAW|AFL|CIO|AFT|PSEA|IUOE|UFCW|TEAMSTERS|LABORERS|CARPENTERS|STEAMFITTERS|PIPEFITTERS|ELECTRICAL WORKERS|EMPLOYEES)\b/i;
/** Organization if the name looks like one; otherwise an individual. */
export const paDonorType = (name: string): Donor["type"] => (ORG_RE.test(name) || UNION_RE.test(name) ? "ENTITY" : "INDIVIDUAL");

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

interface Report { id: string; filer: string; eyear: string; cycle: string; submitted: string; amend: boolean; type: string; name: string; office: string }

/** Reports superseded by a later amended report for the same filer, election year and cycle. */
export function supersededReports(reports: Report[]): Set<string> {
  const groups = new Map<string, Report[]>();
  for (const r of reports) {
    const k = `${r.filer}|${r.eyear}|${r.cycle}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.submitted.localeCompare(b.submitted) || Number(a.id) - Number(b.id));
    const lastAmend = g.map((r) => r.amend).lastIndexOf(true);
    for (let i = 0; i < lastAmend; i++) out.add(g[i].id);
  }
  return out;
}

/**
 * Statewide candidates and their committees: each FILERTYPE "1" filer with a
 * GOV/LTG office is a candidate (the filer name is the person); committee
 * filers with the same office are linked to the candidate whose last name
 * appears in the committee name (e.g. "Shapiro for Pennsylvania").
 */
export function paCandidates(reports: Report[]): Map<string, { candidate: string; name: string; office: StatewideOffice }> {
  const people = new Map<string, { name: string; office: StatewideOffice; last: string }>();
  for (const r of reports) {
    const office = PA_STATEWIDE[r.office];
    if (!office || r.type !== "1") continue;
    const name = displayName(r.name.replace(/,(\S)/, ", $1").replace(/\s+/g, " ").trim()).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
    const parts = norm(name).split(" ").filter((p) => !/^(JR|SR|II|III|IV)$/.test(p));
    people.set(r.filer, { name, office, last: parts[parts.length - 1] });
  }
  const filerToCand = new Map<string, { candidate: string; name: string; office: StatewideOffice }>();
  for (const [id, p] of people) filerToCand.set(id, { candidate: id, name: p.name, office: p.office });
  for (const r of reports) {
    const office = PA_STATEWIDE[r.office];
    if (!office || r.type === "1" || filerToCand.has(r.filer)) continue;
    const words = norm(r.name).split(" ");
    const matches = [...people].filter(([, p]) => p.office === office && words.includes(p.last));
    if (matches.length === 1) filerToCand.set(r.filer, { candidate: matches[0][0], name: matches[0][1].name, office });
  }
  return filerToCand;
}

function readReports(zipPath: string, year: number): Report[] {
  const name = `filer_${year}.txt`;
  const txt = strFromU8(unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: (f) => f.name === name })[name] ?? new Uint8Array(), true);
  const lines = txt.split(/\r?\n/);
  const ix = headerIndex(splitCsv(lines[0])!);
  const out: Report[] = [];
  for (const l of lines.slice(1)) {
    const f = l && splitCsv(l);
    if (!f) continue;
    out.push({
      id: f[ix.CampaignfinanceID], filer: f[ix.FILERID].trim(), eyear: f[ix.EYEAR], cycle: f[ix.CYCLE], submitted: f[ix.SubmittedDate],
      amend: f[ix.AMMEND] === "Y", type: f[ix.FILERTYPE], name: f[ix.FILERNAME], office: f[ix.OFFICE].trim(),
    });
  }
  return out;
}

async function run(ctx: AdapterContext) {
  const { log, lookup } = ctx;
  const zips: { year: number; path: string; version: string | null }[] = [];
  for (const y of YEARS) {
    const url = `${DAM}/${y}.zip`;
    zips.push({ year: y, ...(await cachedDownload(ctx.fetch, url, `pa-dos-cf-${y}.zip`, await lastModified(ctx.fetch, url), log)) });
  }
  const reports = zips.flatMap((z) => readReports(z.path, z.year));
  const superseded = supersededReports(reports);
  const officeOf = new Map<string, string>();
  for (const r of reports) if (r.office) officeOf.set(r.filer, r.office);
  const filerToCand = paCandidates(reports);
  const stateFilers = new Set([...officeOf].filter(([, o]) => PA_STATE_OFFICES.has(o)).map(([f]) => f));
  const ownNames = new Map<string, string[]>(); // candidate → own committee names
  for (const r of reports) {
    const c = filerToCand.get(r.filer);
    if (c) ownNames.set(c.candidate, [...new Set([...(ownNames.get(c.candidate) ?? []), r.name])]);
  }
  const cands = new Map<string, CandidateTotals>();
  for (const [filer, c] of filerToCand) {
    const t = cands.get(c.candidate) ?? newCandidate(c.candidate, c.name, c.office);
    t.committees.push(filer);
    cands.set(c.candidate, t);
  }
  log(`PA DOS: ${reports.length} reports (${superseded.size} superseded by amendments); ${cands.size} Governor/Lt. Governor candidates`);

  const allDonors = new Map<string, Donor>();
  const dedupe = new CrossFilingDedupe();
  let kept = 0;
  let self = 0;
  for (const z of zips) {
    let ix: Record<string, number> | null = null;
    const lines = (async function* () {
      for await (const { line } of zipLines(z.path, (n) => n === `contrib_${z.year}.txt`, "windows-1252")) yield line;
    })();
    for await (const f of csvRecords(lines)) {
      if (!ix) { ix = headerIndex(f); continue; }
      const filer = (f[ix.FilerID] ?? "").trim();
      if (!stateFilers.has(filer) || superseded.has(f[ix.CampaignFinanceID])) continue;
      const sec = f[ix.Section] ?? "";
      if (!/^I[A-Z]?$/.test(sec) || sec.startsWith("II")) continue;
      const name = (f[ix.CONTRIBUTOR] ?? "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      const cand = filerToCand.get(filer);
      if (cand && isSelf(name, cand.name, ownNames.get(cand.candidate))) { self++; continue; }
      const employer = (f[ix.ENAME] ?? "").trim();
      const d: Omit<Donor, "amount" | "count"> = {
        name, type: paDonorType(name), employer, occupation: (f[ix.OCCUPATION] ?? "").trim(),
        city: (f[ix.CITY] ?? "").trim(), state: (f[ix.STATE] ?? "").trim(),
      };
      for (const [dk, ak] of [["CONTDATE1", "CONTAMT1"], ["CONTDATE2", "CONTAMT2"], ["CONTDATE3", "CONTAMT3"]]) {
        const date = ymd((f[ix[dk]] ?? "").trim());
        const amount = Number(f[ix[ak]]);
        if (!date || date < SINCE || !(amount > 0)) continue;
        const recipient = cand?.candidate ?? filer;
        if (!dedupe.accept(recipient, name, date, amount, f[ix.CampaignFinanceID])) continue;
        kept++;
        addDonation(allDonors, d, amount);
        if (cand) credit(cands.get(cand.candidate)!, d, amount, date);
      }
    }
  }
  log(`PA DOS: kept ${kept} contributions to state candidates since ${SINCE}; ${dedupe.dropped} repeated across reports; ${self} self/own-committee rows excluded`);
  const dataAsOf = zips.map((z) => z.version).filter(Boolean).sort((a, b) => Date.parse(b!) - Date.parse(a!))[0] ?? null;
  return buildFinanceEntities({ state: "PA", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, [...cands.values()], allDonors, lookup);
}

export const adapters: Adapter[] = [
  {
    id: "state-pa-finance",
    name: "Pennsylvania Department of State: state campaign finance",
    url: PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Weekly (the state republishes the annual exports periodically; re-downloaded only when Last-Modified changes)",
    refreshMinutes: 10_080,
    coverage:
      "Pennsylvania state races. Itemized contributions since Jan. 1, 2025 to candidates for Governor and Lieutenant Governor (the only statewide offices on the 2026 ballot), counting the candidate's own filer account and committees named for them, plus the largest donors to all candidates for state office (statewide and legislature). The state republishes the export only periodically, so the most recent reports may be missing. Amended reports replace the originals, a contribution repeated on more than one report is counted once, and candidates' own money and transfers from their own committees are excluded. In-kind contributions aren't included, and because the export has no contributor type, organizations are recognized by name.",
    run,
  },
];
