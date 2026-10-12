import type { Adapter, AdapterContext } from "../../ingest/types";
import { nameKey } from "../resolve";
import { addDonation, buildFinanceEntities, SINCE, type CandidateTotals, type Donor, type StatewideOffice } from "./contract";
import { cachedDownload, credit, CrossFilingDedupe, csvRecords, fileLines, headerIndex, isSelf, mdy, newCandidate } from "./al";

/**
 * New Mexico state campaign finance from the Secretary of State's Campaign
 * Finance Information System (CFIS) data download (CON_{YEAR}.csv,
 * contributions and loans, rebuilt daily).
 *
 * robots.txt (checked 2026-10-12): login.cfis.sos.state.nm.us/robots.txt
 * returns the SPA's 404 page (no rules). The download API needs no login and
 * served the CSVs to a plain scripted client without a challenge.
 *
 * Candidate offices come from the public "Explore Candidates" search
 * (POST /api/Organization/SearchCandidates, used by the CFIS site), matched to
 * the CSV's Candidate Last/First Name, because the CSV carries no office.
 *
 * Columns (CSV header): OrgID, Transaction Amount, Transaction Date, Last Name,
 * First Name, …, Contributor City, Contributor State, …, Filed Date, Election,
 * Report Name, Start of Period, End of Period, Contributor Code, Contribution
 * Type, Report Entity Type, Committee Name, Candidate Last Name, Candidate
 * First Name, …, Amended, Contributor Employer, Contributor Occupation. CFIS
 * publishes no separate layout document; fields are used as named.
 *
 * Amendments: each amended report is filed again under the same report name
 * and period, and the export carries both filings. Later filings usually add
 * only new items, but some repeat items from the original, so a contribution
 * (same contributor, date and amount) appearing on more than one filing of a
 * committee is counted once.
 */

const API = "https://login.cfis.sos.state.nm.us/api";
const PAGE = "https://login.cfis.sos.state.nm.us/#/dataDownload";
const AGENCY = "New Mexico Secretary of State (CFIS)";
const YEARS = [2025, 2026];

/** CFIS OfficeName → normalized office. Statewide offices on New Mexico's 2026 ballot. */
export const NM_STATEWIDE: Record<string, StatewideOffice> = {
  Governor: "Governor",
  "Lieutenant Governor": "Lieutenant Governor",
  "Attorney General": "Attorney General",
  "Secretary of State": "Secretary of State",
  "State Auditor": "Auditor",
  "State Treasurer": "Treasurer",
  "Commissioner of Public Lands": "Land Commissioner",
};

/** Contribution types that are gifts from a donor (loans, returns, transfers and anonymous gifts excluded). */
const GIFT_TYPES = new Set(["Contributions - Monetary", "Contributions - In-Kind", "Special Event"]);

export function nmRow(f: string[], ix: Record<string, number>) {
  if (f[ix["Report Entity Type"]] !== "Candidate") return null;
  if (/^test/i.test(f[ix["Candidate First Name"]] ?? "") || /^test/i.test(f[ix["Candidate Last Name"]] ?? "")) return null; // CFIS test accounts present in the export
  if (!GIFT_TYPES.has(f[ix["Contribution Type"]])) return null;
  const date = mdy(f[ix["Transaction Date"]]);
  const amount = Number(f[ix["Transaction Amount"]]);
  if (!date || date < SINCE || !(amount > 0)) return null;
  const last = (f[ix["Last Name"]] ?? "").trim();
  const first = (f[ix["First Name"]] ?? "").trim();
  const name = [first, (f[ix["Middle Name"]] ?? "").trim(), last, (f[ix.Suffix] ?? "").trim()].filter(Boolean).join(" ").replace(/\s+/g, " ");
  if (!name) return null;
  const code = f[ix["Contributor Code"]];
  const type: Donor["type"] = code === "Individual" || ((code === "Candidate" || code === "Candidate/Officeholder" || !code) && !!first) ? "INDIVIDUAL" : "ENTITY";
  return {
    orgId: f[ix.OrgID],
    candidate: `${f[ix["Candidate First Name"]] ?? ""} ${f[ix["Candidate Last Name"]] ?? ""}`.replace(/\s+/g, " ").trim(),
    donor: {
      name: type === "ENTITY" ? last || name : name, type,
      employer: (f[ix["Contributor Employer"]] ?? "").trim(), occupation: (f[ix["Contributor Occupation"]] ?? "").trim(),
      city: (f[ix["Contributor City"]] ?? "").trim(), state: (f[ix["Contributor State"]] ?? "").trim(),
    } as Omit<Donor, "amount" | "count">,
    date, amount,
    filing: `${f[ix["Report Name"]]}|${f[ix["Start of Period"]]}|${f[ix["Filed Date"]]}`,
  };
}

interface NmCandidate { CandidateName: string; OfficeName: string; ElectionYear: number; Status: string }

/** Last-name key (CFIS search names are "Last, First Middle"). */
export const nmLast = (last: string) => nameKey(last).last;

/** Same first name, allowing a short form ("Deb" / "Debra"): one must start the other, at least 3 letters. */
export function sameFirst(a: string, b: string): boolean {
  const x = nameKey(a).first;
  const y = nameKey(b).first;
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 3 && l.startsWith(s);
}

async function statewideCandidates(ctx: AdapterContext): Promise<Map<string, { first: string; name: string; office: StatewideOffice }[]>> {
  const res = await ctx.fetch(`${API}/Organization/SearchCandidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ElectionYear: "2026", pageNumber: "1", pageSize: 5000, sortDir: "", sortedBy: "" }),
  });
  const list = (await res.json()) as NmCandidate[];
  const out = new Map<string, { first: string; name: string; office: StatewideOffice }[]>();
  for (const c of list) {
    const office = NM_STATEWIDE[c.OfficeName];
    if (!office) continue;
    const [last, first = ""] = c.CandidateName.split(/,\s*/);
    const k = nmLast(last);
    out.set(k, [...(out.get(k) ?? []), { first, name: `${first.split(" ")[0]} ${last}`.trim(), office }]);
  }
  return out;
}

async function run(ctx: AdapterContext) {
  const { log, lookup } = ctx;
  const listing = (await (await ctx.fetch(`${API}/DataDownload/GetCheckDatadownload?pageNumber=1&pageSize=100&sortDir=Desc&sortedBy=`)).json()) as { PSTTime: string; NameOfFile: string | null }[];
  // The listing's last row carries the time CFIS last rebuilt the files.
  const builtAt = listing.find((r) => !r.NameOfFile)?.PSTTime ?? null;
  const statewide = await statewideCandidates(ctx);
  log(`CFIS: ${[...statewide.values()].flat().length} 2026 statewide candidates`);
  const cands = new Map<string, CandidateTotals>();
  const allDonors = new Map<string, Donor>();
  const dedupe = new CrossFilingDedupe();
  let kept = 0;
  let self = 0;
  for (const y of YEARS) {
    const url = `${API}/DataDownload/GetCSVDownloadReport?year=${y}&transactionType=CON&reportFormat=csv&fileName=CON_${y}.csv`;
    const { path } = await cachedDownload(ctx.fetch, url, `nm-cfis-CON_${y}.csv`, builtAt, log);
    let ix: Record<string, number> | null = null;
    for await (const f of csvRecords(fileLines(path))) {
      if (!ix) { ix = headerIndex(f); continue; }
      const r = nmRow(f, ix);
      if (!r) continue;
      if (isSelf(r.donor.name, r.candidate)) { self++; continue; }
      if (!dedupe.accept(r.orgId, r.donor.name, r.date, r.amount, r.filing)) continue;
      kept++;
      addDonation(allDonors, r.donor, r.amount);
      const candFirst = f[ix["Candidate First Name"]] ?? "";
      const sw = statewide.get(nmLast(f[ix["Candidate Last Name"]] ?? ""))?.find((s) => sameFirst(s.first, candFirst));
      if (!sw) continue;
      const c = cands.get(r.orgId) ?? newCandidate(r.orgId, r.candidate || sw.name, sw.office, [r.orgId]);
      cands.set(r.orgId, c);
      credit(c, r.donor, r.amount, r.date);
    }
  }
  log(`CFIS: kept ${kept} candidate contributions since ${SINCE}; ${dedupe.dropped} repeated across filings; ${self} self-funding rows excluded`);
  return buildFinanceEntities({ state: "NM", agency: AGENCY, sourceUrl: PAGE, dataAsOf: builtAt }, [...cands.values()], allDonors, lookup);
}

export const adapters: Adapter[] = [
  {
    id: "state-nm-finance",
    name: "New Mexico Secretary of State: state campaign finance (CFIS)",
    url: PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Daily (CFIS rebuilds the files nightly; re-downloaded only when the rebuild time changes)",
    refreshMinutes: 1440,
    coverage:
      "New Mexico races. Itemized contributions (money, in-kind and special-event) since Jan. 1, 2025 to candidates for Governor, Lieutenant Governor, Attorney General, Secretary of State, Auditor, Treasurer and Land Commissioner, plus the largest donors to all candidates filing with CFIS (state, judicial and county). A contribution repeated on more than one filing of a report is counted once; loans, returned contributions, transfers between a candidate's own accounts and candidates' own money are excluded. Offices come from CFIS's 2026 candidate search, matched by last and first name.",
    run,
  },
];
