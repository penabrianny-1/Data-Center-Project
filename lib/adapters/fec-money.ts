import { strFromU8, unzipSync } from "fflate";
import type { Adapter, Entity, Relation } from "../ingest/types";
import { fecDate, fecName, parseCsv } from "./fec";

const BULK = "https://www.fec.gov/files/bulk-downloads/2026";

/**
 * Who is spending and giving in the 2026 federal elections, from four official
 * FEC bulk files (no key needed):
 *   cm26     committee master: committee type, designation, interest-group org type, connected org
 *   webk26   PAC & party financial summaries (through each committee's latest periodic report)
 *   pas226   committee → candidate transactions: PAC contributions (24K) and processed IEs
 *   independent_expenditure_2026.csv  24/48-hour IE notices: the most current outside spending
 *
 * IE notices are made amendment-aware by dropping every filing that a later
 * filing supersedes (prev_file_num). Transaction ids are reused across filings,
 * so they can't be used to dedupe. Implausible single entries (> $100M) are
 * excluded and reported.
 */

const MAX_SINGLE_IE = 100_000_000;

/** FEC committee type codes → plain-language interest category. */
export function committeeCategory(cmteType: string, designation: string, orgType: string): { category: string; group: string } {
  if (["X", "Y", "Z"].includes(cmteType)) return { category: "Party committee", group: "party" };
  if (cmteType === "O") return { category: "Super PAC", group: "super_pac" };
  if (cmteType === "U") return { category: "Single-candidate super PAC", group: "super_pac" };
  if (["V", "W"].includes(cmteType)) return { category: "Hybrid PAC (super PAC + PAC)", group: "super_pac" };
  if (cmteType === "I") return { category: "Individual / group (Form 5)", group: "other" };
  if (["H", "S", "P"].includes(cmteType)) return { category: "Candidate committee", group: "candidate" };
  if (designation === "D") return { category: "Leadership PAC", group: "leadership" };
  const org: Record<string, [string, string]> = {
    C: ["Corporate PAC", "corporate"], W: ["Corporate PAC", "corporate"], L: ["Labor union PAC", "labor"],
    T: ["Trade association PAC", "trade"], M: ["Membership / ideological PAC", "ideological"], V: ["Cooperative PAC", "corporate"],
  };
  if (org[orgType]) return { category: org[orgType][0], group: org[orgType][1] };
  if (designation === "B") return { category: "Lobbyist / registrant PAC", group: "lobbyist" };
  return { category: "Nonconnected PAC", group: "ideological" };
}

async function unzipText(fetchFn: (u: string) => Promise<Response>, name: string): Promise<string> {
  const files = unzipSync(new Uint8Array(await (await fetchFn(`${BULK}/${name}.zip`)).arrayBuffer()));
  const txt = Object.keys(files).find((n) => n.toLowerCase().endsWith(".txt"));
  if (!txt) throw new Error(`${name}.zip has no .txt file`);
  return strFromU8(files[txt]);
}

interface Committee {
  id: string;
  name: string;
  type: string;
  designation: string;
  orgType: string;
  connectedOrg: string;
  party: string;
  state: string;
  category: string;
  group: string;
}
interface Agg {
  support: number;
  oppose: number;
  /** General-election $ helping Democrats (support D + oppose R) vs Republicans */
  proD: number;
  proR: number;
  /** Primary/runoff $ (intra-party; excluded from partisan lean) */
  primary: number;
  byState: Map<string, number>;
  byCandidate: Map<string, { support: number; oppose: number }>;
  lastDate: string;
  filings: number;
}
const newAgg = (): Agg => ({ support: 0, oppose: 0, proD: 0, proR: 0, primary: 0, byState: new Map(), byCandidate: new Map(), lastDate: "", filings: 0 });
const PARTY: Record<string, string> = { DEM: "D", REP: "R", "DEMOCRATIC PARTY": "D", "REPUBLICAN PARTY": "R", DFL: "D" };
const partyOf = (s: string) => PARTY[s?.toUpperCase()] ?? (s ? (/DEM/i.test(s) ? "D" : /REP/i.test(s) ? "R" : "Other") : "Other");

export const fecMoneyAdapter: Adapter = {
  id: "fec-money",
  name: "FEC outside spenders & PAC contributors (2026)",
  url: "https://www.fec.gov/data/browse-data/?tab=bulk-data",
  sourceKind: "data",
  method: "bulk",
  schedule: "Every 12 hours (FEC rebuilds bulk files nightly)",
  refreshMinutes: 720,
  coverage:
    "Federal races only. Covers outside spending by every super PAC, party committee and other group: current totals from 24/48-hour notices (amendment-adjusted), broken down by state and by candidate supported or opposed. Also covers PAC contributions to candidates, and committee finances through each committee's last periodic report. Interest categories come from FEC's own committee and organization type codes. Excluded: state and local races, dark-money issue ads not reported as independent expenditures, and individual donors.",
  async run({ fetch, log }) {
    const warnings: string[] = [];

    // --- Committee master
    const committees = new Map<string, Committee>();
    for (const line of (await unzipText(fetch, "cm26")).split(/\r?\n/)) {
      const f = line.split("|");
      if (f.length < 15) continue;
      const { category, group } = committeeCategory(f[9], f[8], f[12]);
      committees.set(f[0], { id: f[0], name: f[1], type: f[9], designation: f[8], orgType: f[12], connectedOrg: f[13], party: f[10], state: f[6], category, group });
    }

    // --- PAC & party summaries (webk): 27 columns
    const summaries = new Map<string, { receipts: number; disbursements: number; cash: number; ie: number; coordinated: number; contribToCmtes: number; through: string | null }>();
    for (const line of (await unzipText(fetch, "webk26")).split(/\r?\n/)) {
      const f = line.split("|");
      if (f.length < 27) continue;
      summaries.set(f[0], {
        receipts: Number(f[5]) || 0, disbursements: Number(f[12]) || 0, cash: Number(f[19]) || 0,
        contribToCmtes: Number(f[22]) || 0, ie: Number(f[23]) || 0, coordinated: Number(f[24]) || 0, through: fecDate(f[26]),
      });
    }

    // --- Candidate lookup (for party/state of targets) from the current-campaigns file via existing finance? Use IE rows' own fields.
    const candInfo = new Map<string, { name: string; state: string; office: string; district: string; party: string }>();

    // --- 24/48-hour IE notices (current)
    const ieText = await (await fetch(`${BULK}/independent_expenditure_2026.csv`)).text();
    const [header, ...rows] = parseCsv(ieText);
    const c = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    for (const k of ["cand_id", "spe_id", "spe_nam", "exp_amo", "sup_opp", "file_num", "prev_file_num", "can_office_state", "cand_pty_aff"]) {
      if (!(k in c)) throw new Error(`IE file missing column ${k}`);
    }
    const superseded = new Set(rows.map((r) => r[c.prev_file_num]).filter(Boolean));
    const spenders = new Map<string, Agg>();
    const stateTotals = new Map<string, Agg>();
    const candTotals = new Map<string, Agg & { spenders: Map<string, { support: number; oppose: number }> }>();
    let excluded = 0;
    let excludedAmount = 0;
    for (const r of rows) {
      if (r.length < header.length || superseded.has(r[c.file_num])) continue;
      const amt = Number(r[c.exp_amo]);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      if (amt > MAX_SINGLE_IE) {
        excluded++;
        excludedAmount += amt;
        continue;
      }
      const side = r[c.sup_opp] === "O" ? "oppose" : "support";
      const party = partyOf(r[c.cand_pty_aff]);
      const st = r[c.can_office_state] || "US";
      const cand = r[c.cand_id];
      const date = fecDate(r[c.dissem_dt] ?? "") ?? fecDate(r[c.exp_date] ?? "") ?? "";
      // Partisan lean counts general-election spending only: supporting a Democrat or opposing a Republican helps
      // Democrats, and vice versa. Primary/runoff spending is intra-party and tracked separately.
      const general = !/^[PR]/i.test(r[c.ele_type] ?? "");
      const pro = !general ? null : party === "D" ? (side === "support" ? "proD" : "proR") : party === "R" ? (side === "support" ? "proR" : "proD") : null;
      const bump = (a: Agg) => {
        a[side] += amt;
        if (pro) a[pro] += amt;
        if (!general) a.primary += amt;
        a.byState.set(st, (a.byState.get(st) ?? 0) + amt);
        if (cand) {
          const x = a.byCandidate.get(cand) ?? { support: 0, oppose: 0 };
          x[side] += amt;
          a.byCandidate.set(cand, x);
        }
        a.filings++;
        if (date > a.lastDate) a.lastDate = date;
      };
      const sp = spenders.get(r[c.spe_id]) ?? newAgg();
      bump(sp);
      spenders.set(r[c.spe_id], sp);
      const sa = stateTotals.get(st) ?? newAgg();
      bump(sa);
      stateTotals.set(st, sa);
      // per-state spender breakdown is derived from sp.byState; per-candidate spenders:
      if (cand) {
        const ca = candTotals.get(cand) ?? { ...newAgg(), spenders: new Map() };
        bump(ca);
        const s2 = ca.spenders.get(r[c.spe_id]) ?? { support: 0, oppose: 0 };
        s2[side] += amt;
        ca.spenders.set(r[c.spe_id], s2);
        candTotals.set(cand, ca);
        if (!candInfo.has(cand)) candInfo.set(cand, { name: fecName(r[c.cand_name] ?? ""), state: st, office: r[c.can_office] ?? "", district: r[c.can_office_dis] ?? "", party });
      }
      if (!committees.has(r[c.spe_id])) {
        committees.set(r[c.spe_id], { id: r[c.spe_id], name: r[c.spe_nam], type: "", designation: "", orgType: "", connectedOrg: "", party: "", state: "", category: "Unregistered spender", group: "other" });
      }
    }
    if (excluded) warnings.push(`Excluded ${excluded} implausible IE entries over $100M each (total $${(excludedAmount / 1e9).toFixed(1)}B), apparently erroneous self-filed reports.`);
    log(`IE notices: ${rows.length} rows, ${superseded.size} superseded filings dropped, ${spenders.size} spenders`);

    // --- PAC contributions to candidates (pas2, 24K) and processed IEs (24A/24E)
    const pac = new Map<string, Map<string, number>>(); // cand → (cmte → $)
    const pacByState = new Map<string, Map<string, number>>(); // state → (cmte → $)
    const pacGiving = new Map<string, number>(); // cmte → total given to candidates
    for (const line of (await unzipText(fetch, "pas226")).split(/\r?\n/)) {
      const f = line.split("|");
      if (f.length < 22 || f[5] !== "24K" || f[19] === "X") continue;
      const amt = Number(f[14]);
      const cand = f[16];
      if (!cand || !Number.isFinite(amt) || amt <= 0) continue;
      const m = pac.get(cand) ?? new Map();
      m.set(f[0], (m.get(f[0]) ?? 0) + amt);
      pac.set(cand, m);
      pacGiving.set(f[0], (pacGiving.get(f[0]) ?? 0) + amt);
      const st = cand.slice(2, 4);
      const sm = pacByState.get(st) ?? new Map();
      sm.set(f[0], (sm.get(f[0]) ?? 0) + amt);
      pacByState.set(st, sm);
    }

    const cmteRef = (id: string) => {
      const cm = committees.get(id);
      return { id, name: cm?.name ?? id, category: cm?.category ?? "Unknown", group: cm?.group ?? "other", connectedOrg: cm?.connectedOrg || null };
    };
    const lean = (a: Agg) => (a.proD + a.proR === 0 ? null : a.proD / (a.proD + a.proR));
    const fecSrc = (title: string, url: string) => ({ title, url, publisher: "Federal Election Commission", kind: "data" as const });

    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Spender profiles (anyone with IE notices or PAC giving ≥ $25K)
    const ids = new Set([...spenders.keys(), ...[...pacGiving].filter(([, v]) => v >= 25_000).map(([k]) => k)]);
    for (const id of ids) {
      const cm = committees.get(id);
      const a = spenders.get(id);
      const s = summaries.get(id);
      const total = a ? a.support + a.oppose : 0;
      entities.push({
        id: `spender:${id}`,
        kind: "finance",
        state: "US",
        title: cm?.name ?? id,
        date: a?.lastDate || s?.through || null,
        status: "spender",
        searchText: `${cm?.category ?? ""} ${cm?.connectedOrg ?? ""}`,
        sources: [fecSrc(`FEC committee ${id}`, `https://www.fec.gov/data/committee/${id}/`)],
        confidence: "high",
        data: {
          committeeId: id,
          ...cmteRef(id),
          type: cm?.type ?? "",
          outside: a
            ? {
                total, support: a.support, oppose: a.oppose, proD: a.proD, proR: a.proR, primary: a.primary, leanD: lean(a), filings: a.filings, lastDate: a.lastDate,
                byState: [...a.byState].sort((x, y) => y[1] - x[1]).map(([state, amount]) => ({ state, amount })),
                topTargets: [...a.byCandidate].map(([cand, v]) => ({ cand, ...candInfo.get(cand), ...v, total: v.support + v.oppose })).sort((x, y) => y.total - x.total).slice(0, 12),
              }
            : null,
          pacGiving: pacGiving.get(id) ?? 0,
          summary: s ?? null,
        },
      });
    }

    // State roll-ups
    for (const [st, a] of stateTotals) {
      const topSpenders = [...spenders]
        .map(([id, sp]) => ({ ...cmteRef(id), amount: sp.byState.get(st) ?? 0 }))
        .filter((x) => x.amount > 0)
        .sort((x, y) => y.amount - x.amount)
        .slice(0, 25);
      const topPacs = [...(pacByState.get(st) ?? new Map<string, number>())]
        .map(([id, amount]) => ({ ...cmteRef(id), amount }))
        .sort((x, y) => y.amount - x.amount)
        .slice(0, 25);
      entities.push({
        id: `statemoney:${st}`,
        kind: "finance",
        state: st,
        title: `Outside spending in ${st} federal races`,
        date: a.lastDate || null,
        status: "state_money",
        sources: [fecSrc("FEC independent expenditures (24/48-hour notices)", "https://www.fec.gov/data/independent-expenditures/?data_type=efiling")],
        confidence: "high",
        data: {
          state: st, total: a.support + a.oppose, support: a.support, oppose: a.oppose, proD: a.proD, proR: a.proR, primary: a.primary, leanD: lean(a), lastDate: a.lastDate,
          topSpenders,
          topPacContributors: topPacs,
          topTargets: [...a.byCandidate].map(([cand, v]) => ({ cand, ...candInfo.get(cand), ...v, total: v.support + v.oppose })).sort((x, y) => y.total - x.total).slice(0, 15),
        },
      });
    }

    // Candidate money: current outside spending + top PAC contributors
    const cands = new Set([...candTotals.keys(), ...pac.keys()]);
    for (const cand of cands) {
      const a = candTotals.get(cand);
      const pacs = pac.get(cand);
      entities.push({
        id: `candmoney:${cand}`,
        kind: "finance",
        state: candInfo.get(cand)?.state ?? cand.slice(2, 4),
        title: candInfo.get(cand)?.name ?? cand,
        date: a?.lastDate || null,
        status: "candidate_money",
        sources: [fecSrc(`FEC candidate ${cand}`, `https://www.fec.gov/data/candidate/${cand}/`)],
        confidence: "high",
        data: {
          fecId: cand,
          outside: a
            ? {
                support: a.support, oppose: a.oppose, lastDate: a.lastDate,
                spenders: [...a.spenders].map(([id, v]) => ({ ...cmteRef(id), ...v, total: v.support + v.oppose })).sort((x, y) => y.total - x.total).slice(0, 15),
              }
            : null,
          pacContributors: pacs
            ? [...pacs].map(([id, amount]) => ({ ...cmteRef(id), amount })).sort((x, y) => y.amount - x.amount).slice(0, 20)
            : [],
          pacTotal: pacs ? [...pacs.values()].reduce((x, y) => x + y, 0) : 0,
        },
      });
      relations.push({ src: `candmoney:${cand}`, dst: `finance:${cand}`, type: "money_for" });
    }

    log(`Spenders: ${ids.size}; states: ${stateTotals.size}; candidates: ${cands.size}`);
    return { entities, relations, warnings };
  },
};
