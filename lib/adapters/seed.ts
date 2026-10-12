import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import countiesTopo from "us-atlas/counties-albers-10m.json";
import type { Adapter, Entity, Relation } from "../ingest/types";
import {
  Bill, Commission, Development, Docket, LocalAction, Race, StateGovernment, StatePolicy,
  isDisallowedSource, type Source,
} from "../schema";
import { STATES, STATE_BY_FIPS } from "../states";
import type { StatesData } from "../types";

const SEED_DIR = join(process.cwd(), "data", "seed");

export const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");

/**
 * Read a seed file (or `name.part*.json` shards), validating each record.
 * Invalid records are skipped and reported rather than failing the run.
 */
export function loadSeed<T>(name: string, schema: ZodType<T>, warnings: string[]): T[] {
  const base = name.replace(/\.json$/, "");
  const files = existsSync(SEED_DIR)
    ? readdirSync(SEED_DIR).filter((f) => f === name || (f.startsWith(`${base}.part`) && f.endsWith(".json"))).sort()
    : [];
  if (files.length === 0) {
    warnings.push(`${name}: not yet researched (file missing)`);
    return [];
  }
  const out: T[] = [];
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(SEED_DIR, f), "utf8"));
    } catch (err) {
      warnings.push(`${f}: invalid JSON (${(err as Error).message})`);
      continue;
    }
    if (!Array.isArray(raw)) {
      warnings.push(`${f}: expected an array`);
      continue;
    }
    raw.forEach((r, i) => {
      const parsed = schema.safeParse(r);
      if (parsed.success) out.push(parsed.data);
      else {
        const label = (r as { id?: string; state?: string })?.id ?? (r as { state?: string })?.state ?? `#${i}`;
        warnings.push(`${f} [${label}] skipped: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      }
    });
  }
  return out;
}

const textOf = (...parts: (string | undefined | null)[]) => parts.filter(Boolean).join(" ");

export const seedAdapter: Adapter = {
  id: "curated",
  name: "Curated research datasets",
  url: "file:data/seed/",
  sourceKind: "research",
  method: "curated",
  schedule: "Manual (researched & verified; each record carries its own verifiedAt date)",
  refreshMinutes: 60,
  coverage:
    "Hand-researched, source-cited records: state government composition, 2026 governor, Senate and competitive House races, utility commissions and key dockets, state policy frameworks, data-center legislation, a sample of local actions, and priority developments. Coverage isn't exhaustive. Each record has a confidence level and its own last-verified date.",
  async run() {
    const warnings: string[] = [];
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // --- Jurisdictions: states (with restriction status from data/states.json) and counties
    const restrictionPath = join(process.cwd(), "data", "states.json");
    const restriction = existsSync(restrictionPath)
      ? (JSON.parse(readFileSync(restrictionPath, "utf8")) as StatesData)
      : { lastUpdated: "", states: [] };
    const restrictionByCode = new Map(restriction.states.map((s) => [s.code, s]));
    for (const s of STATES) {
      const r = restrictionByCode.get(s.code);
      entities.push({
        id: `state:${s.code}`,
        kind: "jurisdiction",
        state: s.code,
        title: s.name,
        status: r?.status ?? null,
        searchText: textOf(r?.summary, ...(r?.highlights ?? [])),
        sources: r?.sources
          .filter((x) => !isDisallowedSource(x.url))
          .map((x) => ({ title: x.title, url: x.url, publisher: x.title.split(":")[0], kind: "journalism" as const })),
        verifiedAt: restriction.lastUpdated || null,
        confidence: r?.confidence ?? null,
        data: { type: "state", fips: s.fips, name: s.name, restriction: r ?? null },
      });
    }
    const counties = (countiesTopo as unknown as { objects: { counties: { geometries: { id: string; properties: { name: string } }[] } } })
      .objects.counties.geometries;
    for (const c of counties) {
      const st = STATE_BY_FIPS.get(c.id.slice(0, 2));
      if (!st) continue;
      entities.push({
        id: `county:${c.id}`,
        kind: "jurisdiction",
        state: st.code,
        county: c.id,
        title: `${c.properties.name}, ${st.code}`,
        searchText: `${c.properties.name} county ${st.name}`,
        data: { type: "county", fips: c.id, name: c.properties.name },
      });
    }

    // --- State government
    for (const g of loadSeed("state-government.json", StateGovernment, warnings)) {
      entities.push({
        id: `stategov:${g.state}`,
        kind: "state_government",
        state: g.state,
        title: `${g.state} government: Gov. ${g.governor.name} (${g.governor.party})`,
        status: g.trifecta,
        searchText: textOf(g.governor.name, g.lieutenantGovernor?.name, g.executivePowers, ...(g.upper?.leaders ?? []).map((l) => l.name), ...(g.lower?.leaders ?? []).map((l) => l.name)),
        sources: g.sources, verifiedAt: g.verifiedAt, confidence: g.confidence,
        data: g,
      });
    }

    // --- Races and candidates
    for (const file of ["races-governor.json", "races-senate.json", "races-house.json"]) {
      for (const r of loadSeed(file, Race, warnings)) {
        const raceId = `race:${r.id}`;
        const title = r.office === "U.S. House" ? `${r.state}-${r.district} U.S. House` : `${r.state} ${r.office}${r.special ? " (special)" : ""}`;
        entities.push({
          id: raceId,
          kind: "race",
          state: r.state,
          title,
          date: r.electionDate,
          status: r.ratings[0]?.rating ?? null,
          searchText: textOf(r.office, ...r.candidates.map((c) => c.name), r.powers, r.implications),
          sources: r.sources, verifiedAt: r.verifiedAt, confidence: r.confidence,
          data: r,
        });
        for (const c of r.candidates) {
          const cid = `candidate:${r.id}:${slug(c.name)}`;
          entities.push({
            id: cid,
            kind: "candidate",
            state: r.state,
            title: c.name,
            date: r.electionDate,
            status: c.status,
            searchText: textOf(title, c.party, ...c.positions.map((p) => p.summary)),
            sources: c.positions.map((p) => p.source),
            verifiedAt: r.verifiedAt,
            confidence: r.confidence,
            data: { ...c, raceId, office: r.office, state: r.state, district: r.district ?? null },
          });
          relations.push({ src: cid, dst: raceId, type: "candidate_in" });
        }
      }
    }

    // --- Utility commissions and dockets
    for (const c of loadSeed("commissions.json", Commission, warnings)) {
      entities.push({
        id: `commission:${c.state}`,
        kind: "commission",
        state: c.state,
        title: c.name,
        status: c.selection,
        searchText: textOf(c.selectionDetail, c.electionMechanism, ...c.commissioners.map((m) => m.name)),
        sources: c.sources, verifiedAt: c.verifiedAt, confidence: c.confidence,
        data: c,
      });
    }
    for (const d of loadSeed("dockets.json", Docket, warnings)) {
      entities.push({
        id: `docket:${d.id}`,
        kind: "docket",
        state: d.state,
        title: d.title,
        date: d.latestAction?.date ?? d.filed ?? null,
        status: d.status,
        searchText: textOf(d.docketNumber, d.utility, d.summary, d.significance),
        sources: d.sources, verifiedAt: d.verifiedAt, confidence: d.confidence,
        data: d,
      });
      if (d.state !== "US") relations.push({ src: `docket:${d.id}`, dst: `commission:${d.state}`, type: "before" });
    }

    // --- State policy
    for (const p of loadSeed("state-policy.json", StatePolicy, warnings)) {
      entities.push({
        id: `policy:${p.state}`,
        kind: "policy",
        state: p.state,
        title: `${p.state} data-center policy framework`,
        searchText: textOf(p.preemption.summary, p.water.summary, p.electricity.summary, ...p.incentives.map((i) => `${i.name} ${i.summary}`)),
        sources: p.sources, verifiedAt: p.verifiedAt, confidence: p.confidence,
        data: p,
      });
    }

    // --- Legislation
    for (const b of loadSeed("bills.json", Bill, warnings)) {
      entities.push({
        id: `bill:${b.id}`,
        kind: "bill",
        state: b.jurisdiction,
        title: `${b.number}: ${b.title}`,
        date: b.latestAction.date,
        status: b.status,
        searchText: textOf(b.summary, b.significance, ...b.sponsors.map((s) => s.name), ...b.themes),
        sources: b.sources, verifiedAt: b.verifiedAt, confidence: b.confidence,
        data: b,
      });
      for (const rel of b.related) relations.push({ src: `bill:${b.id}`, dst: `bill:${rel}`, type: "related" });
    }

    // --- Local actions
    for (const a of loadSeed("local-actions.json", LocalAction, warnings)) {
      entities.push({
        id: `local:${a.id}`,
        kind: "local_action",
        state: a.state,
        county: a.countyFips,
        title: `${a.jurisdiction}: ${a.kind.replace(/_/g, " ")}`,
        date: a.adopted ?? null,
        status: a.status,
        searchText: textOf(a.jurisdiction, a.authority, a.summary),
        sources: a.sources, verifiedAt: a.verifiedAt, confidence: a.confidence,
        data: a,
      });
      relations.push({ src: `local:${a.id}`, dst: `county:${a.countyFips}`, type: "in_county" });
    }

    // --- Developments
    for (const d of loadSeed("developments.json", Development, warnings)) {
      entities.push({
        id: `dev:${d.id}`,
        kind: "development",
        state: d.states[0] ?? (d.level === "federal" ? "US" : null),
        title: d.title,
        date: d.date,
        status: d.status,
        searchText: textOf(d.whatHappened, d.whyItMatters, d.affected, d.authority, d.jurisdiction),
        sources: d.sources, verifiedAt: d.verifiedAt, confidence: d.confidence,
        data: d,
      });
      for (const rel of d.related) relations.push({ src: `dev:${d.id}`, dst: rel, type: "related" });
    }

    return { entities, relations, warnings };
  },
};

export type { Source };
