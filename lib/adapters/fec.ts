import { unzipSync, strFromU8 } from "fflate";
import type { Adapter, Entity } from "../ingest/types";

const BULK = "https://www.fec.gov/files/bulk-downloads/2026";

/** Column layout of the FEC "current campaigns for House and Senate" file (webl). */
const WEBL_COLUMNS = [
  "CAND_ID", "CAND_NAME", "CAND_ICI", "PTY_CD", "CAND_PTY_AFFILIATION", "TTL_RECEIPTS",
  "TRANS_FROM_AUTH", "TTL_DISB", "TRANS_TO_AUTH", "COH_BOP", "COH_COP", "CAND_CONTRIB",
  "CAND_LOANS", "OTHER_LOANS", "CAND_LOAN_REPAY", "OTHER_LOAN_REPAY", "DEBTS_OWED_BY",
  "TTL_INDIV_CONTRIB", "CAND_OFFICE_ST", "CAND_OFFICE_DISTRICT", "SPEC_ELECTION",
  "PRIM_ELECTION", "RUN_ELECTION", "GEN_ELECTION", "GEN_ELECTION_PRECENT",
  "OTHER_POL_CMTE_CONTRIB", "POL_PTY_CONTRIB", "CVG_END_DT", "INDIV_REFUNDS", "CMTE_REFUNDS",
] as const;

const PARTY: Record<string, string> = { DEM: "D", REP: "R", IND: "I", LIB: "L", GRE: "G", DFL: "D" };
const ICI: Record<string, string> = { I: "incumbent", C: "challenger", O: "open seat" };

/** Minimal RFC 4180 CSV parser (handles quoted fields with commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "16-MAY-26" → "2026-05-16"; "02/13/2026" → "2026-02-13" */
export function fecDate(s: string): string | null {
  let m = s.match(/^(\d{2})-([A-Z]{3})-(\d{2})$/);
  if (m && MONTHS[m[2]]) return `20${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

/** "BEGICH, NICHOLAS III" → "Nicholas Begich III" */
export function fecName(raw: string): string {
  const [last, rest = ""] = raw.split(",").map((s) => s.trim());
  const cap = (w: string) => w.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  const parts = rest.split(/\s+/).filter(Boolean);
  const suffix = parts.length > 1 && /^(JR|SR|II|III|IV)\.?$/i.test(parts.at(-1)!) ? parts.pop()! : "";
  return [cap(parts.join(" ")), cap(last), suffix.toUpperCase()].filter(Boolean).join(" ");
}

/** One raw Schedule E filing line (not summed — raw rows can't be safely aggregated). */
interface IeFiling {
  date: string | null;
  amount: number;
  side: "support" | "oppose";
  spender: string;
  spenderId: string;
  purpose: string;
  payee: string;
  filingUrl: string | null;
}

/**
 * FEC bulk data for the 2026 cycle:
 *   - webl26: official financial summary for every House/Senate campaign that has filed
 *   - independent_expenditure_2026.csv: raw Schedule E lines (listed per candidate as
 *     recent filings; totals come from the processed API in fec-ie)
 */
export const fecAdapter: Adapter = {
  id: "fec-bulk",
  name: "FEC campaign finance (2026 cycle)",
  url: "https://www.fec.gov/data/browse-data/?tab=bulk-data",
  sourceKind: "data",
  method: "bulk",
  schedule: "Daily (FEC rebuilds the bulk files nightly)",
  refreshMinutes: 720,
  coverage:
    "Federal candidates only (House and Senate): each candidate committee's official totals through its latest report, plus each candidate's most recent raw independent-expenditure filings (24/48-hour and periodic). It excludes state and local races, unreported issue ads and lobbying.",
  async run({ fetch, log }) {
    const zip = new Uint8Array(await (await fetch(`${BULK}/webl26.zip`)).arrayBuffer());
    const files = unzipSync(zip);
    const txtName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".txt"));
    if (!txtName) throw new Error("webl26.zip did not contain a .txt file");
    const lines = strFromU8(files[txtName]).split(/\r?\n/).filter(Boolean);

    const source = {
      title: "FEC bulk data: Current campaigns for House and Senate (2025–2026)",
      url: "https://www.fec.gov/campaign-finance-data/current-campaigns-house-and-senate-file-description/",
      publisher: "Federal Election Commission",
      kind: "data" as const,
    };

    // Raw independent-expenditure lines → most recent filings per candidate.
    const ieText = await (await fetch(`${BULK}/independent_expenditure_2026.csv`)).text();
    const [header, ...ieRows] = parseCsv(ieText);
    const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    for (const required of ["cand_id", "spe_id", "spe_nam", "exp_amo", "sup_opp", "tran_id", "file_num", "image_num"]) {
      if (!(required in col)) throw new Error(`IE file missing column ${required}; FEC layout may have changed`);
    }
    // Amendments re-file the same transaction: keep the highest file number per (committee, transaction).
    const latest = new Map<string, string[]>();
    for (const r of ieRows) {
      if (r.length < header.length) continue;
      const key = `${r[col.spe_id]}|${r[col.tran_id]}`;
      const prev = latest.get(key);
      if (!prev || Number(r[col.file_num]) > Number(prev[col.file_num])) latest.set(key, r);
    }
    const recent = new Map<string, IeFiling[]>();
    for (const r of latest.values()) {
      const cand = r[col.cand_id];
      const amount = Number(r[col.exp_amo]);
      if (!cand || !Number.isFinite(amount) || amount <= 0) continue;
      const list = recent.get(cand) ?? [];
      list.push({
        date: fecDate(r[col.dissem_dt] ?? "") ?? fecDate(r[col.exp_date] ?? ""),
        amount,
        side: r[col.sup_opp] === "O" ? "oppose" : "support",
        spender: r[col.spe_nam],
        spenderId: r[col.spe_id],
        purpose: r[col.pur],
        payee: r[col.pay],
        filingUrl: r[col.image_num] ? `https://docquery.fec.gov/cgi-bin/fecimg/?${r[col.image_num]}` : null,
      });
      recent.set(cand, list);
    }
    log(`IE: ${ieRows.length} raw lines → ${latest.size} unique transactions for ${recent.size} candidates`);

    const entities: Entity[] = [];
    for (const line of lines) {
      const f = line.split("|");
      if (f.length < WEBL_COLUMNS.length) continue;
      const v = Object.fromEntries(WEBL_COLUMNS.map((c, i) => [c, f[i]])) as Record<(typeof WEBL_COLUMNS)[number], string>;
      const office = v.CAND_ID[0] === "S" ? "U.S. Senate" : v.CAND_ID[0] === "H" ? "U.S. House" : null;
      if (!office) continue;
      const num = (k: (typeof WEBL_COLUMNS)[number]) => Number(v[k]) || 0;
      const filings = (recent.get(v.CAND_ID) ?? [])
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.amount - a.amount)
        .slice(0, 12);
      const name = fecName(v.CAND_NAME);
      entities.push({
        id: `finance:${v.CAND_ID}`,
        kind: "finance",
        state: v.CAND_OFFICE_ST,
        title: name,
        date: fecDate(v.CVG_END_DT),
        status: ICI[v.CAND_ICI] ?? null,
        searchText: `${office} ${v.CAND_OFFICE_ST} ${v.CAND_OFFICE_DISTRICT}`,
        sources: [source],
        confidence: "high",
        data: {
          fecId: v.CAND_ID,
          name,
          office,
          state: v.CAND_OFFICE_ST,
          district: office === "U.S. House" ? v.CAND_OFFICE_DISTRICT : null,
          party: PARTY[v.CAND_PTY_AFFILIATION] ?? v.CAND_PTY_AFFILIATION,
          status: ICI[v.CAND_ICI] ?? null,
          special: Boolean(v.SPEC_ELECTION),
          receipts: num("TTL_RECEIPTS"),
          disbursements: num("TTL_DISB"),
          cashOnHand: num("COH_COP"),
          individualContributions: num("TTL_INDIV_CONTRIB"),
          pacContributions: num("OTHER_POL_CMTE_CONTRIB"),
          partyContributions: num("POL_PTY_CONTRIB"),
          candidateSelfFunding: num("CAND_CONTRIB") + num("CAND_LOANS"),
          debts: num("DEBTS_OWED_BY"),
          coverageEnd: fecDate(v.CVG_END_DT),
          fecUrl: `https://www.fec.gov/data/candidate/${v.CAND_ID}/`,
          recentIeFilings: filings,
        },
      });
    }
    return { entities };
  },
};

/**
 * FEC processed independent-expenditure totals by candidate and by spender.
 * Processed data is FEC's deduplicated coding of Schedule E and can lag the
 * newest 24/48-hour notices by days to weeks.
 */
export const fecIeAdapter: Adapter = {
  id: "fec-ie",
  name: "FEC outside spending totals (processed)",
  url: "https://api.open.fec.gov/developers/",
  sourceKind: "data",
  method: "api",
  schedule: "Daily",
  refreshMinutes: 1440,
  coverage:
    "Independent-expenditure totals that support or oppose each federal candidate, as processed by FEC. They can lag the latest 24/48-hour reports. Spender detail comes from the raw filings in fec-bulk. Party coordinated spending, communication costs and non-reported issue ads aren't included.",
  requiresEnv: "FEC_API_KEY",
  async run({ fetch, env, log }) {
    const key = env.FEC_API_KEY!;
    async function all<T>(path: string): Promise<T[]> {
      const out: T[] = [];
      for (let page = 1; ; page++) {
        const url = `https://api.open.fec.gov/v1${path}&api_key=${key}&cycle=2026&election_full=true&per_page=100&page=${page}`;
        const j = (await (await fetch(url)).json()) as { results: T[]; pagination: { pages: number } };
        out.push(...j.results);
        if (page >= j.pagination.pages) break;
      }
      return out;
    }
    type Row = { candidate_id: string; support_oppose_indicator: "S" | "O"; total: number; committee_id?: string; committee_name?: string };
    // Only the candidate-level totals endpoint fits the key's rate limit (~10 pages).
    // The per-spender endpoint requires office + state, i.e. 100+ requests per run;
    // spenders are shown instead from the raw filings ingested by fec-bulk.
    const totals = await all<Row>("/schedules/schedule_e/totals/by_candidate/?");
    log(`FEC IE: ${totals.length} candidate totals`);

    const agg = new Map<string, { support: number; oppose: number; spenders: { committeeId: string; name: string; side: string; total: number }[] }>();
    for (const r of totals) {
      const a = agg.get(r.candidate_id) ?? { support: 0, oppose: 0, spenders: [] };
      a[r.support_oppose_indicator === "O" ? "oppose" : "support"] += r.total;
      agg.set(r.candidate_id, a);
    }
    const source = {
      title: "FEC API: Schedule E totals by candidate (processed)",
      url: "https://www.fec.gov/data/independent-expenditures/?data_type=processed&cycle=2026",
      publisher: "Federal Election Commission",
      kind: "data" as const,
    };
    return {
      entities: [...agg.entries()].map(([cand, a]) => ({
        id: `ie:${cand}`,
        kind: "finance" as const,
        title: `Outside spending: ${cand}`,
        status: "ie_totals",
        sources: [source],
        confidence: "high" as const,
        data: {
          fecId: cand,
          support: Math.round(a.support),
          oppose: Math.round(a.oppose),
          topSpenders: a.spenders.sort((x, y) => y.total - x.total).slice(0, 10),
        },
      })),
      relations: [...agg.keys()].map((cand) => ({ src: `ie:${cand}`, dst: `finance:${cand}`, type: "outside_spending_for" })),
    };
  },
};
