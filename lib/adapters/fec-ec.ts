import type { Adapter, Entity } from "../ingest/types";
import { fecName } from "./fec";

/**
 * FEC electioneering communications (Form 9): broadcast "issue" ads that name a
 * federal candidate within 30 days of a primary or 60 days of a general
 * election, often run by 501(c)(4) "dark money" groups that don't otherwise
 * report to the FEC. The FEC API's cycle filter is ignored on this endpoint,
 * so report_year is used.
 */
export const fecEcAdapter: Adapter = {
  id: "fec-ec",
  name: "FEC electioneering communications (issue ads naming candidates)",
  url: "https://www.fec.gov/data/electioneering-communications/",
  sourceKind: "data",
  method: "api",
  schedule: "Daily",
  refreshMinutes: 1440,
  coverage:
    "Broadcast, cable and satellite ads that name a federal candidate close to an election, as reported on FEC Form 9, often by 501(c)(4) groups whose donors aren't disclosed. Covers 2025–2026. Issue ads outside the 30/60-day windows, online ads and ads that don't name a candidate aren't reported here (see Google political ads).",
  requiresEnv: "FEC_API_KEY",
  async run({ fetch, env, log }) {
    const rows: Record<string, unknown>[] = [];
    for (const year of [2025, 2026]) {
      for (let page = 1; ; page++) {
        const url = `https://api.open.fec.gov/v1/electioneering/?api_key=${env.FEC_API_KEY}&report_year=${year}&per_page=100&page=${page}`;
        const j = (await (await fetch(url)).json()) as { results: Record<string, unknown>[]; pagination: { pages: number } };
        rows.push(...j.results);
        if (page >= j.pagination.pages) break;
      }
    }
    log(`FEC EC: ${rows.length} electioneering communication line items (2025–26)`);

    type G = { name: string; total: number; count: number; last: string; byCandidate: Map<string, { name: string; state: string; office: string; amount: number }>; purposes: Set<string> };
    const groups = new Map<string, G>();
    for (const r of rows) {
      const id = String(r.committee_id);
      const g = groups.get(id) ?? { name: String(r.committee_name), total: 0, count: 0, last: "", byCandidate: new Map(), purposes: new Set() };
      const amt = Number(r.calculated_candidate_share ?? r.disbursement_amount ?? 0) || 0;
      g.total += amt;
      g.count++;
      const d = String(r.disbursement_date ?? r.communication_date ?? "").slice(0, 10);
      if (d > g.last) g.last = d;
      if (r.purpose_description) g.purposes.add(String(r.purpose_description));
      const cid = String(r.candidate_id ?? "");
      if (cid) {
        const c = g.byCandidate.get(cid) ?? { name: fecName(String(r.candidate_name ?? "")), state: String(r.candidate_state ?? ""), office: String(r.candidate_office ?? ""), amount: 0 };
        c.amount += amt;
        g.byCandidate.set(cid, c);
      }
      groups.set(id, g);
    }

    const entities: Entity[] = [...groups].map(([id, g]) => ({
      id: `ecgroup:${id}`,
      kind: "finance",
      state: "US",
      title: g.name,
      date: g.last || null,
      status: "electioneering",
      searchText: [...g.purposes].join(" "),
      sources: [{ title: `FEC electioneering communications: ${g.name}`, url: `https://www.fec.gov/data/electioneering-communications/?committee_id=${id}`, publisher: "Federal Election Commission", kind: "data" }],
      confidence: "high",
      data: {
        committeeId: id, name: g.name, total: g.total, count: g.count, lastDate: g.last, purposes: [...g.purposes].slice(0, 8),
        candidates: [...g.byCandidate].map(([cid, c]) => ({ cand: cid, ...c })).sort((a, b) => b.amount - a.amount).slice(0, 12),
        states: [...new Set([...g.byCandidate.values()].map((c) => c.state))],
      },
    }));
    return { entities };
  },
};
