import type { Adapter } from "../../ingest/types";
import type { StatewideOffice } from "./contract";
import {
  aggregate, bulkYears, fetchZipText, finish, forEachCsvRecord, isIndividual, isoDate, officeResolver,
  requireColumns, titleCase, type KnownCandidate, type Receipt,
} from "./co-in-ok-ne";

/**
 * Nebraska state campaign finance from the Nebraska Accountability and
 * Disclosure Commission's bulk downloads
 * (https://nadc-e.nebraska.gov/PublicSite/DataDownload.aspx):
 * {YEAR}_ContributionLoanExtract.csv.zip for 2025 onward.
 *
 * Field meanings follow NADC's "Contributions/Loans File Layout"
 * (https://nadc-e.nebraska.gov/PublicSite/Resources/PublicDocuments/NEContributionsFileLayout.pdf):
 *  - Receipt ID: "internal ID. This ID is unique." (used to de-duplicate)
 *  - Org ID / Filer Type / Filer Name / Candidate Name: the receiving entity
 *  - Receipt Transaction/Contribution Type: Monetary, In-Kind, Loan, Refund,
 *    Loan Forgiveness, Other Funds Received, Pledge, …; only Monetary is kept
 *  - Contributor or Transaction Source Type: Individual, Business, PACs,
 *    Candidate Committee, Self (Candidate), …
 *  - Amended: "Y/N indicator to show if an amendment was filed for this
 *    record"; Y rows are superseded and dropped.
 * Rows reporting the aggregate of contributions of $250 or less ("FOR THE
 * CALENDAR YEAR < 250.01 …") are lump sums and are dropped.
 *
 * Nebraska's 2026 statewide offices: Governor/Lt. Governor (joint ticket),
 * Secretary of State, Treasurer, Attorney General and Auditor of Public
 * Accounts.
 *
 * Nebraska lobbying is published only as PDFs by the Clerk of the
 * Legislature, so there is no state-ne-lobby adapter.
 *
 * nadc-e.nebraska.gov serves no robots.txt (404, checked 2026-10-12).
 */

const PAGE = "https://nadc-e.nebraska.gov/PublicSite/DataDownload.aspx";
const zipUrl = (y: string) => `https://nadc-e.nebraska.gov/PublicSite/Docs/BulkDataDownloads/${y}_ContributionLoanExtract.csv.zip`;
const AGENCY = "Nebraska Accountability and Disclosure Commission (NADC)";

const BALLOT: StatewideOffice[] = ["Governor", "Secretary of State", "Treasurer", "Attorney General", "Auditor"];

/**
 * General-election candidates from the Secretary of State's "Final Statewide
 * General Candidate List" (2026-09-11,
 * https://sos.nebraska.gov/sites/default/files/doc/elections/2026/Final_Statewide_General_Candidate_Filing_List_9.11.26.pdf),
 * plus incumbent Secretary of State Bob Evnen, a 2026 primary candidate
 * (Ballotpedia).
 */
export const NE_CANDIDATES: KnownCandidate[] = [
  ...["Jim Pillen", "Lynne Walz", "Rick Beard", "Brett Lindstrom"].map((name) => ({ name, office: "Governor" as const })),
  ...["Scott Petersen", "Sarah Slattery", "Paul Rumbaugh", "Bob Krist", "Bob Evnen"].map((name) => ({ name, office: "Secretary of State" as const })),
  ...["Joey Spellerberg", "Daniel Ebers"].map((name) => ({ name, office: "Treasurer" as const })),
  ...["Mike Hilgers", "Jocelyn Brasher"].map((name) => ({ name, office: "Attorney General" as const })),
  ...["Mike Foley", "John Knight"].map((name) => ({ name, office: "Auditor" as const })),
];

const NAME = "Contributor or Source Name (Individual Last Name)";
const COLS = ["Receipt ID", "Org ID", "Filer Type", "Filer Name", "Candidate Name", "Receipt Transaction/Contribution Type", "Receipt Date",
  "Receipt Amount", "Contributor or Transaction Source Type", NAME, "First Name", "City", "State", "Amended", "Employer", "Occupation"];

export function neReceipt(r: Record<string, string>): Receipt | null {
  if (r["Filer Type"] !== "Candidate Committee" || r["Receipt Transaction/Contribution Type"] !== "Monetary" || r.Amended === "Y") return null;
  if (/CALENDAR YEAR|\$?250 OR LESS|UNITEMIZED|NON-ITEMIZED/i.test(`${r[NAME]} ${r["First Name"]}`)) return null;
  const date = isoDate(r["Receipt Date"]);
  const amount = Number(r["Receipt Amount"]);
  if (!date || !Number.isFinite(amount)) return null;
  const src = r["Contributor or Transaction Source Type"];
  const indiv = isIndividual(src);
  const name = indiv ? [r["First Name"], r[NAME]].filter(Boolean).join(" ") : r[NAME];
  return {
    id: r["Receipt ID"] || null, committeeId: r["Org ID"], committeeName: r["Filer Name"], candidateName: r["Candidate Name"], date, amount,
    donor: { name: titleCase(name), type: indiv ? "INDIVIDUAL" : "ENTITY", employer: r.Employer, occupation: r.Occupation, city: r.City, state: r.State },
    fromCandidateCommittee: /^Candidate Committee/i.test(src),
  };
}

export const neFinanceAdapter: Adapter = {
  id: "state-ne-finance",
  name: "Nebraska Accountability and Disclosure Commission: state campaign finance",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Daily (NADC rebuilds the extracts nightly; re-downloaded only when Last-Modified changes)",
  refreshMinutes: 1440,
  coverage:
    "Nebraska races filed with NADC. Itemized 2025–26 monetary contributions to 2026 candidates for Governor, Secretary of State, Treasurer, Attorney General and Auditor, plus the largest donors to all candidate committees filing with NADC (Legislature, regents, and the city and county races NADC also covers). Amended records, transfers between a candidate's own committees, lump-sum reports of small contributions, in-kind contributions and loans are excluded.",
  async run({ fetch, log, lookup }) {
    const receipts: Receipt[] = [];
    let dataAsOf: string | null = null;
    for (const y of bulkYears()) {
      const { text, lastModified } = await fetchZipText(fetch, zipUrl(y), `ne-nadc-${y}_ContributionLoanExtract.csv.zip`);
      requireColumns(text, COLS, `NE ${y}_ContributionLoanExtract.csv`);
      if (lastModified && (!dataAsOf || Date.parse(lastModified) > Date.parse(dataAsOf))) dataAsOf = lastModified;
      let n = 0;
      forEachCsvRecord(text, (r) => { const x = neReceipt(r); if (x) { receipts.push(x); n++; } });
      log(`  NE ${y}: ${n} itemized candidate receipts`);
    }
    const agg = aggregate(receipts, officeResolver("NE", BALLOT, NE_CANDIDATES, lookup));
    return finish({ state: "NE", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, agg, lookup, log);
  },
};

export const adapters: Adapter[] = [neFinanceAdapter];
