import type { Adapter } from "../../ingest/types";
import type { StatewideOffice } from "./contract";
import {
  aggregate, bulkYears, fetchZipText, finish, forEachCsvRecord, isIndividual, isoDate, officeResolver,
  requireColumns, titleCase, type KnownCandidate, type Receipt,
} from "./co-in-ok-ne";

/**
 * Indiana state campaign finance from the Election Division's bulk downloads
 * (https://campaignfinance.in.gov/PublicSite/Reporting/DataDownload.aspx):
 * {YEAR}_ContributionData.csv.zip, which the page labels by filing date
 * ("Contribution Data (Filed 1/1/2026 - 12/31/2026)"). The page's hrefs use a
 * backslash before the file name; the forward-slash URL serves the same file.
 *
 * Indiana publishes no record-layout document for these files (unlike its
 * sister TRACER/Guardian/NADC sites), so only self-describing headers are
 * used: FileNumber (recipient committee), CommitteeType, Committee,
 * CandidateName, ContributorType, Name, City, State, Occupation, Type,
 * Amount, ContributionDate, Amended. Type separates "Direct" itemized
 * contributions from "Unitemized" lump sums, In-Kind, Loan, Misc, Interest and
 * Debt rows; only Direct is kept. Amended is "0" on almost every row and "1"
 * on a few; following the same platform's documented meaning elsewhere ("an
 * amendment was filed for this record"), rows marked 1 are treated as
 * superseded and dropped (under 0.3% of rows). The export has unescaped
 * quotes and line breaks inside fields, so the lenient CSV reader is used.
 * No employer field is published.
 *
 * Indiana's governor and attorney general are elected in presidential years;
 * the 2026 statewide offices are Secretary of State, Treasurer and Comptroller
 * (the former Auditor of State).
 *
 * campaignfinance.in.gov serves no robots.txt (404, checked 2026-10-12).
 */

const PAGE = "https://campaignfinance.in.gov/PublicSite/Reporting/DataDownload.aspx";
const zipUrl = (y: string) => `https://campaignfinance.in.gov/PublicSite/Docs/BulkDataDownloads/${y}_ContributionData.csv.zip`;
const AGENCY = "Indiana Election Division (Campaign Finance)";

const BALLOT: StatewideOffice[] = ["Secretary of State", "Treasurer", "Comptroller"];

/**
 * 2026 convention candidates. Republican nominees per the Indiana Republican
 * Party's June 20, 2026 convention releases (https://indiana.gop/news/);
 * Democratic candidates per the Indiana Democratic Party 2026 convention
 * program (https://indems.org/wp-content/uploads/2026/06/Indiana-Democratic-Party-2026-State-Convention-Program.pdf)
 * and The Indiana Citizen; Libertarians per Ballotpedia.
 */
export const IN_CANDIDATES: KnownCandidate[] = [
  ...["Beau Bayh", "Blythe Potter", "Max Engling", "Diego Morales", "David Shelton", "Lauri Shillings"].map((name) => ({ name, office: "Secretary of State" as const })),
  ...["Daniel Elliott", "Coumba Kebe"].map((name) => ({ name, office: "Treasurer" as const })),
  ...["Elise Nieshalla", "Jessica Bailey", "John Schick"].map((name) => ({ name, office: "Comptroller" as const })),
];

const COLS = ["FileNumber", "CommitteeType", "Committee", "CandidateName", "ContributorType", "Name", "City", "State", "Occupation", "Type", "Amount", "ContributionDate", "Amended"];

export function inReceipt(r: Record<string, string>): Receipt | null {
  if (r.CommitteeType !== "Candidate" || r.Type !== "Direct" || r.Amended === "1") return null;
  const date = isoDate(r.ContributionDate);
  const amount = Number(r.Amount);
  if (!date || !Number.isFinite(amount)) return null;
  const indiv = isIndividual(r.ContributorType);
  return {
    id: null, committeeId: r.FileNumber, committeeName: r.Committee, candidateName: r.CandidateName.replace(/\s+/g, " "), date, amount,
    donor: { name: titleCase(r.Name), type: indiv ? "INDIVIDUAL" : "ENTITY", employer: "", occupation: r.Occupation, city: r.City, state: r.State },
    fromCandidateCommittee: false,
  };
}

export const inFinanceAdapter: Adapter = {
  id: "state-in-finance",
  name: "Indiana Election Division: state campaign finance",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly (the Election Division refreshes the files periodically; re-downloaded only when Last-Modified changes)",
  refreshMinutes: 10_080,
  coverage:
    "Indiana state races. Itemized direct contributions filed since 2025 to candidates for Secretary of State, Treasurer and Comptroller (Indiana's 2026 statewide offices), plus the largest donors to all Indiana state candidates, including the governor, attorney general and legislature. Rows flagged as amended, transfers between a candidate's own committees, unitemized lump sums, in-kind contributions and loans are excluded. Indiana doesn't publish donor employers.",
  async run({ fetch, log, lookup }) {
    const receipts: Receipt[] = [];
    let dataAsOf: string | null = null;
    for (const y of bulkYears()) {
      const { text, lastModified } = await fetchZipText(fetch, zipUrl(y), `in-cf-${y}_ContributionData.csv.zip`);
      requireColumns(text, COLS, `IN ${y}_ContributionData.csv`);
      if (lastModified && (!dataAsOf || Date.parse(lastModified) > Date.parse(dataAsOf))) dataAsOf = lastModified;
      let n = 0;
      forEachCsvRecord(text, (r) => { const x = inReceipt(r); if (x) { receipts.push(x); n++; } });
      log(`  IN ${y}: ${n} itemized candidate receipts`);
    }
    const agg = aggregate(receipts, officeResolver("IN", BALLOT, IN_CANDIDATES, lookup, { Auditor: "Comptroller" }));
    return finish({ state: "IN", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, agg, lookup, log);
  },
};

export const adapters: Adapter[] = [inFinanceAdapter];
