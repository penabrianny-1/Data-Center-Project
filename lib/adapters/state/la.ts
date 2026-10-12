import type { Adapter, AdapterContext } from "../../ingest/types";
import { addDonation, buildFinanceEntities, SINCE, type Donor } from "./contract";
import { cachedDownload, csvRecords, CrossFilingDedupe, fileLines, headerIndex, isSelf, lastModified, mdy } from "./al";

/**
 * Louisiana state campaign finance from the Board of Ethics' e-filed data
 * download (Contributions_2024_to_2027.csv, refreshed daily).
 *
 * Louisiana has no statewide executive office on the 2026 ballot (Governor,
 * Lieutenant Governor, Attorney General, Secretary of State, Treasurer and the
 * other statewide offices are next elected in fall 2027), so this adapter
 * produces no statewide-candidate records. It publishes the largest donors to
 * all candidates who file with the Board (state and local) since 2025-01-01.
 *
 * robots.txt (checked 2026-10-12): www.ethics.la.gov/robots.txt returns the
 * site's "Page not found" HTML (no rules). The CSV is a static file with a
 * Last-Modified header.
 *
 * The download has no published record layout; columns are used by their
 * header names (FilerNumber, FilerLastName, FilerFirstName, ReportCode,
 * ReportType, ReportNumber, ContributorTypeCode, ContributorName,
 * ContributorCity, ContributorrState, ContributionType, ContributionDate,
 * ContributionAmt). Form numbers follow the Board's filing forms: Form 102 is
 * the candidate's report and Form 103 the candidate's special report;
 * Form 202 is a political committee's report.
 */

const URL_CSV = "https://www.ethics.la.gov/Pub/CampFinan/DataDownload/ContributionReports/Contributions_2024_to_2027.csv";
const PAGE = "https://www.ethics.la.gov/CampaignFinanceSearch/ShowPremadereports.aspx";
const AGENCY = "Louisiana Board of Ethics";

/**
 * Filter + classification for one contribution row. Exported for tests.
 * - Candidate reports only (ReportCode F102). Special reports (ReportType
 *   SPCL, Forms 103/203) repeat contributions that are reported again on the
 *   next regular report, so they are skipped.
 * - ContributionType CONTRIB (money) and IN-KIND; OTHER (interest, refunds) and
 *   ANON (no donor) are skipped.
 * - ContributorTypeCode IND (individual) and CAN (candidate) are people; every
 *   other code is treated as an organization. The Board does not publish the
 *   code list, so no further meaning is assumed.
 */
export function laRow(f: string[], ix: Record<string, number>): { recipient: string; candidate: string; donor: Omit<Donor, "amount" | "count">; date: string; amount: number; filing: string } | null {
  if (f[ix.ReportCode] !== "F102" || f[ix.ReportType] === "SPCL") return null;
  const ctype = f[ix.ContributionType];
  if (ctype !== "CONTRIB" && ctype !== "IN-KIND") return null;
  const date = mdy(f[ix.ContributionDate]);
  const amount = Number(f[ix.ContributionAmt]);
  if (!date || date < SINCE || !(amount > 0)) return null;
  const name = (f[ix.ContributorName] ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const code = f[ix.ContributorTypeCode];
  const candidate = `${f[ix.FilerFirstName] ?? ""} ${f[ix.FilerLastName] ?? ""}`.replace(/\s+/g, " ").trim();
  return {
    recipient: f[ix.FilerNumber],
    candidate,
    donor: { name, type: code === "IND" || code === "CAN" ? "INDIVIDUAL" : "ENTITY", employer: "", occupation: "", city: (f[ix.ContributorCity] ?? "").trim(), state: (f[ix.ContributorrState] ?? "").trim() },
    date,
    amount,
    filing: f[ix.ReportNumber],
  };
}

async function run(ctx: AdapterContext) {
  const { log, lookup } = ctx;
  const lm = await lastModified(ctx.fetch, URL_CSV);
  const { path, version } = await cachedDownload(ctx.fetch, URL_CSV, "la-ethics-contributions-2024-2027.csv", lm, log);
  const allDonors = new Map<string, Donor>();
  const dedupe = new CrossFilingDedupe();
  let ix: Record<string, number> | null = null;
  let kept = 0;
  let self = 0;
  for await (const f of csvRecords(fileLines(path))) {
    if (!ix) { ix = headerIndex(f); continue; }
    const r = laRow(f, ix);
    if (!r) continue;
    // Candidate's own money, or a transfer from the candidate's own campaign fund
    if (isSelf(r.donor.name, r.candidate) || (r.donor.type === "ENTITY" && isSelf(r.donor.name.replace(/\b(CAMPAIGN|COMMITTEE|FUND|FRIENDS OF|CMTE|TO ELECT|FOR)\b/gi, " "), r.candidate))) { self++; continue; }
    if (!dedupe.accept(r.recipient, r.donor.name, r.date, r.amount, r.filing)) continue;
    kept++;
    addDonation(allDonors, r.donor, r.amount);
  }
  log(`LA Ethics: kept ${kept} candidate contributions since ${SINCE}; ${dedupe.dropped} repeated across reports; ${self} self-funding/own-committee rows excluded`);
  const out = buildFinanceEntities({ state: "LA", agency: AGENCY, sourceUrl: PAGE, dataAsOf: version }, [], allDonors, lookup);
  return { ...out, warnings: ["Louisiana has no statewide executive race in 2026 (next in 2027); only top donors to all Louisiana candidates are published."] };
}

export const adapters: Adapter[] = [
  {
    id: "state-la-finance",
    name: "Louisiana Board of Ethics: campaign finance (e-filed)",
    url: PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Daily (re-downloaded only when the file's Last-Modified changes)",
    refreshMinutes: 1440,
    coverage:
      "Louisiana has no statewide executive race in 2026 (the next Governor, Attorney General and other statewide elections are in 2027), so there are no statewide candidate totals. Shows the largest donors since Jan. 1, 2025 to all candidates who file with the Board of Ethics, state and local. Covers e-filed candidate reports only; scanned paper reports aren't included. Special (10-day/48-hour) reports are skipped because their contributions are repeated on the next regular report, a contribution repeated on more than one report is counted once, and candidates' own money is excluded. The Board's export has no amendment flag.",
    run,
  },
];
