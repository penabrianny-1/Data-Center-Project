import { RELEVANT_COMMITTEES } from "../committees";
import type { Adapter, Entity, Relation } from "../ingest/types";

const BASE = "https://unitedstates.github.io/congress-legislators";

interface Term {
  type: "sen" | "rep";
  start: string;
  end: string;
  state: string;
  district?: number;
  class?: number;
  party: string;
  url?: string;
}
interface Legislator {
  id: { bioguide: string; fec?: string[]; ballotpedia?: string };
  name: { first: string; last: string; official_full?: string };
  terms: Term[];
}
interface Committee {
  thomas_id: string;
  type: "house" | "senate" | "joint";
  name: string;
  url?: string;
  jurisdiction?: string;
  subcommittees?: { thomas_id: string; name: string }[];
}
interface Member {
  bioguide: string;
  name: string;
  party: "majority" | "minority";
  rank?: number;
  title?: string;
}

const PARTY: Record<string, string> = { Democrat: "D", Republican: "R", Independent: "I", Libertarian: "L" };

/**
 * Current members of Congress and committee assignments from the
 * public-domain @unitedstates/congress-legislators dataset (maintained from
 * official House/Senate sources).
 */
export const legislatorsAdapter: Adapter = {
  id: "congress-legislators",
  name: "Members of Congress & committee assignments",
  url: "https://github.com/unitedstates/congress-legislators",
  sourceKind: "data",
  method: "bulk",
  schedule: "Daily",
  refreshMinutes: 1440,
  coverage:
    "All current senators, representatives and delegates, plus current committee and subcommittee membership. The dataset is community-maintained from official sources and usually updated within days of a change.",
  async run({ fetch }) {
    const [legislators, committees, membership] = (await Promise.all(
      ["legislators-current.json", "committees-current.json", "committee-membership-current.json"].map(async (f) =>
        (await fetch(`${BASE}/${f}`)).json(),
      ),
    )) as [Legislator[], Committee[], Record<string, Member[]>];

    const source = {
      title: "congress-legislators (current)",
      url: "https://github.com/unitedstates/congress-legislators",
      publisher: "@unitedstates project",
      kind: "data" as const,
    };
    const relevance = new Map(RELEVANT_COMMITTEES.map((c) => [c.id, c]));
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    for (const l of legislators) {
      const t = l.terms.at(-1)!;
      const name = l.name.official_full ?? `${l.name.first} ${l.name.last}`;
      const party = PARTY[t.party] ?? "Other";
      const chamber = t.type === "sen" ? "Senate" : "House";
      // Seat is on the 2026 ballot if the current term ends at the start of the 120th Congress (or sooner, for specials).
      const up2026 = t.end <= "2027-01-03";
      entities.push({
        id: `legislator:${l.id.bioguide}`,
        kind: "legislator",
        state: t.state,
        title: name,
        date: t.end,
        status: up2026 ? "up_2026" : "not_up",
        searchText: `${chamber} ${t.state} ${party} ${l.name.last}`,
        sources: [source],
        confidence: "high",
        data: {
          bioguide: l.id.bioguide,
          name,
          lastName: l.name.last,
          chamber,
          state: t.state,
          district: t.type === "rep" ? t.district : undefined,
          senateClass: t.class,
          party,
          termStart: t.start,
          termEnd: t.end,
          up2026,
          url: t.url,
          fecIds: l.id.fec ?? [],
          ballotpedia: l.id.ballotpedia,
        },
      });
    }

    for (const c of committees) {
      const rel = relevance.get(c.thomas_id);
      const add = (id: string, name: string, parent?: string) => {
        entities.push({
          id: `committee:${id}`,
          kind: "committee",
          state: "US",
          title: name,
          status: rel || (parent && relevance.has(parent)) ? "relevant" : "other",
          searchText: c.jurisdiction ?? "",
          sources: [source],
          confidence: "high",
          data: {
            thomasId: id,
            chamber: c.type,
            name,
            url: c.url,
            parent: parent ? `committee:${parent}` : null,
            jurisdiction: parent ? null : (c.jurisdiction ?? null),
            relevance: parent ? null : (rel ?? null),
            keySubcommittee: parent ? (relevance.get(parent)?.keySubcommittees.includes(id) ?? false) : undefined,
          },
        });
        for (const m of membership[id] ?? []) {
          relations.push({
            src: `legislator:${m.bioguide}`,
            dst: `committee:${id}`,
            type: "member_of",
            data: { side: m.party, rank: m.rank ?? null, title: m.title ?? null },
          });
        }
      };
      add(c.thomas_id, c.name);
      for (const sc of c.subcommittees ?? []) {
        add(c.thomas_id + sc.thomas_id, `${c.name.replace(/^(House|Senate) Committee on /, "")}: ${sc.name}`, c.thomas_id);
        relations.push({ src: `committee:${c.thomas_id + sc.thomas_id}`, dst: `committee:${c.thomas_id}`, type: "subcommittee_of" });
      }
    }

    return { entities, relations };
  },
};
