"use client";

import { useState } from "react";
import LineChart, { type Point } from "./LineChart";

export default function GasExplorer({ series, areas }: { series: Record<string, Point[]>; areas: { area: string; label: string }[] }) {
  const [area, setArea] = useState("US");
  const [years, setYears] = useState(2);
  // Window is relative to the latest observation, so rendering stays pure.
  const all = series[area] ?? [];
  const end = all.at(-1)?.date;
  const cutoff = end ? `${Number(end.slice(0, 4)) - years}${end.slice(4)}` : "";
  const pts = all.filter((p) => p.date >= cutoff);
  const label = areas.find((a) => a.area === area)?.label ?? area;
  const last = pts.at(-1);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <select value={area} onChange={(e) => setArea(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
          {areas.map((a) => <option key={a.area} value={a.area}>{a.label}</option>)}
        </select>
        {[1, 2, 5].map((y) => (
          <button key={y} type="button" onClick={() => setYears(y)} className={`rounded px-2 py-1 ${years === y ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{y}Y</button>
        ))}
        {last && <span className="ml-auto text-slate-600">{label} latest: <strong>${last.value.toFixed(3)}</strong> (week of {last.date})</span>}
      </div>
      <LineChart points={pts} label={`Weekly regular gasoline price, ${label}`} />
    </div>
  );
}
