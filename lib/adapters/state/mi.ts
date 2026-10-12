import type { Adapter, AdapterContext } from "../../ingest/types";
import { addDonation, buildFinanceEntities, displayName, SINCE, type CandidateTotals, type Donor, type StatewideOffice } from "./contract";
import { cachedDownload, credit, CrossFilingDedupe, headerIndex, isSelf, mdy, newCandidate, zipLines } from "./al";

/**
 * Michigan state campaign finance from the Bureau of Elections' MiTN
 * all-transaction export (annual Contribution_{YEAR}.zip files of
 * tab-delimited text, rebuilt nightly).
 *
 * robots.txt (checked 2026-10-12): mi-boe.entellitrak.com/robots.txt is a 404
 * (no rules); the export pages and files load without a challenge. The legacy
 * host (miboecfr.nictusa.com) sits behind a Cloudflare 403 and is not used.
 *
 * Record layout: the export's header row (doc_seq_no, contribution_id,
 * cont_detail_id, doc_stmnt_year, doc_type_desc, com_legal_name,
 * common_name_acronym, cfr_com_id, com_type, can_first_name, can_last_name,
 * contribtype, contributor_f_name, contributor_l_name_or_org, …,
 * received_date, amount, aggregate, extra_desc, fundraiser,
 * can_political_party, can_office_sought, can_district_sought). The MiTN
 * download page publishes no separate layout document, so fields are used
 * only as their names state: doc_seq_no identifies the filed statement,
 * cfr_com_id the receiving committee, com_type "Candidate" a candidate
 * committee and can_office_sought its office. Rows with a non-zero
 * cont_detail_id are supplemental detail lines of another transaction and are
 * skipped so nothing is counted twice.
 */

const BASE = "https://mi-boe.entellitrak.com/etk-mi-boe-prod/page.request.do";
const PAGE = `${BASE}?page=gov.mi.boe.component.cfrexport.page.cfrexportdownload`;
const LIST = `${BASE}?page=gov.mi.boe.component.cfrexport.page.cfrexportresults&pageSize=100`;
const AGENCY = "Michigan Department of State, Bureau of Elections (MiTN)";

/** Statewide offices on Michigan's 2026 ballot that file as candidate committees (Lt. Governor runs on the Governor's ticket). */
export const MI_STATEWIDE: Record<string, StatewideOffice> = {
  Governor: "Governor",
  "Secretary of State": "Secretary of State",
  "Attorney General": "Attorney General",
};

export function miRow(f: string[], ix: Record<string, number>): {
  committee: string; candidate: string; office: string; donor: Omit<Donor, "amount" | "count">; date: string; amount: number; filing: string;
} | null {
  if (f[ix.com_type] !== "Candidate") return null;
  if ((f[ix.cont_detail_id] ?? "").trim() && f[ix.cont_detail_id].trim() !== "0") return null;
  if (!/^Direct Contributions( - Private Funds)?$/.test(f[ix.contribtype])) return null; // loans excluded
  const date = mdy(f[ix.received_date]);
  const amount = Number(f[ix.amount]);
  if (!date || date < SINCE || !(amount > 0)) return null;
  const first = (f[ix.contributor_f_name] ?? "").trim();
  const last = (f[ix.contributor_l_name_or_org] ?? "").trim();
  if (!last) return null;
  const type: Donor["type"] = first ? "INDIVIDUAL" : "ENTITY";
  return {
    committee: f[ix.cfr_com_id],
    candidate: displayName(`${f[ix.can_first_name]} ${f[ix.can_last_name]}`.trim()),
    office: (f[ix.can_office_sought] ?? "").trim(),
    donor: {
      name: (type === "INDIVIDUAL" ? `${first} ${last}` : last).replace(/\s+/g, " "), type,
      employer: (f[ix.contributor_employer] ?? "").trim(), occupation: (f[ix.contributor_occupation] ?? "").trim(),
      city: (f[ix.contributor_city] ?? "").trim(), state: (f[ix.contributor_state] ?? "").trim(),
    },
    date, amount, filing: f[ix.doc_seq_no],
  };
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

async function run(ctx: AdapterContext) {
  const { log, lookup } = ctx;
  const listing = (await (await ctx.fetch(LIST)).json()) as { data: { list: { transactiontype: string; year: number; lastupdatedraw: string; download: number }[] } };
  const files = listing.data.list.filter((r) => r.transactiontype === "Contribution" && r.year >= 2025).sort((a, b) => a.year - b.year);
  if (!files.length) throw new Error("MiTN listing has no 2025–26 contribution exports");
  const cands = new Map<string, CandidateTotals>();
  const allDonors = new Map<string, Donor>();
  const dedupe = new CrossFilingDedupe();
  let kept = 0;
  let self = 0;
  let dataAsOf: string | null = null;
  for (const file of files) {
    // The download id changes on every nightly rebuild, so the cache is keyed on the listing's "last updated" stamp.
    const { path } = await cachedDownload(ctx.fetch, `${BASE}?page=gov.mi.boe.component.cfrexport.page.cfrexportfile&id=${file.download}`, `mi-mitn-contributions-${file.year}.zip`, file.lastupdatedraw, log);
    dataAsOf = file.lastupdatedraw;
    let ix: Record<string, number> | null = null;
    for await (const { line } of zipLines(path, (n) => /\.txt$/i.test(n), "windows-1252")) {
      const f = line.split("\t");
      if (f[0] === "doc_seq_no") { ix ??= headerIndex(f); continue; } // each member repeats the header
      if (!ix) continue;
      const r = miRow(f, ix);
      if (!r) continue;
      if (isSelf(r.donor.name, r.candidate)) { self++; continue; }
      if (!dedupe.accept(r.committee, r.donor.name, r.date, r.amount, r.filing)) continue;
      kept++;
      addDonation(allDonors, r.donor, r.amount);
      const office = MI_STATEWIDE[r.office];
      if (!office) continue;
      const c = cands.get(r.committee) ?? newCandidate(r.committee, titleCase(r.candidate), office, [r.committee]);
      cands.set(r.committee, c);
      credit(c, r.donor, r.amount, r.date);
    }
  }
  log(`MiTN: kept ${kept} contributions to state candidate committees since ${SINCE}; ${dedupe.dropped} repeated across statements; ${self} self-funding rows excluded`);
  return buildFinanceEntities({ state: "MI", agency: AGENCY, sourceUrl: PAGE, dataAsOf }, [...cands.values()], allDonors, lookup);
}

export const adapters: Adapter[] = [
  {
    id: "state-mi-finance",
    name: "Michigan Bureau of Elections: state campaign finance (MiTN)",
    url: PAGE,
    sourceKind: "data",
    method: "bulk",
    schedule: "Daily (MiTN rebuilds the exports nightly; re-downloaded only when the listing's 'last updated' changes)",
    refreshMinutes: 1440,
    coverage:
      "Michigan state races. Itemized direct contributions since Jan. 1, 2025 to candidate committees for Governor, Secretary of State and Attorney General, plus the largest donors to all state-level candidate committees (legislature, courts, education boards). A contribution repeated on more than one campaign statement is counted once; loans and candidates' own money are excluded. PAC, party and caucus committees' receipts aren't counted toward candidates; county and local candidates aren't in this state export.",
    run,
  },
];
