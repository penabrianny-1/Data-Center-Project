"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { Dimension } from "@/lib/schema";
import { band, composite, DIMENSION_KEYS, DIMENSION_META, PRESETS, type Weights } from "@/lib/scoring";

export interface CompareRow {
  code: string;
  name: string;
  confidence: "high" | "medium" | "low";
  dimensions: Partial<Record<Dimension, { score: number | null; confidence: "high" | "medium" | "low"; rationale: string }>>;
}

const cellCls = (s: number | null | undefined) =>
  s == null ? "bg-slate-50 text-slate-300" : s >= 2 ? "bg-blue-700 text-white" : s === 1 ? "bg-blue-200 text-blue-950" : s === 0 ? "bg-slate-200 text-slate-800" : s === -1 ? "bg-rose-200 text-rose-950" : "bg-rose-700 text-white";

export default function CompareTool({ rows }: { rows: CompareRow[] }) {
  const [weights, setWeights] = useState<Weights>(PRESETS[0].weights);
  const [preset, setPreset] = useState("balanced");
  const [minCompleteness, setMinCompleteness] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const scored = useMemo(
    () =>
      rows
        .map((r) => ({ r, s: composite(r.dimensions as Record<Dimension, { score: number | null; confidence: "high" | "medium" | "low" }>, weights) }))
        .filter((x) => x.s.completeness >= minCompleteness)
        .sort((a, b) => (b.s.value ?? -1) - (a.s.value ?? -1)),
    [rows, weights, minCompleteness],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <aside className="space-y-3 text-xs">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-1 font-semibold">Strategy preset</div>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.description}
                onClick={() => {
                  setPreset(p.id);
                  setWeights(p.weights);
                }}
                className={`rounded px-2 py-1 ${preset === p.id ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-slate-500">{PRESETS.find((p) => p.id === preset)?.description ?? "Custom weights"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 font-semibold">Weights</div>
          {DIMENSION_KEYS.map((k) => (
            <label key={k} className="mb-1.5 block" title={DIMENSION_META[k].description}>
              <div className="flex justify-between"><span>{DIMENSION_META[k].label}</span><span className="tabular-nums text-slate-500">{weights[k]}</span></div>
              <input
                type="range" min={0} max={3} step={0.5} value={weights[k]}
                onChange={(e) => {
                  setPreset("custom");
                  setWeights({ ...weights, [k]: Number(e.target.value) });
                }}
                className="w-full accent-slate-900"
                aria-label={`Weight for ${DIMENSION_META[k].label}`}
              />
            </label>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <label className="block">
            <div className="flex justify-between"><span className="font-semibold">Minimum data completeness</span><span>{Math.round(minCompleteness * 100)}%</span></div>
            <input type="range" min={0} max={1} step={0.1} value={minCompleteness} onChange={(e) => setMinCompleteness(Number(e.target.value))} className="w-full accent-slate-900" />
          </label>
          <p className="mt-1 text-slate-500">Hide states where too much of the weighted score lacks evidence. Missing dimensions are never filled in with guesses.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-600">
          <div className="mb-1 font-semibold text-slate-800">Method</div>
          Composite = weighted mean of non-missing dimension scores, rescaled to 0–100. Completeness = share of total weight backed by
          evidence. &quot;High-conf.&quot; = share of scored weight rated high confidence. See <Link href="/methodology" className="underline">Methodology</Link>.
        </div>
      </aside>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">State</th>
              <th className="px-2 py-1.5 text-right">Score</th>
              <th className="px-2 py-1.5">Band</th>
              <th className="px-2 py-1.5 text-right">Complete</th>
              <th className="px-2 py-1.5 text-right">High-conf.</th>
              {DIMENSION_KEYS.map((k) => (
                <th key={k} className="px-0.5 py-1.5 text-center font-normal" title={DIMENSION_META[k].label}>
                  <span className="inline-block w-7 truncate">{DIMENSION_META[k].label.split(" ")[0].slice(0, 5)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scored.map(({ r, s }, i) => (
              <Fragment key={r.code}>
                <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === r.code ? null : r.code)}>
                  <td className="px-2 py-1 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="px-2 py-1"><Link href={`/states/${r.code}#policy`} className="font-medium underline decoration-slate-300" onClick={(e) => e.stopPropagation()}>{r.name}</Link></td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{s.value ?? "—"}</td>
                  <td className="px-2 py-1">{band(s.value).label}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${s.completeness < 0.7 ? "text-amber-700" : ""}`}>{Math.round(s.completeness * 100)}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">{Math.round(s.highConfidenceShare * 100)}%</td>
                  {DIMENSION_KEYS.map((k) => (
                    <td key={k} className="px-0.5 py-1 text-center">
                      <span className={`inline-block w-7 rounded-sm py-px text-[10px] font-semibold tabular-nums ${cellCls(r.dimensions[k]?.score)}`}>
                        {r.dimensions[k]?.score == null ? "·" : r.dimensions[k]!.score! > 0 ? `+${r.dimensions[k]!.score}` : r.dimensions[k]!.score}
                      </span>
                    </td>
                  ))}
                </tr>
                {open === r.code && (
                  <tr className="bg-slate-50">
                    <td />
                    <td colSpan={5 + DIMENSION_KEYS.length} className="px-2 py-2">
                      <ul className="grid gap-1 md:grid-cols-2">
                        {DIMENSION_KEYS.map((k) => (
                          <li key={k}>
                            <span className="font-semibold">{DIMENSION_META[k].label}</span> ({r.dimensions[k]?.score ?? "n/a"}, weight {weights[k]}, {r.dimensions[k]?.confidence ?? "—"}): {r.dimensions[k]?.rationale ?? "No evidence."}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="px-2 py-1 text-[10px] text-slate-400">Click a row to see the rationale behind each score. Blue = favors development, red = constrains, · = insufficient evidence.</p>
      </div>
    </div>
  );
}
