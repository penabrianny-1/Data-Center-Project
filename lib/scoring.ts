/**
 * Transparent, user-weightable composite of the ten state policy dimensions.
 *
 * Each dimension is an integer from −2 (strongly constrains development) to
 * +2 (strongly favors it), assigned by researchers from cited indicators, or
 * null when evidence is insufficient. The composite is the weighted mean of
 * the non-null dimensions, rescaled to 0–100. Missing dimensions are never
 * imputed: they lower `completeness` instead, which is always shown.
 */
import type { Dimension } from "./schema";

export const DIMENSION_META: Record<Dimension, { label: string; description: string }> = {
  land_use: { label: "Land use & zoning", description: "Availability of suitably zoned land and flexibility of rezoning." },
  local_authority: { label: "Local authority", description: "How much local governments can block or condition projects (preemption increases the score)." },
  permitting: { label: "Permitting timelines", description: "Speed and predictability of state and local approvals." },
  environmental_review: { label: "Environmental review", description: "Burden of state environmental review (mini-NEPA) and air permits for backup generation." },
  water: { label: "Water", description: "Legal access to water and withdrawal permitting, separate from physical scarcity." },
  electricity: { label: "Electricity & interconnection", description: "Supply adequacy and time to connect large loads." },
  cost_allocation: { label: "Cost allocation & rates", description: "Large-load tariffs, minimum bills, collateral and who pays for grid upgrades." },
  incentives: { label: "Tax incentives", description: "Sales/use and property tax exemptions and their stability." },
  restrictions: { label: "Moratoriums & restrictions", description: "Statewide and local moratoriums and bans in effect or advancing." },
  political_stability: { label: "Policy stability", description: "Likelihood of a material policy shift after the 2026 elections." },
};

export const DIMENSION_KEYS = Object.keys(DIMENSION_META) as Dimension[];

export type Weights = Record<Dimension, number>;

export const PRESETS: { id: string; label: string; description: string; weights: Weights }[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Every dimension weighted equally.",
    weights: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, 1])) as Weights,
  },
  {
    id: "hyperscale",
    label: "Hyperscale campus",
    description: "Gigawatt-scale AI campus: power, land and water dominate, with incentives secondary.",
    weights: {
      land_use: 2, local_authority: 1.5, permitting: 1.5, environmental_review: 1, water: 2,
      electricity: 3, cost_allocation: 2, incentives: 1, restrictions: 2, political_stability: 1,
    },
  },
  {
    id: "speed",
    label: "Speed to power",
    description: "Prioritizes getting energized fastest: interconnection, permitting speed and few local veto points.",
    weights: {
      land_use: 1, local_authority: 2, permitting: 3, environmental_review: 2, water: 1,
      electricity: 3, cost_allocation: 1, incentives: 0.5, restrictions: 2, political_stability: 0.5,
    },
  },
  {
    id: "cost",
    label: "Operating cost",
    description: "Long-run economics: tax incentives, rate design and policy durability.",
    weights: {
      land_use: 0.5, local_authority: 0.5, permitting: 0.5, environmental_review: 0.5, water: 1,
      electricity: 1.5, cost_allocation: 3, incentives: 3, restrictions: 1, political_stability: 2,
    },
  },
];

export interface ScoreInput {
  score: number | null;
  confidence: "high" | "medium" | "low";
}

export interface CompositeScore {
  /** 0–100, or null when no dimension has a score */
  value: number | null;
  /** Share of total weight backed by a non-null dimension score (0–1) */
  completeness: number;
  /** Weighted share of scored dimensions rated high confidence (0–1) */
  highConfidenceShare: number;
  contributions: { dimension: Dimension; score: number | null; weight: number; points: number | null }[];
}

export function composite(dimensions: Partial<Record<Dimension, ScoreInput>>, weights: Weights): CompositeScore {
  let weighted = 0;
  let scoredWeight = 0;
  let totalWeight = 0;
  let highWeight = 0;
  const contributions = DIMENSION_KEYS.map((d) => {
    const w = Math.max(0, weights[d] ?? 0);
    const input = dimensions[d];
    totalWeight += w;
    if (input?.score === null || input?.score === undefined || w === 0) {
      return { dimension: d, score: input?.score ?? null, weight: w, points: null };
    }
    weighted += w * input.score;
    scoredWeight += w;
    if (input.confidence === "high") highWeight += w;
    return { dimension: d, score: input.score, weight: w, points: w * input.score };
  });
  return {
    // mean in [-2, 2] → [0, 100]
    value: scoredWeight > 0 ? Math.round(((weighted / scoredWeight + 2) / 4) * 100) : null,
    completeness: totalWeight > 0 ? scoredWeight / totalWeight : 0,
    highConfidenceShare: scoredWeight > 0 ? highWeight / scoredWeight : 0,
    contributions,
  };
}

/** Qualitative band for a composite value. */
export function band(value: number | null): { label: string; tone: "permissive" | "mixed" | "restrictive" | "unknown" } {
  if (value === null) return { label: "Insufficient data", tone: "unknown" };
  if (value >= 62) return { label: "More permissive", tone: "permissive" };
  if (value <= 38) return { label: "More restrictive", tone: "restrictive" };
  return { label: "Mixed", tone: "mixed" };
}
