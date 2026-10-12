import type { Adapter, AdapterContext } from "../../ingest/types";
import { buildLobbyEntity, DATA_CENTER_RE, SINCE, type LobbyClient, type StatewideOffice } from "./contract";
import {
  aggregate, bulkYears, fetchZipText, finish, forEachCsvRecord, isIndividual, isoDate, officeResolver,
  requireColumns, titleCase, type KnownCandidate, type Receipt,
} from "./co-in-ok-ne";
import { orgKey } from "./ky";

/**
 * Colorado state campaign finance from the Secretary of State's TRACER bulk
 * downloads (https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx):
 * {YEAR}_ContributionData.csv.zip for 2025 onward. Files are split by filing
 * year, so a record ID can only appear once per file; IDs are de-duplicated
 * across years anyway.
 *
 * Field meanings follow TRACER's "Download Data File Key"
 * (https://tracer.sos.colorado.gov/PublicSite/Resources/DownloadDataFileKey.pdf):
 *  - CO_ID: ID of the recipient committee; CommitteeName / CandidateName: the
 *    recipient committee and, for candidate committees, its candidate.
 *  - LastName: "Last Name of Contributor, if individual, or full name of an entity".
 *  - Amended: "Y/N indicator to show if an amendment was filed for this record".
 *    Amendment: "Y/N … if this record is an amendment to a previously filed record".
 *    Superseded originals (Amended = Y) are dropped; the amending record is kept.
 *  - Jurisdiction: "STATEWIDE" for state-level committees (statewide offices
 *    and the legislature); county races carry the county name.
 *
 * Kept: Candidate Committee recipients, Jurisdiction STATEWIDE, ContributionType
 * "Monetary (Itemized)…" (non-itemized lump sums and in-kind are excluded).
 * The 2026 statewide offices are Governor/Lt. Governor (joint ticket),
 * Attorney General, Secretary of State and Treasurer.
 *
 * tracer.sos.colorado.gov serves no robots.txt (404, checked 2026-10-12) and
 * the data-download page states no terms restricting download.
 */

const PAGE = "https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx";
const zipUrl = (y: string) => `https://tracer.sos.colorado.gov/PublicSite/Docs/BulkDataDownloads/${y}_ContributionData.csv.zip`;
const AGENCY = "Colorado Secretary of State (TRACER)";

const BALLOT: StatewideOffice[] = ["Governor", "Attorney General", "Secretary of State", "Treasurer"];

/**
 * 2026 statewide candidates whose committee names don't name the office.
 * General-election nominees: Colorado Sun 2026 election guide (2026-09-29,
 * https://coloradosun.com/2026/09/29/colorado-election-guide-2026/).
 * June 30 primary fields: Ballotpedia's 2026 Colorado AG and governor pages
 * and Politics1 (https://politics1.com/co.htm). Kirkmeyer (Governor) and
 * Danielson (Secretary of State) are 2025 announced primary candidates from
 * news coverage. This is not the Secretary of State's certified list
 * (https://www.sos.state.co.us/pubs/elections/Candidates/CandidateHome.html),
 * which wasn't machine-checked; re-verify when it changes.
 */
export const CO_CANDIDATES: KnownCandidate[] = [
  ...["Phil Weiser", "Victor Marx", "Michael Bennet", "Barb Kirkmeyer", "Scott Bottoms", "Greg Lopez"].map((name) => ({ name, office: "Governor" as const })),
  ...["Jena Griswold", "Michael Allen", "Michael Dougherty", "Hetal Doshi", "David Seligman", "Crisanta Duran", "Conner Pennington"].map((name) => ({ name, office: "Attorney General" as const })),
  ...["Amanda Gonzalez", "James Wiley", "Jessie Danielson"].map((name) => ({ name, office: "Secretary of State" as const })),
  ...["Jeff Bridges", "Kevin Grantham", "Jodie Barr"].map((name) => ({ name, office: "Treasurer" as const })),
];

const COLS = ["CO_ID", "ContributionAmount", "ContributionDate", "LastName", "FirstName", "City", "State", "RecordID",
  "ContributionType", "ContributorType", "CommitteeType", "CommitteeName", "CandidateName", "Employer", "Occupation", "Amended", "Jurisdiction"];

/** Map one TRACER contribution row; null if not an itemized monetary receipt of a state-level candidate committee or superseded. */
export function coReceipt(r: Record<string, string>): Receipt | null {
  if (r.CommitteeType !== "Candidate Committee" || r.Jurisdiction !== "STATEWIDE") return null;
  if (r.Amended === "Y") return null;
  if (!/^Monetary \(Itemized\)/.test(r.ContributionType)) return null;
  const date = isoDate(r.ContributionDate);
  const amount = Number(r.ContributionAmount);
  if (!date || !Number.isFinite(amount)) return null;
  const indiv = isIndividual(r.ContributorType);
  const name = indiv ? [r.FirstName, r.LastName].filter(Boolean).join(" ") : r.LastName;
  return {
    id: r.RecordID || null, committeeId: r.CO_ID, committeeName: r.CommitteeName, candidateName: r.CandidateName, date, amount,
    donor: { name: titleCase(name), type: indiv ? "INDIVIDUAL" : "ENTITY", employer: r.Employer, occupation: r.Occupation, city: r.City, state: r.State },
    fromCandidateCommittee: /^Candidate/i.test(r.ContributorType),
  };
}

export const coFinanceAdapter: Adapter = {
  id: "state-co-finance",
  name: "Colorado Secretary of State (TRACER): state campaign finance",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Daily (TRACER rebuilds the files nightly; re-downloaded only when Last-Modified changes)",
  refreshMinutes: 1440,
  coverage:
    "Colorado state races. Itemized 2025–26 monetary contributions to candidates for Governor, Attorney General, Secretary of State and Treasurer, plus the largest donors to all state-level Colorado candidates (legislature included). Superseded (amended) records are excluded, as are transfers between a candidate's own committees, non-itemized lump sums, in-kind contributions, loans and independent-expenditure committees.",
  async run({ fetch, log, lookup }) {
    const receipts: Receipt[] = [];
    let dataAsOf: string | null = null;
    for (const y of bulkYears()) {
      const { text, lastModified } = await fetchZipText(fetch, zipUrl(y), `co-tracer-${y}_ContributionData.csv.zip`);
      requireColumns(text, COLS, `CO ${y}_ContributionData.csv`);
      if (lastModified && (!dataAsOf || Date.parse(lastModified) > Date.parse(dataAsOf))) dataAsOf = lastModified;
      let n = 0;
      forEachCsvRecord(text, (r) => { const x = coReceipt(r); if (x) { receipts.push(x); n++; } });
      log(`  CO ${y}: ${n} itemized candidate receipts`);
    }
    const agg = aggregate(receipts, officeResolver("CO", BALLOT, CO_CANDIDATES, lookup));
    return finish({ state: "CO", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, agg, lookup, log);
  },
};

// ---------------------------------------------------------------------------
// Lobbying

/**
 * Colorado professional-lobbyist disclosures, published by the Secretary of
 * State on the Colorado Information Marketplace (Socrata SODA API):
 *  - dxfk-9ifj "Professional Lobbyist Income": incomeamount per client per
 *    month (dateincomereceived), i.e. what each client paid its lobbyist.
 *  - vp65-spyn "Professional Lobbyist Clients": client registrations by
 *    fiscal year (July–June) with lobbyist, firm and industry.
 *  - sche-yqzf "Professional Lobbyist Bills": bills each lobbyist reported
 *    working on for a client, with bill title and position.
 * Aggregation is done server-side ($group) to keep responses small.
 * data.colorado.gov/robots.txt (checked 2026-10-12) disallows only facet,
 * browse and OData paths and sets Crawl-delay: 1; requests here use
 * /resource/ and wait at least 1 s between calls.
 */
const SODA = "https://data.colorado.gov/resource";
const FISCAL_YEARS = ["2024-2025", "2025-2026", "2026-2027"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function soda<T>(fetchFn: AdapterContext["fetch"], id: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  const limit = 50_000;
  for (let offset = 0; ; offset += limit) {
    const q = new URLSearchParams({ ...params, $limit: String(limit), $offset: String(offset) });
    await sleep(1100); // robots.txt Crawl-delay: 1
    const page = (await (await fetchFn(`${SODA}/${id}.json?${q}`)).json()) as T[];
    out.push(...page);
    if (page.length < limit) return out;
  }
}

interface CoIncome { clientname?: string; lobbyistfirmname?: string; lobbyistname?: string; amt?: string; n?: string }
interface CoClient { clientname?: string; lobbyistfirmname?: string; lobbyistname?: string; annuallobbyistregistrationid?: string; industrytradetype?: string }
interface CoBill { clientname?: string; billnumber?: string; billinformation?: string }

/**
 * Combine the three Colorado datasets into contract clients (exported for tests).
 * A lobbying firm that subcontracts work reports the firm itself as a
 * "client" of the subcontractor, so its income would double count what the
 * real client already paid; clients whose name is a registered lobbying
 * firm's name are therefore dropped.
 */
export function aggregateCoLobby(income: CoIncome[], clients: CoClient[], bills: CoBill[]): { clients: LobbyClient[]; registrations: number; firmClientsDropped: number } {
  const firmKeys = new Set([...income, ...clients].map((r) => (r.lobbyistfirmname ? orgKey(r.lobbyistfirmname) : "")).filter(Boolean));
  const isFirm = (name: string) => firmKeys.has(orgKey(name));
  const dropped = new Set<string>();
  const keep = <T extends { clientname?: string }>(rows: T[]) => rows.filter((r) => {
    if (!r.clientname) return false;
    if (isFirm(r.clientname)) { dropped.add(orgKey(r.clientname)); return false; }
    return true;
  });
  income = keep(income);
  clients = keep(clients);
  bills = keep(bills);
  const map = new Map<string, LobbyClient & { billSet: Set<string>; firmSet: Set<string>; lobSet: Set<string> }>();
  const get = (name: string) => {
    const k = orgKey(name);
    let c = map.get(k);
    if (!c) {
      c = { name: name.trim(), amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: DATA_CENTER_RE.test(name), billSet: new Set(), firmSet: new Set(), lobSet: new Set() };
      map.set(k, c);
    }
    return c;
  };
  const regs = new Set<string>();
  for (const r of clients) {
    if (!r.clientname) continue;
    const c = get(r.clientname);
    if (r.lobbyistfirmname) c.firmSet.add(r.lobbyistfirmname.trim());
    if (r.lobbyistname) c.lobSet.add(r.lobbyistname.trim());
    if (r.industrytradetype && DATA_CENTER_RE.test(r.industrytradetype)) c.dataCenter = true;
    regs.add(`${r.annuallobbyistregistrationid}|${orgKey(r.clientname)}`);
  }
  for (const r of income) {
    if (!r.clientname) continue;
    const c = get(r.clientname);
    const amt = Number(r.amt);
    if (Number.isFinite(amt)) c.amount = (c.amount ?? 0) + amt;
    c.filings += Number(r.n) || 0;
    if (r.lobbyistfirmname) c.firmSet.add(r.lobbyistfirmname.trim());
    if (r.lobbyistname) c.lobSet.add(r.lobbyistname.trim());
  }
  for (const r of bills) {
    if (!r.clientname || !r.billnumber) continue;
    const c = get(r.clientname);
    const label = `${r.billnumber}${r.billinformation ? ` ${r.billinformation}` : ""}`;
    c.billSet.add(label);
    if (r.billinformation && DATA_CENTER_RE.test(r.billinformation)) c.dataCenter = true;
  }
  const out: LobbyClient[] = [...map.values()].map(({ billSet, firmSet, lobSet, ...c }) => ({
    ...c,
    amount: c.amount === null ? null : Math.round(c.amount * 100) / 100,
    firms: [...firmSet].slice(0, 10),
    lobbyists: [...lobSet].filter((l) => !firmSet.has(l)).slice(0, 10),
    // Data-center bills first, then the rest
    issues: [...billSet].sort((a, b) => Number(DATA_CENTER_RE.test(b)) - Number(DATA_CENTER_RE.test(a))).slice(0, 12),
  }));
  return { clients: out, registrations: regs.size, firmClientsDropped: dropped.size };
}

export const coLobbyAdapter: Adapter = {
  id: "state-co-lobby",
  name: "Colorado Secretary of State: professional lobbyist disclosures",
  url: "https://data.colorado.gov/d/dxfk-9ifj",
  sourceKind: "data",
  method: "api",
  schedule: "Daily (datasets refresh nightly)",
  refreshMinutes: 1440,
  coverage:
    "Colorado professional (paid) lobbying: clients registered for fiscal years 2024–25 through 2026–27, what each client paid its lobbyists since January 2025 (monthly income reports), the lobbying firms and lobbyists, and the bills reported for each client. State-agency lobbyists and lobbyist spending on officials aren't included.",
  async run({ fetch, log }) {
    const since = `${SINCE}T00:00:00.000`;
    const fy = FISCAL_YEARS.map((f) => `'${f}'`).join(",");
    const income = await soda<CoIncome>(fetch, "dxfk-9ifj", {
      $select: "clientname,lobbyistfirmname,lobbyistname,sum(incomeamount) as amt,count(*) as n",
      $where: `dateincomereceived >= '${since}'`,
      $group: "clientname,lobbyistfirmname,lobbyistname",
      $order: "clientname,lobbyistfirmname,lobbyistname",
    });
    const clients = await soda<CoClient>(fetch, "vp65-spyn", {
      $select: "clientname,lobbyistfirmname,lobbyistname,annuallobbyistregistrationid,industrytradetype",
      $where: `fiscalyear in(${fy})`,
      $order: "annuallobbyistregistrationid,clientname",
    });
    const bills = await soda<CoBill>(fetch, "sche-yqzf", {
      $select: "clientname,billnumber,billinformation,count(*) as n",
      $where: `reportduedate >= '${since}'`,
      $group: "clientname,billnumber,billinformation",
      $order: "clientname,billnumber,billinformation",
    });
    const agg = aggregateCoLobby(income, clients, bills);
    log(`CO lobbying: ${agg.clients.length} clients (${agg.firmClientsDropped} lobbying firms listed as clients dropped), ${agg.registrations} client registrations, ${agg.clients.filter((c) => c.dataCenter).length} with data-center mentions`);
    const entity = buildLobbyEntity({
      state: "CO", agency: "Colorado Secretary of State (professional lobbyist disclosures, via Colorado Information Marketplace)",
      sourceUrl: "https://data.colorado.gov/d/dxfk-9ifj", dataAsOf: new Date().toISOString().slice(0, 10),
      amountMeaning: "Income paid by the client to its professional lobbyists, as reported in monthly disclosures since January 2025",
      period: "Fiscal years 2024–25 to 2026–27 registrations; income since Jan 2025",
    }, agg.clients, agg.registrations);
    return { entities: [entity] };
  },
};

export const adapters: Adapter[] = [coFinanceAdapter, coLobbyAdapter];
