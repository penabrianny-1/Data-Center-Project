import type { LocalAction } from "./schema";

/** Map a local action to the county-map category (strongest first). */
export function localCategory(a: Pick<LocalAction, "kind" | "status">): "ban" | "moratorium" | "rules" | "decision" {
  if (a.status === "in_effect" && a.kind === "ban") return "ban";
  if (a.status === "in_effect" && a.kind === "moratorium") return "moratorium";
  if (["zoning_ordinance", "special_use_requirement"].includes(a.kind) && ["in_effect", "approved"].includes(a.status)) return "rules";
  return "decision";
}

const RANK = { ban: 0, moratorium: 1, rules: 2, decision: 3 } as const;
const LABEL = {
  ban: "Ban in effect",
  moratorium: "Moratorium in effect",
  rules: "Zoning rules / special-use requirements",
  decision: "Other recorded action",
};

export function countyActionIndex(actions: Pick<LocalAction, "kind" | "status" | "countyFips">[]) {
  const out: Record<string, { key: keyof typeof RANK; count: number; label: string }> = {};
  for (const a of actions) {
    const key = localCategory(a);
    const prev = out[a.countyFips];
    const best = !prev || RANK[key] < RANK[prev.key] ? key : prev.key;
    out[a.countyFips] = { key: best, count: (prev?.count ?? 0) + 1, label: LABEL[best] };
  }
  return out;
}
