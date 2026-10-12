"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { StateShape } from "@/lib/data";
import type { Layer, StateSummary } from "@/lib/layers";

interface Props {
  shapes: StateShape[];
  borders: string;
  layers: Layer[];
  summaries: Record<string, StateSummary>;
  fipsToCode: Record<string, string>;
  initialLayer?: string;
}

export default function NationalMap({ shapes, borders, layers, summaries, fipsToCode, initialLayer }: Props) {
  const [layerId, setLayerId] = useState(initialLayer ?? layers[0].id);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");

  const layer = layers.find((l) => l.id === layerId) ?? layers[0];
  const colorOf = useMemo(() => Object.fromEntries(layer.legend.map((l) => [l.key, l.color])), [layer]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cell of Object.values(layer.cells)) c[cell.key] = (c[cell.key] ?? 0) + 1;
    return c;
  }, [layer]);

  const sel = selected ? summaries[selected] : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      <div>
        {/* Layer selector */}
        <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="Map layer">
          {layers.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === layerId}
              onClick={() => {
                setLayerId(l.id);
                setFocusKey(null);
              }}
              className={`rounded px-2 py-1 text-xs font-medium ${
                l.id === layerId ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {l.label}
            </button>
          ))}
          <div className="ml-auto flex gap-1 text-xs">
            {(["map", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded px-2 py-1 ${view === v ? "bg-slate-200 font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
              >
                {v === "map" ? "Map" : "Table"}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          {layer.description}{" "}
          <span className="font-medium text-slate-600">
            ({layer.evidence === "analysis" ? "analysis" : layer.evidence === "fact" ? "official records" : "reported"})
          </span>
        </p>

        {view === "map" ? (
          <div className="relative" onMouseLeave={() => setHover(null)}>
            <svg viewBox="0 0 975 610" className="h-auto w-full" role="img" aria-label={`U.S. map: ${layer.label}`}>
              {shapes.map((s) => {
                const code = fipsToCode[s.fips];
                const cell = code ? layer.cells[code] : undefined;
                const fill = cell ? colorOf[cell.key] : "#ecebe6";
                const dim = focusKey !== null && cell?.key !== focusKey;
                return (
                  <path
                    key={s.fips}
                    d={s.d}
                    fill={fill}
                    fillOpacity={dim ? 0.15 : 1}
                    stroke={selected === code ? "#0b0b0b" : "none"}
                    strokeWidth={selected === code ? 2.5 : 0}
                    className="cursor-pointer outline-none transition-[fill-opacity] duration-150 hover:brightness-95 focus-visible:brightness-90"
                    tabIndex={0}
                    aria-label={code ? `${summaries[code]?.name}: ${cell?.detail}` : s.name}
                    onMouseMove={(e) => {
                      if (!code) return;
                      const box = e.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect();
                      setHover({ code, x: e.clientX - box.left, y: e.clientY - box.top });
                    }}
                    onClick={() => code && setSelected(code)}
                    onKeyDown={(e) => e.key === "Enter" && code && setSelected(code)}
                  />
                );
              })}
              <path d={borders} fill="none" stroke="#fcfcfb" strokeWidth={1} strokeLinejoin="round" pointerEvents="none" />
            </svg>
            {hover && (
              <div
                className="pointer-events-none absolute z-10 max-w-64 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
                style={{ left: Math.min(hover.x + 14, 700), top: hover.y + 14 }}
              >
                <div className="font-semibold">{summaries[hover.code]?.name}</div>
                <div className="text-slate-300">{layer.cells[hover.code]?.detail}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">Click for state details</div>
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[540px] overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-1">State</th>
                  <th className="px-2 py-1">{layer.label}</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(summaries)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <tr key={s.code} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1">
                        <Link href={`/states/${s.code}`} className="font-medium underline decoration-slate-300">
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-2 py-1">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colorOf[layer.cells[s.code]?.key] }} />
                        {layer.cells[s.code]?.detail}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend (click to isolate) */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {layer.legend.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setFocusKey(focusKey === l.key ? null : l.key)}
              className={`flex items-center gap-1.5 text-xs ${focusKey && focusKey !== l.key ? "opacity-40" : ""}`}
            >
              <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: l.color }} />
              <span className="text-slate-700">{l.label}</span>
              <span className="text-slate-400">{counts[l.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Context panel */}
      <aside className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
        {sel ? (
          <>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold">{sel.name}</h3>
              <button type="button" onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-800" aria-label="Clear selection">
                ×
              </button>
            </div>
            <dl className="mt-2 space-y-1.5 text-xs">
              <Row k="Governor" v={sel.governor} />
              <Row k="Control" v={sel.trifecta && (sel.trifecta === "divided" ? "Divided" : `${sel.trifecta} trifecta`)} />
              <Row k="2026 ballot" v={sel.races.length ? sel.races.join(", ") : "No governor, Senate or commission race"} />
              <Row k="Regulator" v={sel.commission} />
              <Row k="Policy score" v={sel.policyScore !== null ? `${sel.policyScore}/100 (${Math.round(sel.policyCompleteness * 100)}% scored, analysis)` : null} />
              <Row k="Local actions" v={`${sel.localActions} recorded`} />
            </dl>
            {sel.restrictionSummary && <p className="mt-2 text-xs leading-relaxed text-slate-600">{sel.restrictionSummary}</p>}
            <Link href={`/states/${sel.code}`} className="mt-3 inline-block rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
              Open {sel.name} profile →
            </Link>
          </>
        ) : (
          <div className="text-xs text-slate-500">
            <p className="font-medium text-slate-700">Select a state</p>
            <p className="mt-1">Click any state to see its government, 2026 races, utility regulator, policy score and local activity, then open its full profile.</p>
            <p className="mt-2">Click a legend entry to show only that category.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined | false }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v || <span className="italic text-slate-400">Not researched</span>}</dd>
    </div>
  );
}
