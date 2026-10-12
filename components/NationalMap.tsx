"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { StateShape } from "@/lib/data";
import type { Layer, StateSummary } from "@/lib/layers";

interface Props {
  shapes: StateShape[];
  borders: string;
  layers: Layer[];
  summaries: Record<string, StateSummary>;
  fipsToCode: Record<string, string>;
  /** Layer ids shown as primary buttons; the rest go in "More layers". */
  primary?: string[];
}

export default function NationalMap({ shapes, borders, layers, summaries, fipsToCode, primary = ["restrictions", "control", "elections"] }: Props) {
  const router = useRouter();
  const [layerId, setLayerId] = useState(primary[0] ?? layers[0].id);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const layer = layers.find((l) => l.id === layerId) ?? layers[0];
  const colorOf = useMemo(() => Object.fromEntries(layer.legend.map((l) => [l.key, l.color])), [layer]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cell of Object.values(layer.cells)) c[cell.key] = (c[cell.key] ?? 0) + 1;
    return c;
  }, [layer]);
  const primaryLayers = layers.filter((l) => primary.includes(l.id));
  const moreLayers = layers.filter((l) => !primary.includes(l.id));
  const pick = (id: string) => {
    setLayerId(id);
    setFocusKey(null);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Map layer">
          {primaryLayers.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === layerId}
              onClick={() => pick(l.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${l.id === layerId ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <select
          value={primary.includes(layerId) ? "" : layerId}
          onChange={(e) => e.target.value && pick(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"
          aria-label="More map layers"
        >
          <option value="">More layers…</option>
          {moreLayers.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>

      <div className="relative mx-auto max-w-5xl" onMouseLeave={() => setHover(null)}>
        <svg viewBox="0 0 975 610" className="h-auto w-full" role="img" aria-label={`U.S. map: ${layer.label}`}>
          {shapes.map((s) => {
            const code = fipsToCode[s.fips];
            const cell = code ? layer.cells[code] : undefined;
            const dim = focusKey !== null && cell?.key !== focusKey;
            return (
              <path
                key={s.fips}
                d={s.d}
                fill={cell ? colorOf[cell.key] : "#ecebe6"}
                fillOpacity={dim ? 0.15 : 1}
                className="cursor-pointer outline-none transition-[fill-opacity] duration-150 hover:brightness-95 focus-visible:brightness-90"
                tabIndex={0}
                aria-label={code ? `${summaries[code]?.name}: ${cell?.detail}` : s.name}
                onMouseMove={(e) => {
                  if (!code) return;
                  const box = e.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect();
                  setHover({ code, x: e.clientX - box.left, y: e.clientY - box.top });
                }}
                onClick={() => code && router.push(`/states/${code}`)}
                onKeyDown={(e) => e.key === "Enter" && code && router.push(`/states/${code}`)}
              />
            );
          })}
          <path d={borders} fill="none" stroke="#ffffff" strokeWidth={1} strokeLinejoin="round" pointerEvents="none" />
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-60 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
            style={{ left: Math.min(hover.x + 14, 760), top: hover.y + 14 }}
          >
            <div className="text-sm font-semibold">{summaries[hover.code]?.name}</div>
            <div className="text-slate-300">{layer.cells[hover.code]?.detail}</div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {layer.legend.filter((l) => (counts[l.key] ?? 0) > 0).map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setFocusKey(focusKey === l.key ? null : l.key)}
            className={`flex items-center gap-1.5 text-sm ${focusKey && focusKey !== l.key ? "opacity-40" : ""}`}
          >
            <span className="inline-block h-3.5 w-3.5 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: l.color }} />
            <span className="text-slate-700">{l.label}</span>
            <span className="text-slate-400">({counts[l.key]})</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">Click a state to open it · click a legend item to highlight it</p>
    </div>
  );
}
