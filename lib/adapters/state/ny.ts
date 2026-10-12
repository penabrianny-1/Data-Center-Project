import type { Adapter, AdapterContext } from "../../ingest/types";
import {
  DATA_CENTER_RE, SINCE, buildFinanceEntities, buildLobbyEntity, donorKey,
  type CandidateTotals, type Donor, type LobbyClient, type StateFinanceMeta, type StateLobbyMeta, type StatewideOffice,
} from "./contract";
import { ClientBook, addGrouped, dataCenterBills, dataCenterWhere, normBill, normKey, num, q, soda, sodaAll, sodaUpdatedAt, ymd } from "./wa";

/**
 * New York State campaign finance (State Board of Elections) and lobbying
 * (Commission on Ethics and Lobbying in Government, COELIG) from data.ny.gov
 * (Socrata), filtered and aggregated server-side with SoQL.
 *
 * robots.txt (data.ny.gov, checked 2026-10-12): standard Socrata file,
 * `Crawl-delay: 1`, only /browse, /page and /catalog search URLs disallowed;
 * /resource/ and /api/views/ are allowed. The BOE's own download site
 * (publicreporting.elections.ny.gov) sits behind a Cloudflare JS challenge and
 * is not used.
 */

const DOMAIN = "data.ny.gov";

// ---------------------------------------------------------------------------
// Campaign finance

/**
 * Campaign Finance Disclosure Reports Data: Beginning 1999 — https://data.ny.gov/d/e9ss-239a
 * Docs: attachments BOE_FinancialDisclosureReport_DataDictionary.pdf / _Overview.pdf on that page.
 * One row per transaction. Used columns: filer_id, filing_sched_abbrev ("Transaction Type
 * Abbreviation"), sched_date ("Date of Transaction"), org_amt, r_itemized ("Transaction Itemized or
 * Un-Itemized"), cntrbr_type_desc ("Contributor Type"), transfer_type_desc ("Transfer Type"),
 * flng_ent_name / _first_name / _last_name / _city / _state ("Entity …").
 */
const DS_TX = "e9ss-239a";
/** Campaign Finance Filer Data: Beginning 1974 — https://data.ny.gov/d/7x2g-h32p (filer_id, filer_name, compliance_type_desc, filer_type_desc, filer_status, committee_type_desc, office_desc). */
const DS_FILERS = "7x2g-h32p";
const BOE = "New York State Board of Elections";

/** office_desc values for the 2026 statewide races. */
export const NY_STATEWIDE: Record<string, StatewideOffice> = {
  Governor: "Governor",
  "Lt. Governor": "Lieutenant Governor",
  "Attorney General": "Attorney General",
  "State Comptroller": "Comptroller",
};
/** Candidate committee types (committee_type_desc) whose receipts count as money to state candidates. */
const CANDIDATE_COMMITTEE_TYPES = ["Authorized Single Candidate Committee", "Public Campaign Finance Committee"];

/**
 * Receipt filter (schedule names from filing_sched_desc):
 *  A/B/C Monetary contributions (individuals & partnerships / corporations / all other), D In-kind,
 *  G Transfers In except "Type 2-Between two authorized committees SOLELY supporting the same candidate"
 *  (a candidate's own committees moving money: self-transfers), M Contributions Refunded (subtracted).
 * Excluded: unitemized lines (r_itemized 'N'), Schedule O (LLC/partnership attributions — child rows
 * that map to a parent contribution via trans_mapping, so counting them would double count), and
 * money from the candidate (cntrbr_type_desc 'Candidate/Candidate Spouse').
 * Amendments: an amended report replaces the original in this dataset — no filer/period has both an
 * original and an amended version (checked 2026-10-12), so rows are summed as published.
 */
export function nyReceiptWhere(filerIds: string[], since = SINCE): string {
  return [
    `filer_id in (${filerIds.join(",")})`,
    `election_year >= ${since.slice(0, 4)}`,
    `sched_date >= '${since}T00:00:00'`,
    `r_itemized = 'Y'`,
    `(filing_sched_abbrev in ('A','B','C','D','M') OR (filing_sched_abbrev = 'G' AND (transfer_type_desc IS NULL OR transfer_type_desc not like 'Type 2%')))`,
    `(cntrbr_type_desc IS NULL OR cntrbr_type_desc != 'Candidate/Candidate Spouse')`,
  ].join(" AND ");
}
const NY_RECEIPT_GROUP = "filer_id, filing_sched_abbrev, flng_ent_name, flng_ent_first_name, flng_ent_last_name, flng_ent_city, flng_ent_state";
const NY_RECEIPT_SELECT = `${NY_RECEIPT_GROUP}, sum(org_amt) as amt, count(*) as n, max(sched_date) as latest`;

export interface NyReceiptRow {
  filer_id?: string;
  filing_sched_abbrev?: string;
  flng_ent_name?: string;
  flng_ent_first_name?: string;
  flng_ent_last_name?: string;
  flng_ent_city?: string;
  flng_ent_state?: string;
  amt?: string;
  n?: string;
  latest?: string;
}

/** Contributor from a grouped row: an organization name means ENTITY; otherwise first + last name, INDIVIDUAL. */
export function nyDonor(r: NyReceiptRow): Omit<Donor, "amount" | "count"> | null {
  const org = (r.flng_ent_name ?? "").trim();
  const person = [r.flng_ent_first_name, r.flng_ent_last_name].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  if (!org && !person) return null;
  return { name: org || person, type: org ? "ENTITY" : "INDIVIDUAL", employer: "", occupation: "", city: (r.flng_ent_city ?? "").trim(), state: (r.flng_ent_state ?? "").trim() };
}

const NOT_STATEWIDE = /\b(ASSEMBLY|SENATE|SENATOR|SUPREME|COURT|JUDGE|JUSTICE|COUNCIL|BOROUGH|COUNTY|MAYOR|DISTRICT|BK|BX|DA)\b/;
const NAME_PREFIX = new Set(["FRIENDS", "OF", "FOR", "TO", "ELECT", "REELECT", "RE", "COMMITTEE", "THE", "CITIZENS", "PEOPLE", "TEAM", "NEW", "YORKERS"]);
const NAME_NEXT = new Set(["FOR", "INC", "JR", "SR", "II", "III", "IV", "2024", "2025", "2026", "4", "2", "NY", "NEW", "COMMITTEE", "CAMPAIGN"]);

/**
 * Does a committee name belong to this candidate? BOE data has no candidate↔committee link, so
 * committees are matched by name: the candidate's last name must appear as a word, not followed by
 * another name ("Friends of Henry Butler" ≠ Henry), and preceded by nothing, a connective
 * ("Friends of", "for") or a first name with the candidate's first initial ("Jim Kernan" ≈ James
 * Kernan; "Friends of Mariama James" ≠ Letitia James). Weaker: "<First> for New York|Governor|…"
 * for a 6+ letter first name ("Saritha for New York"). Legislative/judicial/local names are rejected.
 */
export function nyCommitteeMatches(committee: string, candidate: string): boolean {
  return nyMatchScore(committee, candidate) > 0;
}

/** 2 = last-name match, 1 = first-name-only match ("Saritha for New York"), 0 = no match. */
export function nyMatchScore(committee: string, candidate: string): number {
  const c = normKey(committee).replace(/\./g, "");
  if (NOT_STATEWIDE.test(c)) return 0;
  const cand = normKey(candidate).split(" ").filter(Boolean);
  const last = cand[cand.length - 1];
  const first = cand[0];
  if (!last || last.length < 2) return 0;
  const toks = c.split(" ");
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] !== last) continue;
    const next = toks[i + 1];
    const prev = toks[i - 1];
    if (next && !NAME_NEXT.has(next)) continue;
    if (prev && !NAME_PREFIX.has(prev) && prev[0] !== first[0]) continue;
    return 2;
  }
  // "Saritha for New York": distinctive (6+ letter) first name + "for" + statewide wording.
  if (first.length >= 6 && toks[0] === first && toks[1] === "FOR" && /^(NEW YORK|NY|GOVERNOR|LT|LIEUTENANT|ATTORNEY|AG|COMPTROLLER)\b/.test(toks.slice(2).join(" "))) return 1;
  return 0;
}

interface Filer { filer_id: string; filer_name: string; office_desc?: string; committee_type_desc?: string; filer_status?: string }

/** Assign committees to statewide candidates by best match score; ties between two candidates are left out. */
export function nyAssignCommittees(cands: Filer[], committees: Filer[]): Map<string, Filer[]> {
  const out = new Map<string, Filer[]>(cands.map((c) => [c.filer_id, []]));
  for (const cm of committees) {
    const scored = cands.map((c) => ({ c, s: nyMatchScore(cm.filer_name, c.filer_name) })).filter((x) => x.s > 0);
    const best = Math.max(0, ...scored.map((x) => x.s));
    const hits = scored.filter((x) => x.s === best);
    if (hits.length === 1) out.get(hits[0].c.filer_id)!.push(cm);
  }
  return out;
}

const nyName = (s: string) => s.replace(/\s+/g, " ").trim();

const SELF_STOP = new Set(["FRIENDS", "FOR", "NEW", "YORK", "COMMITTEE", "ELECT", "REELECT", "PEOPLE", "CITIZENS", "THE", "AND", "TEAM", "STATE", "SENATE", "ASSEMBLY", "INC", "2022", "2023", "2024", "2025", "2026", "2028"]);
const nameTokens = (s: string) => new Set(normKey(s).split(" ").filter((t) => t.length >= 4 && !SELF_STOP.has(t)));

/**
 * Transfer between one candidate's own committees: the donor is itself a state candidate committee
 * whose name shares a distinctive word (the candidate's name) with the recipient committee
 * ("Friends of Joe Griffo 2024" → "Griffo for Senate 2026").
 */
export function nySelfTransfer(donorName: string, recipientName: string, candidateCommitteeNames: Set<string>): boolean {
  if (!candidateCommitteeNames.has(normKey(donorName))) return false;
  const r = nameTokens(recipientName);
  return [...nameTokens(donorName)].some((t) => r.has(t));
}

export interface NyAggregateInput {
  rows: NyReceiptRow[];
  committeeNames: Map<string, string>; // filer_id → committee name (all state candidate committees)
  committeeToCand: Map<string, string>; // committee filer_id → statewide candidate filer_id
  candidates: Map<string, CandidateTotals>;
}

/**
 * Fold grouped receipt rows. Contributions (A–D, G) are added first; refunds (M) are then
 * subtracted from the matching donor of the same recipient, matched by normalized name because
 * refund rows put a person's full name in the entity-name column. Refunds that match no donor
 * still reduce the candidate total.
 */
export function nyAggregate({ rows, committeeNames, committeeToCand, candidates }: NyAggregateInput, today = new Date().toISOString().slice(0, 10)): Map<string, Donor> {
  const all = new Map<string, Donor>();
  const ccNames = new Set([...committeeNames.values()].map(normKey));
  const byName = new Map<string, Donor[]>(); // `${recipient}|${NAME}` → donors (per-recipient, then global)
  const perRecipient = new Map<string, Map<string, Donor>>();
  const contributions = rows.filter((r) => r.filing_sched_abbrev !== "M");
  const refunds = rows.filter((r) => r.filing_sched_abbrev === "M");
  for (const r of contributions) {
    const d = nyDonor(r);
    const amount = num(r.amt);
    const fid = r.filer_id ?? "";
    if (!d || !amount) continue;
    if (d.type === "ENTITY" && nySelfTransfer(d.name, committeeNames.get(fid) ?? "", ccNames)) continue;
    addGrouped(all, d, amount, num(r.n));
    const pr = perRecipient.get(fid) ?? perRecipient.set(fid, new Map()).get(fid)!;
    addGrouped(pr, d, amount, num(r.n));
    const candId = committeeToCand.get(fid);
    const c = candId ? candidates.get(candId) : undefined;
    if (!c) continue;
    c.total += amount;
    c.count += num(r.n);
    if (d.type === "ENTITY") c.fromEntities += amount;
    const latest = ymd(r.latest);
    if (latest && latest <= today && (!c.latest || latest > c.latest)) c.latest = latest; // some filers mistype future dates
    addGrouped(c.donors, d, amount, num(r.n));
  }
  for (const [fid, m] of perRecipient) for (const d of m.values()) {
    const k = `${fid}|${normKey(d.name)}`;
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(d);
  }
  for (const r of refunds) {
    const amount = num(r.amt);
    const fid = r.filer_id ?? "";
    const raw = nyDonor(r);
    if (!amount || !raw) continue;
    const names = [raw.name, [r.flng_ent_first_name, r.flng_ent_last_name].filter(Boolean).join(" ")].filter(Boolean);
    const target = names.map((n) => byName.get(`${fid}|${normKey(n)}`)?.[0]).find(Boolean);
    const candId = committeeToCand.get(fid);
    const c = candId ? candidates.get(candId) : undefined;
    if (c) c.total -= amount;
    if (!target) continue;
    target.amount -= amount;
    const key = donorKey(target);
    const g = all.get(key);
    if (g) g.amount -= amount;
    if (c) {
      const cd = c.donors.get(key);
      if (cd) cd.amount -= amount;
      if (target.type === "ENTITY") c.fromEntities -= amount;
    }
  }
  for (const [k, d] of all) if (d.amount <= 0) all.delete(k);
  for (const c of candidates.values()) for (const [k, d] of c.donors) if (d.amount <= 0) c.donors.delete(k);
  return all;
}

const nyFinance: Adapter = {
  id: "state-ny-finance",
  name: "New York State Board of Elections: state campaign finance",
  url: "https://data.ny.gov/d/e9ss-239a",
  sourceKind: "data",
  method: "api",
  schedule: "Daily (BOE data on data.ny.gov updates daily)",
  refreshMinutes: 1440,
  dependsOn: ["curated"],
  coverage:
    "New York state races only. Itemized contributions since 1 Jan 2025 to candidates for Governor, Lieutenant Governor, Attorney General and Comptroller, counting all their authorized committees, including public-campaign-finance committees. Also ranks the largest donors to all New York state candidate committees, legislature and judiciary included. Party transfers count; refunds are subtracted. Excluded: candidates' and spouses' own money, transfers between a candidate's own committees, unitemized receipts, LLC member attributions, and public matching funds. The Board of Elections doesn't link committees to candidates, so they're matched by name. New York doesn't report donors' employers.",
  async run(ctx) {
    const dataAsOf = await sodaUpdatedAt(ctx, DOMAIN, DS_TX);
    const cands = await soda<Filer>(ctx, DOMAIN, DS_FILERS, {
      $select: "filer_id, filer_name, office_desc",
      $where: `compliance_type_desc = 'CANDIDATE' AND filer_type_desc = 'State' AND filer_status = 'ACTIVE' AND office_desc in (${Object.keys(NY_STATEWIDE).map(q).join(",")})`,
      $limit: 5000,
    });
    const committees = await sodaAll<Filer>(ctx, DOMAIN, DS_FILERS, {
      $select: "filer_id, filer_name, committee_type_desc, filer_status",
      $where: `compliance_type_desc = 'COMMITTEE' AND filer_type_desc = 'State' AND committee_type_desc in (${CANDIDATE_COMMITTEE_TYPES.map(q).join(",")})`,
      $order: "filer_id",
    });
    // Which candidate committees reported contributions since 2025 (cheap: grouped by filer).
    const active = await sodaAll<{ filer_id: string }>(ctx, DOMAIN, DS_TX, {
      $select: "filer_id, count(*) as n",
      $where: `election_year >= ${SINCE.slice(0, 4)} AND sched_date >= '${SINCE}T00:00:00' AND filing_sched_abbrev in ('A','B','C','D') AND r_itemized = 'Y'`,
      $group: "filer_id",
      $order: "filer_id",
    });
    const activeIds = new Set(active.map((r) => r.filer_id));
    const liveCommittees = committees.filter((c) => activeIds.has(c.filer_id));
    const byCand = nyAssignCommittees(cands, liveCommittees);
    const committeeToCand = new Map<string, string>();
    for (const [cid, cms] of byCand) for (const cm of cms) committeeToCand.set(cm.filer_id, cid);
    ctx.log(`BOE: ${cands.length} active statewide candidates, ${liveCommittees.length} state candidate committees with 2025–26 receipts`);

    const candidates = new Map<string, CandidateTotals>();
    for (const c of cands) {
      const cms = byCand.get(c.filer_id) ?? [];
      if (!cms.length) continue;
      candidates.set(c.filer_id, {
        filerId: c.filer_id, name: nyName(c.filer_name), office: NY_STATEWIDE[c.office_desc ?? ""], total: 0, count: 0,
        fromEntities: 0, latest: null, donors: new Map(), committees: cms.map((m) => `${m.filer_id} ${nyName(m.filer_name)}`),
      });
    }

    const ids = liveCommittees.map((c) => c.filer_id);
    const rowsAll: NyReceiptRow[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = await sodaAll<NyReceiptRow>(ctx, DOMAIN, DS_TX, {
        $select: NY_RECEIPT_SELECT,
        $where: nyReceiptWhere(ids.slice(i, i + 150)),
        $group: NY_RECEIPT_GROUP,
        $order: NY_RECEIPT_GROUP,
      });
      for (const r of chunk) rowsAll.push(r);
    }
    const rows = rowsAll.length;
    const all = nyAggregate({ rows: rowsAll, committeeNames: new Map(committees.map((c) => [c.filer_id, c.filer_name])), committeeToCand, candidates });
    ctx.log(`BOE: ${rows} grouped contributor rows; ${all.size} donors; ${[...candidates.values()].filter((c) => c.total >= 1000).length} statewide candidates ≥ $1,000`);
    const meta: StateFinanceMeta = { state: "NY", agency: BOE, sourceUrl: "https://data.ny.gov/d/e9ss-239a", dataAsOf };
    return buildFinanceEntities(meta, [...candidates.values()], all, ctx.lookup);
  },
};

// ---------------------------------------------------------------------------
// Lobbying

/**
 * Lobbyist Statement of Registration: 2025 - 2026 — https://data.ny.gov/d/dz6x-9475
 * (docs: COELIG_LobbyistStatementOfRegistration_DataDictionary.pdf on the "Beginning 2019" page,
 * https://data.ny.gov/d/se5j-cmbb). One filing (form_submission_id) spans many rows, one per
 * subject / focus / party lobbied.
 */
const DS_REG = "dz6x-9475";
/**
 * Lobbyist Bi-Monthly Reports: 2025 — https://data.ny.gov/d/kn4r-wkd3 and 2026 — https://data.ny.gov/d/r4pj-4cyj
 * (docs: COELIG_LobbyistBiMonthlyReports_DataDictionary.pdf / _Overview.pdf, https://data.ny.gov/d/t9kf-dqbc).
 * The overview says multiple rows can belong to one filing (form_submission_id); compensation and
 * reimbursed_expenses repeat on each row of a filing, so they're taken once per filing (max).
 * filing_type is 'Original' or 'Amendment', and both versions are published, so each
 * (principal lobbyist, contractual client, beneficial client, reporting period) keeps only its
 * latest filing: an Amendment over the Original, then the highest form_submission_id.
 * These tables hold 60–70 million rows a year and full aggregations exceed the request timeout,
 * so compensation is pulled per client (contractual_client_name equality filters are fast).
 */
const DS_BIMONTHLY: Record<string, string> = { "2025": "kn4r-wkd3", "2026": "r4pj-4cyj" };
const COELIG = "NYS Commission on Ethics and Lobbying in Government (COELIG)";
/** Clients (by number of 2025–26 registrations) whose actual bi-monthly compensation is pulled, in addition to every data-center client. */
const NY_TOP_CLIENTS = 150;

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
/** Beneficial client column is ";"-terminated and may list several clients. */
export const nyBeneficiaries = (s: string | undefined) => decode(s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
/** Client identity: the (first) beneficial client — on whose behalf lobbying is done — else the contractual client. */
export const nyClientName = (r: { beneficial_client_name?: string; contractual_client_name?: string }) =>
  nyBeneficiaries(r.beneficial_client_name)[0] ?? decode(r.contractual_client_name ?? "").trim();

/** "Hoyt, Sam; Grynspan, Howard ;" → ["Sam Hoyt", "Howard Grynspan"] */
export const nyLobbyists = (s: string | undefined) =>
  decode(s ?? "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^(.+?),\s*(.+)$/, "$2 $1").replace(/\s+/g, " "));

/** Bill numbers mentioned in a focus string ("S6394B, A 9086" → S6394, A9086). */
export const nyBillsIn = (s: string) => [...s.toUpperCase().matchAll(/\b([AS])\s?0*(\d{1,5})[A-Z]?\b/g)].map((m) => normBill(`${m[1]}${m[2]}`));

export interface NyBiRow {
  form_submission_id?: string;
  filing_type?: string;
  reporting_period?: string;
  principal_lobbyist_name?: string;
  contractual_client_name?: string;
  beneficial_client_name?: string;
  comp?: string;
  reimb?: string;
}

/** Keep the latest filing per lobbyist/client/period (Amendment over Original, then highest id); return comp + reimbursed expenses per client. */
export function nyLatestFilings(rows: (NyBiRow & { year: string })[]): Map<string, { amount: number; filings: number; firms: Set<string> }> {
  const best = new Map<string, NyBiRow & { year: string }>();
  const rank = (r: NyBiRow) => [r.filing_type === "Amendment" ? 1 : 0, num(r.form_submission_id)];
  for (const r of rows) {
    const k = [r.year, r.reporting_period, r.principal_lobbyist_name, r.contractual_client_name, r.beneficial_client_name].join("|");
    const cur = best.get(k);
    const [a1, b1] = rank(r);
    const [a2, b2] = cur ? rank(cur) : [-1, -1];
    if (!cur || a1 > a2 || (a1 === a2 && b1 > b2)) best.set(k, r);
  }
  const out = new Map<string, { amount: number; filings: number; firms: Set<string> }>();
  for (const r of best.values()) {
    const name = nyClientName(r);
    const o = out.get(normKey(name)) ?? { amount: 0, filings: 0, firms: new Set<string>() };
    o.amount += num(r.comp) + num(r.reimb);
    o.filings++;
    if (r.principal_lobbyist_name) o.firms.add(decode(r.principal_lobbyist_name).trim());
    out.set(normKey(name), o);
  }
  return out;
}

async function nyCompensation(ctx: Pick<AdapterContext, "fetch" | "env" | "log">, contractualNames: string[]) {
  const rows: (NyBiRow & { year: string })[] = [];
  for (const [year, ds] of Object.entries(DS_BIMONTHLY)) {
    for (let i = 0; i < contractualNames.length; i += 25) {
      const batch = contractualNames.slice(i, i + 25);
      const page = await sodaAll<NyBiRow>(ctx, DOMAIN, ds, {
        $select: "form_submission_id, filing_type, reporting_period, principal_lobbyist_name, contractual_client_name, beneficial_client_name, max(compensation) as comp, max(reimbursed_expenses) as reimb",
        $where: `contractual_client_name in (${batch.map(q).join(",")})`,
        $group: "form_submission_id, filing_type, reporting_period, principal_lobbyist_name, contractual_client_name, beneficial_client_name",
        $order: "form_submission_id, principal_lobbyist_name, contractual_client_name, beneficial_client_name, reporting_period, filing_type",
      });
      rows.push(...page.map((r) => ({ ...r, year })));
    }
  }
  return nyLatestFilings(rows);
}

interface RegRow { form_submission_id?: string; filing_type?: string; principal_lobbyist_name?: string; contractual_client_name?: string; beneficial_client_name?: string }

const nyLobby: Adapter = {
  id: "state-ny-lobby",
  name: "NY COELIG: lobbying",
  url: "https://data.ny.gov/d/dz6x-9475",
  sourceKind: "data",
  method: "api",
  schedule: "Weekly (COELIG updates its data.ny.gov tables every few weeks)",
  refreshMinutes: 10_080,
  dependsOn: ["curated", "openstates"],
  coverage:
    "New York state and local lobbying registrations for 2025–26: each client, its lobbying firms and registered lobbyists. Dollar amounts are the compensation plus reimbursed expenses that lobbyists actually reported on 2025 and 2026 bi-monthly reports, using the latest amendment of each report. Amounts are pulled for the 150 clients with the most registrations and for every data-center client; other clients are listed without amounts. A client is flagged for data centers when its registration's lobbying subjects or focus mention data centers or name a tracked data-center bill. COELIG data lags by about two months, and NYC Lobbying Bureau filings aren't included.",
  async run(ctx) {
    const dataAsOf = await sodaUpdatedAt(ctx, DOMAIN, DS_REG);
    const warnings: string[] = [];
    const regs = await sodaAll<RegRow>(ctx, DOMAIN, DS_REG, {
      $select: "form_submission_id, filing_type, principal_lobbyist_name, contractual_client_name, beneficial_client_name",
      $group: "form_submission_id, filing_type, principal_lobbyist_name, contractual_client_name, beneficial_client_name",
      $order: "form_submission_id, principal_lobbyist_name, contractual_client_name, beneficial_client_name, filing_type",
    });
    const book = new ClientBook();
    const contractualFor = new Map<string, Set<string>>(); // client key → contractual names to query
    const seenReg = new Set<string>();
    for (const r of regs) {
      const name = nyClientName(r);
      if (!name) continue;
      const c = book.get(name);
      const firm = decode(r.principal_lobbyist_name ?? "").trim();
      const regKey = `${normKey(name)}|${normKey(firm)}`; // amendments of the same registration count once
      if (!seenReg.has(regKey)) {
        seenReg.add(regKey);
        c.filings++;
      }
      if (firm && normKey(firm) !== normKey(name)) ClientBook.push(c.firms, firm, 40);
      const k = normKey(name);
      (contractualFor.get(k) ?? contractualFor.set(k, new Set()).get(k)!).add(decode(r.contractual_client_name ?? "").trim());
    }
    // Individual lobbyists per contractual client (optional; this grouping is heavy).
    try {
      const lob = await sodaAll<{ contractual_client_name?: string; beneficial_client_name?: string; individual_lobbyist_s?: string }>(ctx, DOMAIN, DS_REG, {
        $select: "contractual_client_name, beneficial_client_name, individual_lobbyist_s",
        $group: "contractual_client_name, beneficial_client_name, individual_lobbyist_s",
        $order: "contractual_client_name, beneficial_client_name, individual_lobbyist_s",
      });
      for (const r of lob) {
        const name = nyClientName(r);
        if (name && book.has(name)) for (const l of nyLobbyists(r.individual_lobbyist_s)) ClientBook.push(book.get(name).lobbyists, l, 40);
      }
    } catch (err) {
      warnings.push(`NY individual lobbyist names unavailable this run: ${(err as Error).message}`);
    }
    // Data-center mentions in registration subjects / focus (bill numbers or descriptions).
    const dcBills = dataCenterBills(ctx.lookup, "NY");
    const dcRows = await sodaAll<{ contractual_client_name?: string; beneficial_client_name?: string; lobbying_subjects?: string; focus_identifying_number?: string }>(ctx, DOMAIN, DS_REG, {
      $select: "contractual_client_name, beneficial_client_name, lobbying_subjects, focus_identifying_number",
      $where: [dataCenterWhere(["focus_identifying_number", "lobbying_subjects"]), ...[...dcBills].map((b) => `upper(focus_identifying_number) like ${q(`%${b}%`)}`)].join(" OR "),
      $group: "contractual_client_name, beneficial_client_name, lobbying_subjects, focus_identifying_number",
      $order: "contractual_client_name, beneficial_client_name, lobbying_subjects, focus_identifying_number",
    });
    for (const r of dcRows) {
      const text = `${r.lobbying_subjects ?? ""} ${r.focus_identifying_number ?? ""}`;
      if (!DATA_CENTER_RE.test(text) && !nyBillsIn(r.focus_identifying_number ?? "").some((b) => dcBills.has(b))) continue;
      const name = nyClientName(r);
      if (!name) continue;
      const c = book.get(name);
      c.dataCenter = true;
      ClientBook.push(c.issues, r.focus_identifying_number || r.lobbying_subjects);
    }
    // Actual reported compensation for the most-registered clients and all data-center clients.
    const all = book.list();
    const chosen = new Set<LobbyClient>([...all].sort((a, b) => b.filings - a.filings).slice(0, NY_TOP_CLIENTS));
    for (const c of all) if (c.dataCenter) chosen.add(c);
    const contractual = [...new Set([...chosen].flatMap((c) => [...(contractualFor.get(normKey(c.name)) ?? [])]))].filter(Boolean);
    try {
      const comp = await nyCompensation(ctx, contractual);
      for (const c of chosen) {
        const o = comp.get(normKey(c.name));
        if (!o) continue;
        c.amount = o.amount;
        for (const f of o.firms) if (normKey(f) !== normKey(c.name)) ClientBook.push(c.firms, f, 40);
      }
    } catch (err) {
      warnings.push(`NY bi-monthly compensation unavailable this run: ${(err as Error).message}`);
    }
    ctx.log(`COELIG: ${regs.length} registration filings, ${all.length} clients, ${all.filter((c) => c.dataCenter).length} data-center clients, compensation pulled for ${chosen.size}`);
    const meta: StateLobbyMeta = {
      state: "NY", agency: COELIG, sourceUrl: "https://data.ny.gov/d/dz6x-9475", dataAsOf,
      amountMeaning: `Compensation plus reimbursed expenses reported on 2025–26 bi-monthly lobbyist reports (latest amendment of each), for the ${NY_TOP_CLIENTS} most-registered clients and all data-center clients; others not computed`,
      period: "2025–2026 biennial registrations; bi-monthly reports Jan 2025 onward",
    };
    return { entities: [buildLobbyEntity(meta, all, seenReg.size)], warnings };
  },
};

export const adapters: Adapter[] = [nyFinance, nyLobby];
