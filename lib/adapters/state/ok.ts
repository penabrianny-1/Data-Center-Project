import type { Adapter } from "../../ingest/types";
import type { StatewideOffice } from "./contract";
import {
  aggregate, bulkYears, fetchZipText, finish, forEachCsvRecord, isIndividual, isoDate, officeResolver,
  requireColumns, titleCase, type KnownCandidate, type Receipt,
} from "./co-in-ok-ne";

/**
 * Oklahoma state campaign finance from the Ethics Commission's Guardian bulk
 * downloads (https://guardian.ok.gov/PublicSite/DataDownload.aspx):
 * {YEAR}_ContributionLoanExtract.csv.zip for 2025 onward.
 *
 * Field meanings follow the commission's "Contributions, Loans, and
 * Transfers–In File Layout"
 * (https://guardian.ok.gov/PublicSite/Resources/PublicDocuments/OKReceiptsAndTransfersInFileLayout.pdf):
 *  - Receipt ID: "internal ID. This ID is unique." (used to de-duplicate)
 *  - Org ID / Committee Name / Candidate Name: the receiving candidate or committee
 *  - Receipt Type: Monetary, In-Kind, Loan, Transfer-In of Funds from Prior /
 *    Associated Committee, Refund, …; only Monetary is kept, so transfers
 *    from a candidate's prior or associated committees are excluded by type.
 *  - Receipt Source Type: Individual, Business, Candidate (Self), PACs,
 *    Candidate Committee (Registered/Not Registered), …
 *  - Amended: "Y/N indicator to show if an amendment was filed for this
 *    record"; Y rows are superseded and dropped.
 * Rows whose Last Name is "NON-ITEMIZED CONTRIBUTOR" are lump sums and are
 * dropped. Candidate committees have a blank Committee Name, so offices come
 * from the candidate table below and the database's governor candidates.
 *
 * Oklahoma's 2026 statewide offices: Governor, Lieutenant Governor, Attorney
 * General, Treasurer, Superintendent of Public Instruction, Labor
 * Commissioner, Insurance Commissioner, Auditor and Inspector, and one
 * Corporation Commission seat.
 *
 * guardian.ok.gov serves no robots.txt (404, checked 2026-10-12).
 */

const PAGE = "https://guardian.ok.gov/PublicSite/DataDownload.aspx";
const zipUrl = (y: string) => `https://guardian.ok.gov/PublicSite/Docs/BulkDataDownloads/${y}_ContributionLoanExtract.csv.zip`;
const AGENCY = "Oklahoma Ethics Commission (The Guardian)";

const BALLOT: StatewideOffice[] = [
  "Governor", "Lieutenant Governor", "Attorney General", "Treasurer", "Superintendent of Education",
  "Labor Commissioner", "Insurance Commissioner", "Auditor", "Utility / Corporation Commissioner",
];

/**
 * 2026 statewide candidates (primary fields and nominees) from Ballotpedia's
 * 2026 Oklahoma governor, attorney general and state executive pages, The
 * Ballot Brief's Oklahoma sample ballot, and news coverage of the June 16
 * primaries. This is not the State Election Board's certified list
 * (https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html),
 * which wasn't machine-checked. Lieutenant governor, superintendent, labor,
 * insurance and Corporation Commission fields are incomplete, so those
 * offices only pick up candidates listed below.
 */
export const OK_CANDIDATES: KnownCandidate[] = [
  ...["Mike Mazzei", "Cyndi Munson", "Gentner Drummond", "Charles McCall", "Chip Keating"].map((name) => ({ name, office: "Governor" as const })),
  ...["Jon Echols", "Nick Coffey", "Chris Kannady", "Jeff Starling"].map((name) => ({ name, office: "Attorney General" as const })),
  ...["Todd Russ", "Cindy Byrd"].map((name) => ({ name, office: "Treasurer" as const })),
  { name: "Melissa Capps", office: "Auditor" },
  { name: "Kelly Forbes", office: "Lieutenant Governor" },
];

const COLS = ["Receipt ID", "Org ID", "Receipt Type", "Receipt Date", "Receipt Amount", "Receipt Source Type", "Last Name", "First Name",
  "City", "State", "Committee Type", "Committee Name", "Candidate Name", "Amended", "Employer", "Occupation"];

export function okReceipt(r: Record<string, string>): Receipt | null {
  if (r["Committee Type"] !== "Candidate Committee" || r["Receipt Type"] !== "Monetary" || r.Amended === "Y") return null;
  if (/^NON-ITEMIZED/i.test(r["Last Name"])) return null;
  const date = isoDate(r["Receipt Date"]);
  const amount = Number(r["Receipt Amount"]);
  if (!date || !Number.isFinite(amount)) return null;
  const src = r["Receipt Source Type"];
  const indiv = isIndividual(src) || (!src && !!r["First Name"]);
  const name = indiv ? [r["First Name"], r["Last Name"]].filter(Boolean).join(" ") : r["Last Name"];
  return {
    id: r["Receipt ID"] || null, committeeId: r["Org ID"], committeeName: r["Committee Name"], candidateName: r["Candidate Name"], date, amount,
    donor: { name: titleCase(name), type: indiv ? "INDIVIDUAL" : "ENTITY", employer: r.Employer, occupation: r.Occupation, city: r.City, state: r.State },
    fromCandidateCommittee: /^Candidate Committee/i.test(src),
  };
}

export const okFinanceAdapter: Adapter = {
  id: "state-ok-finance",
  name: "Oklahoma Ethics Commission (Guardian): state campaign finance",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Daily (the Guardian extracts rebuild nightly; re-downloaded only when Last-Modified changes)",
  refreshMinutes: 1440,
  coverage:
    "Oklahoma state races. Itemized 2025–26 monetary contributions to 2026 candidates for Governor, Attorney General, Treasurer, Auditor and Lieutenant Governor (as far as the candidate fields could be confirmed), plus the largest donors to all Oklahoma state candidates, legislature included. Amended records, transfers from a candidate's prior or associated committees, non-itemized lump sums, in-kind contributions and loans are excluded.",
  async run({ fetch, log, lookup }) {
    const receipts: Receipt[] = [];
    let dataAsOf: string | null = null;
    for (const y of bulkYears()) {
      const { text, lastModified } = await fetchZipText(fetch, zipUrl(y), `ok-guardian-${y}_ContributionLoanExtract.csv.zip`);
      requireColumns(text, COLS, `OK ${y}_ContributionLoanExtract.csv`);
      if (lastModified && (!dataAsOf || Date.parse(lastModified) > Date.parse(dataAsOf))) dataAsOf = lastModified;
      let n = 0;
      forEachCsvRecord(text, (r) => { const x = okReceipt(r); if (x) { receipts.push(x); n++; } });
      log(`  OK ${y}: ${n} itemized candidate receipts`);
    }
    const agg = aggregate(receipts, officeResolver("OK", BALLOT, OK_CANDIDATES, lookup));
    return finish({ state: "OK", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, agg, lookup, log);
  },
};

export const adapters: Adapter[] = [okFinanceAdapter];
