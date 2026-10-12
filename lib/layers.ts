/**
 * National map layers. Each layer maps every state to a category (or bin)
 * with a color, label and short detail line, plus an explicit "no data"
 * state so unresearched jurisdictions are never mistaken for "no activity".
 *
 * Palettes validated with the dataviz skill's validator (light surface):
 *  - red ordinal arm (restrictive levels) + gray neutral + blue (favorable)
 *  - blue ordinal ramp for counts/magnitude
 *  - 3-slot categorical (all-pairs safe) for commission selection
 */
import "server-only";
import { composite, PRESETS } from "./scoring";
import {
  getCommissions, getLocalActions, getPolicies, getRaces, getStateGovernments, getStates,
} from "./repo";
import type { Dimension } from "./schema";

export const NO_DATA = "#ecebe6";
const RED = ["#8f1d1d", "#c43c3a", "#e2706a", "#eea197"];
const BLUE = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
const NEUTRAL = "#d3d2cb";
const CAT3 = ["#2a78d6", "#eb6834", "#1baf7a"];
const PARTY = { D: "#2a78d6", R: "#e34948", divided: "#b5b3ab" };

export interface LegendItem {
  key: string;
  label: string;
  color: string;
}
export interface StateCell {
  key: string;
  detail: string;
}
export interface Layer {
  id: string;
  label: string;
  description: string;
  legend: LegendItem[];
  cells: Record<string, StateCell>;
  /** Evidence label for the layer as a whole */
  evidence: "fact" | "reported" | "analysis";
}

export interface StateSummary {
  code: string;
  name: string;
  governor: string | null;
  trifecta: string | null;
  restriction: string | null;
  restrictionSummary: string | null;
  races: string[];
  commission: string | null;
  policyScore: number | null;
  policyCompleteness: number;
  localActions: number;
}

export function buildMapData(): { layers: Layer[]; summaries: Record<string, StateSummary> } {
  const states = getStates();
  const gov = new Map(getStateGovernments().map((g) => [g.state!, g.data]));
  const policies = new Map(getPolicies().map((p) => [p.state!, p.data]));
  const commissions = new Map(getCommissions().map((c) => [c.state!, c.data]));
  const races = getRaces();
  const locals = getLocalActions();
  const localCount = new Map<string, number>();
  for (const l of locals) localCount.set(l.state!, (localCount.get(l.state!) ?? 0) + 1);

  const balanced = PRESETS[0].weights;
  const scores = new Map(
    [...policies].map(([code, p]) => [
      code,
      composite(p.dimensions as Record<Dimension, { score: number | null; confidence: "high" | "medium" | "low" }>, balanced),
    ]),
  );

  // --- Restrictions (moratoriums/bans)
  const restrictionLegend: LegendItem[] = [
    { key: "ban", label: "Statewide ban / pause", color: RED[0] },
    { key: "local", label: "Local bans only", color: RED[1] },
    { key: "advancing", label: "Restrictions advancing", color: RED[2] },
    { key: "discussion", label: "Under discussion", color: RED[3] },
    { key: "none", label: "No action found", color: NEUTRAL },
    { key: "favorable", label: "Favorable / incentives", color: CAT3[0] },
    { key: "nodata", label: "Not researched", color: NO_DATA },
  ];
  const restrictionLabel = Object.fromEntries(restrictionLegend.map((l) => [l.key, l.label]));

  // --- Election exposure
  const govRace = new Set(races.filter((r) => r.data.office === "Governor").map((r) => r.state!));
  const senRace = new Set(races.filter((r) => r.data.office === "U.S. Senate").map((r) => r.state!));
  for (const [code, g] of gov) if (g.governor.up2026) govRace.add(code);
  const pucUp = new Map([...commissions].filter(([, c]) => c.seatsUp2026 > 0).map(([k, c]) => [k, c.seatsUp2026]));

  const layers: Layer[] = [];
  const cellsFor = (fn: (code: string) => StateCell) => Object.fromEntries(states.map((s) => [s.state!, fn(s.state!)]));

  layers.push({
    id: "restrictions",
    label: "Moratoriums & bans",
    description: "Strongest restriction in effect or advancing anywhere in the state. Local means at least one county or city moratorium or ban.",
    evidence: "reported",
    legend: restrictionLegend,
    cells: cellsFor((code) => {
      const r = states.find((s) => s.state === code)?.data.restriction;
      return r ? { key: r.status, detail: restrictionLabel[r.status] ?? r.status } : { key: "nodata", detail: "Not researched" };
    }),
  });

  layers.push({
    id: "control",
    label: "Party control",
    description: "Trifecta means one party holds the governorship and both legislative chambers.",
    evidence: "fact",
    legend: [
      { key: "D", label: "Democratic trifecta", color: PARTY.D },
      { key: "R", label: "Republican trifecta", color: PARTY.R },
      { key: "divided", label: "Divided", color: PARTY.divided },
      { key: "nodata", label: "Not researched", color: NO_DATA },
    ],
    cells: cellsFor((code) => {
      const g = gov.get(code);
      if (!g) return { key: "nodata", detail: "Not researched" };
      return { key: g.trifecta, detail: `Gov. ${g.governor.name} (${g.governor.party}) · ${g.trifecta === "divided" ? "Divided government" : `${g.trifecta} trifecta`}` };
    }),
  });

  layers.push({
    id: "elections",
    label: "2026 election exposure",
    description: "Statewide offices on the Nov. 3, 2026 ballot that shape data-center policy: governor, U.S. Senate and elected utility commission seats.",
    evidence: "fact",
    legend: [
      { key: "0", label: "None of these", color: NEUTRAL },
      { key: "1", label: "1 of 3", color: BLUE[0] },
      { key: "2", label: "2 of 3", color: BLUE[1] },
      { key: "3", label: "All 3", color: BLUE[3] },
    ],
    cells: cellsFor((code) => {
      const parts = [govRace.has(code) && "Governor", senRace.has(code) && "Senate", pucUp.has(code) && `${pucUp.get(code)} PUC seat(s)`].filter(Boolean) as string[];
      return { key: String(parts.length), detail: parts.length ? parts.join(" · ") : "No governor, Senate or commission race" };
    }),
  });

  layers.push({
    id: "puc",
    label: "Utility commission selection",
    description: "How a state's utility regulators are chosen. This decides whether an election can change them directly.",
    evidence: "fact",
    legend: [
      { key: "appointed", label: "Appointed by governor", color: CAT3[0] },
      { key: "elected", label: "Elected by voters", color: CAT3[1] },
      { key: "legislature", label: "Legislature / mixed", color: CAT3[2] },
      { key: "nodata", label: "Not researched", color: NO_DATA },
    ],
    cells: cellsFor((code) => {
      const c = commissions.get(code);
      if (!c) return { key: "nodata", detail: "Not researched" };
      const key = c.selection === "mixed" ? "legislature" : c.selection;
      return { key, detail: `${c.name}: ${c.selectionDetail}${c.seatsUp2026 ? ` · ${c.seatsUp2026} seat(s) on 2026 ballot` : ""}` };
    }),
  });

  layers.push({
    id: "policy",
    label: "Policy climate (score)",
    description: "Balanced-weight composite of 10 sourced policy dimensions (0 = most restrictive, 100 = most permissive). Change the weights on Compare & score.",
    evidence: "analysis",
    legend: [
      { key: "r2", label: "≤ 35 restrictive", color: RED[1] },
      { key: "r1", label: "36–45", color: RED[3] },
      { key: "m", label: "46–54 mixed", color: NEUTRAL },
      { key: "p1", label: "55–64", color: BLUE[0] },
      { key: "p2", label: "≥ 65 permissive", color: BLUE[2] },
      { key: "nodata", label: "Insufficient data", color: NO_DATA },
    ],
    cells: cellsFor((code) => {
      const s = scores.get(code);
      if (!s || s.value === null) return { key: "nodata", detail: "Insufficient data" };
      const v = s.value;
      const key = v <= 35 ? "r2" : v <= 45 ? "r1" : v < 55 ? "m" : v < 65 ? "p1" : "p2";
      return { key, detail: `Score ${v}/100 · ${Math.round(s.completeness * 100)}% of dimensions scored` };
    }),
  });

  const maxLocal = Math.max(0, ...localCount.values());
  layers.push({
    id: "local",
    label: "Local actions recorded",
    description: "County and municipal moratoriums, bans, ordinances and project decisions in the curated sample. A low count can mean limited research, not limited activity.",
    evidence: "reported",
    legend: [
      { key: "0", label: "None recorded", color: NO_DATA },
      { key: "1", label: "1–2", color: BLUE[0] },
      { key: "2", label: "3–5", color: BLUE[1] },
      { key: "3", label: "6–10", color: BLUE[2] },
      { key: "4", label: "> 10", color: BLUE[3] },
    ],
    cells: cellsFor((code) => {
      const n = localCount.get(code) ?? 0;
      const key = n === 0 ? "0" : n <= 2 ? "1" : n <= 5 ? "2" : n <= 10 ? "3" : "4";
      return { key, detail: `${n} local action${n === 1 ? "" : "s"} recorded${maxLocal === 0 ? " (dataset pending)" : ""}` };
    }),
  });

  const datasets: [string, (code: string) => boolean][] = [
    ["government", (c) => gov.has(c)],
    ["policy", (c) => policies.has(c)],
    ["commission", (c) => commissions.has(c)],
    ["restrictions", (c) => Boolean(states.find((s) => s.state === c)?.data.restriction)],
    ["local", (c) => localCount.has(c)],
  ];
  layers.push({
    id: "coverage",
    label: "Research coverage",
    description: "How many of the five core state datasets have a verified record for this state. Use it to judge how far to trust other layers.",
    evidence: "fact",
    legend: [
      { key: "0", label: "0–1 of 5", color: NO_DATA },
      { key: "1", label: "2 of 5", color: BLUE[0] },
      { key: "2", label: "3 of 5", color: BLUE[1] },
      { key: "3", label: "4 of 5", color: BLUE[2] },
      { key: "4", label: "5 of 5", color: BLUE[3] },
    ],
    cells: cellsFor((code) => {
      const have = datasets.filter(([, f]) => f(code)).map(([n]) => n);
      const key = String(Math.max(0, have.length - 1));
      const missing = datasets.filter(([, f]) => !f(code)).map(([n]) => n);
      return { key, detail: `${have.length}/5 datasets${missing.length ? ` · missing: ${missing.join(", ")}` : ""}` };
    }),
  });

  const summaries: Record<string, StateSummary> = {};
  for (const s of states) {
    const code = s.state!;
    const g = gov.get(code);
    const c = commissions.get(code);
    const sc = scores.get(code);
    summaries[code] = {
      code,
      name: s.title,
      governor: g ? `${g.governor.name} (${g.governor.party})` : null,
      trifecta: g?.trifecta ?? null,
      restriction: s.data.restriction?.status ?? null,
      restrictionSummary: s.data.restriction?.summary ?? null,
      races: [govRace.has(code) && "Governor", senRace.has(code) && "U.S. Senate", pucUp.has(code) && "Utility commission"].filter(Boolean) as string[],
      commission: c ? `${c.name} (${c.selection})` : null,
      policyScore: sc?.value ?? null,
      policyCompleteness: sc?.completeness ?? 0,
      localActions: localCount.get(code) ?? 0,
    };
  }
  return { layers, summaries };
}
