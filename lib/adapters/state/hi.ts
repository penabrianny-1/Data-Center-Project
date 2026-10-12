import type { Adapter } from "../../ingest/types";
import {
  SINCE, buildFinanceEntities, displayName,
  type CandidateTotals, type Donor, type StateFinanceMeta, type StatewideOffice,
} from "./contract";
import { addGrouped, num, q, soda, sodaAll, sodaUpdatedAt, ymd } from "./wa";

/**
 * Hawaii state campaign finance from the Campaign Spending Commission's open
 * data portal (hicscdata.hawaii.gov, Socrata), filtered and aggregated
 * server-side with SoQL.
 *
 * Dataset: "Campaign Contributions Received By Hawaii State and County Candidates"
 *   https://hicscdata.hawaii.gov/d/jexd-xbcg  (API: /resource/jexd-xbcg.json)
 * The dataset's columns carry no field descriptions; only the names are used
 * at face value (candidate_name, reg_no, office, election_period,
 * contributor_type, contributor_name, date, amount, employer, occupation,
 * city, state). Its description says it "includes searchable data from
 * amended reports", i.e. amended reports' transactions are what's published;
 * a check on 2026-10-12 found no duplicate (candidate, contributor, date,
 * amount) rows since 2025, so rows are summed as-is.
 *
 * robots.txt (hicscdata.hawaii.gov, checked 2026-10-12): standard Socrata
 * file, `Crawl-delay: 1`, only /browse, /page and /catalog search URLs
 * disallowed; /resource/ is allowed.
 *
 * Lobbying: the Hawaii State Ethics Commission publishes lobbying only through
 * a JavaScript Salesforce portal (hawaiiethics.my.site.com) with no bulk file
 * or API, and data.hawaii.gov has no lobbying dataset, so there is no
 * state-hi-lobby adapter.
 */

const DOMAIN = "hicscdata.hawaii.gov";
const DS = "jexd-xbcg";
const AGENCY = "Hawaii Campaign Spending Commission";

/** 2026 statewide offices as they appear in the `office` column. */
export const HI_STATEWIDE: Record<string, StatewideOffice> = { Governor: "Governor", "Lt. Governor": "Lieutenant Governor" };
/** State (not county) offices in the `office` column. OHA trustees are elected statewide to a state agency. */
const HI_STATE_OFFICES = ["Governor", "Lt. Governor", "Senate", "House", "OHA"];

/**
 * Base filter: since 2025, state offices, and no money from the candidate themself
 * (contributor_type 'Candidate'; "Immediate Family" is kept). The published file also holds a
 * Commission test filer (candidate_name 'Test', city 'test'), which is dropped.
 */
export function hiWhere(offices: string[], since = SINCE): string {
  return `date >= '${since}T00:00:00' AND office in (${offices.map(q).join(",")}) AND contributor_type != 'Candidate' AND upper(candidate_name) != 'TEST'`;
}

/** contributor_type 'Individual' / 'Immediate Family' → INDIVIDUAL; 'Other Entity', 'Noncandidate Committee', 'Political Party' → ENTITY. */
export const hiType = (t: string | undefined): Donor["type"] => (t === "Individual" || t === "Immediate Family" ? "INDIVIDUAL" : "ENTITY");

export interface HiRow {
  reg_no?: string;
  candidate_name?: string;
  office?: string;
  contributor_name?: string;
  contributor_type?: string;
  city?: string;
  state?: string;
  emp?: string;
  occ?: string;
  amt?: string;
  n?: string;
  latest?: string;
}

/** "Green, Josh" / "Anthony, Daniel*" → "Josh Green" / "Daniel Anthony". */
export const hiName = (s: string) => displayName(s.replace(/\*/g, "").trim());

/** Donor record from a grouped row; individuals are reported "Last, First" and shown "First Last". */
export function hiDonor(r: HiRow): Omit<Donor, "amount" | "count"> {
  const type = hiType(r.contributor_type);
  const raw = (r.contributor_name ?? "").trim();
  return { name: type === "INDIVIDUAL" ? displayName(raw) : raw, type, employer: r.emp ?? "", occupation: r.occ ?? "", city: r.city ?? "", state: r.state ?? "" };
}

/** Fold per-candidate grouped donor rows into CandidateTotals. */
export function hiCandidates(rows: HiRow[]): CandidateTotals[] {
  const by = new Map<string, CandidateTotals>();
  for (const r of rows) {
    const office = HI_STATEWIDE[r.office ?? ""];
    const id = r.reg_no;
    const amount = num(r.amt);
    if (!office || !id || !amount) continue;
    const c = by.get(id) ?? {
      filerId: id, name: hiName(r.candidate_name ?? id), office, total: 0, count: 0, fromEntities: 0, latest: null,
      donors: new Map<string, Donor>(), committees: [id],
    };
    const type = hiType(r.contributor_type);
    c.total += amount;
    c.count += num(r.n);
    if (type === "ENTITY") c.fromEntities += amount;
    const latest = ymd(r.latest);
    if (latest && (!c.latest || latest > c.latest)) c.latest = latest;
    addGrouped(c.donors, hiDonor(r), amount, num(r.n));
    by.set(id, c);
  }
  return [...by.values()];
}

const hiFinance: Adapter = {
  id: "state-hi-finance",
  name: "Hawaii Campaign Spending Commission: state campaign finance",
  url: "https://hicscdata.hawaii.gov/d/jexd-xbcg",
  sourceKind: "data",
  method: "api",
  schedule: "Daily (the Commission republishes the dataset every few days)",
  refreshMinutes: 1440,
  dependsOn: ["curated"],
  coverage:
    "Hawaii state races only. Contributions since 1 Jan 2025 to candidates for Governor and Lieutenant Governor (the 2026 statewide races), plus the largest donors to all Hawaii state candidates: Governor, Lieutenant Governor, legislature and OHA trustees. County races aren't included, and neither is money candidates gave their own campaigns. Amounts include in-kind contributions. Hawaii lobbying isn't covered because the State Ethics Commission publishes it only through a JavaScript portal, with no data download.",
  async run(ctx) {
    const dataAsOf = await sodaUpdatedAt(ctx, DOMAIN, DS);
    const fields = "contributor_name, contributor_type, city, state";
    const agg = "max(employer) as emp, max(occupation) as occ, sum(amount) as amt, count(*) as n, max(date) as latest";
    const candRows = await sodaAll<HiRow>(ctx, DOMAIN, DS, {
      $select: `reg_no, candidate_name, office, ${fields}, ${agg}`,
      $where: `${hiWhere(Object.keys(HI_STATEWIDE))} AND election_period like '%-2026'`,
      $group: `reg_no, candidate_name, office, ${fields}`,
      $order: `reg_no, ${fields}`,
    });
    const candidates = hiCandidates(candRows);
    const allRows = await sodaAll<HiRow>(ctx, DOMAIN, DS, {
      $select: `${fields}, ${agg}`,
      $where: hiWhere(HI_STATE_OFFICES),
      $group: fields,
      $order: `amt desc, ${fields}`,
    });
    const all = new Map<string, Donor>();
    for (const r of allRows) {
      const amount = num(r.amt);
      if (!amount || !r.contributor_name) continue;
      addGrouped(all, hiDonor(r), amount, num(r.n));
    }
    const [{ latest } = {} as HiRow] = await soda<HiRow>(ctx, DOMAIN, DS, { $select: "max(date) as latest" });
    ctx.log(`CSC: ${candidates.length} statewide candidates, ${all.size} donors to state candidates; latest transaction ${ymd(latest)}`);
    const meta: StateFinanceMeta = { state: "HI", agency: AGENCY, sourceUrl: "https://hicscdata.hawaii.gov/d/jexd-xbcg", dataAsOf: dataAsOf ?? ymd(latest) };
    return buildFinanceEntities(meta, candidates, all, ctx.lookup);
  },
};

export const adapters: Adapter[] = [hiFinance];
