import type { Adapter, Entity, Relation } from "../ingest/types";

/** Normalize a person name for matching: lowercase, strip accents, punctuation, suffixes and middle initials. */
export function nameKey(name: string): { last: string; first: string } {
  const clean = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["“”(].*?["”)]/g, " ") // nicknames
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|dr|mr|mrs|ms)\b/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1);
  return { first: clean[0] ?? "", last: clean.at(-1) ?? "" };
}

const OFFICE_PREFIX: Record<string, string> = { "U.S. Senate": "S", "U.S. House": "H" };

/**
 * Entity resolution across sources:
 *  - curated candidates → FEC finance records (same office, state, district; last name; first-initial tiebreak)
 *  - legislators → FEC finance records (exact, via FEC ids published in congress-legislators)
 *  - legislators → races they hold the seat for (incumbent_in)
 */
export const resolveAdapter: Adapter = {
  id: "resolver",
  name: "Entity resolution (cross-source links)",
  url: "about:resolver",
  sourceKind: "data",
  method: "curated",
  schedule: "Every ingest run",
  refreshMinutes: 60,
  coverage:
    "Links curated race candidates and members of Congress to FEC filings, and incumbents to their 2026 races. Matching is deterministic. Ambiguous matches are left unlinked rather than guessed.",
  dependsOn: ["curated", "fec-bulk", "congress-legislators"],
  async run({ lookup }) {
    const relations: Relation[] = [];
    const warnings: string[] = [];
    const finance = lookup("finance").filter((f) => f.id.startsWith("finance:"));
    const byFecId = new Map(finance.map((f) => [(f.data as { fecId: string }).fecId, f]));

    const index = new Map<string, Entity[]>();
    for (const f of finance) {
      const d = f.data as { office: string; state: string; district: string | null; name: string };
      const key = `${OFFICE_PREFIX[d.office]}|${d.state}|${d.office === "U.S. House" ? d.district : ""}|${nameKey(d.name).last}`;
      index.set(key, [...(index.get(key) ?? []), f]);
    }

    let linked = 0;
    let ambiguous = 0;
    for (const c of lookup("candidate")) {
      const d = c.data as { name: string; office: string; state: string; district: string | null; fecId?: string; incumbent?: boolean };
      if (d.fecId && byFecId.has(d.fecId)) {
        relations.push({ src: c.id, dst: `finance:${d.fecId}`, type: "has_finance", data: { method: "fec_id" } });
        linked++;
        continue;
      }
      const prefix = OFFICE_PREFIX[d.office];
      if (!prefix) continue; // state offices: no FEC records
      const n = nameKey(d.name);
      const district = d.office === "U.S. House" ? (d.district ?? "").padStart(2, "0") : "";
      let matches = index.get(`${prefix}|${d.state}|${district}|${n.last}`) ?? [];
      if (matches.length > 1) {
        matches = matches.filter((m) => nameKey((m.data as { name: string }).name).first[0] === n.first[0]);
      }
      if (matches.length > 1) {
        // Namesakes (e.g. two Sullivans in one race): incumbency status disambiguates.
        const byStatus = matches.filter((m) => ((m.data as { status: string | null }).status === "incumbent") === Boolean(d.incumbent));
        if (byStatus.length) matches = byStatus;
      }
      if (matches.length > 1) {
        // Prefer the campaign with the most receipts (multiple committees for one person are common).
        matches = [...matches].sort((a, b) => (b.data as { receipts: number }).receipts - (a.data as { receipts: number }).receipts);
        const top = nameKey((matches[0].data as { name: string }).name).first;
        if (!matches.every((m) => nameKey((m.data as { name: string }).name).first === top)) {
          ambiguous++;
          warnings.push(`Ambiguous FEC match for ${d.name} (${d.state} ${d.office}); left unlinked`);
          continue;
        }
      }
      if (matches[0]) {
        relations.push({ src: c.id, dst: matches[0].id, type: "has_finance", data: { method: "name+office+state" } });
        linked++;
      }
    }

    const races = lookup("race");
    for (const l of lookup("legislator")) {
      const d = l.data as { fecIds: string[]; chamber: string; state: string; district?: number; up2026: boolean; senateClass?: number };
      for (const id of d.fecIds) if (byFecId.has(id)) relations.push({ src: l.id, dst: `finance:${id}`, type: "has_finance", data: { method: "fec_id" } });
      if (!d.up2026) continue;
      const race = races.find((r) => {
        const rd = r.data as { office: string; state: string; district?: string; special: boolean };
        if (rd.state !== d.state) return false;
        if (d.chamber === "House") return rd.office === "U.S. House" && Number(rd.district) === (d.district ?? 0);
        // Senate: a special-election seat (term ends 2026-11-03) maps to the special race, class 2 to the regular one.
        return rd.office === "U.S. Senate" && rd.special === (d.senateClass !== 2);
      });
      if (race) relations.push({ src: l.id, dst: race.id, type: "incumbent_in" });
    }

    return { entities: [], relations, warnings: [`Linked ${linked} candidates to FEC records; ${ambiguous} ambiguous`, ...warnings] };
  },
};
