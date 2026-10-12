"use client";

import { useMemo, useState } from "react";

export interface Point {
  date: string;
  value: number;
}

/**
 * Single-series line chart with crosshair tooltip. 2px line, recessive grid,
 * one y-axis. Series identity comes from the chart title (no legend needed).
 */
export default function LineChart({ points, unit = "$", height = 220, label }: { points: Point[]; unit?: string; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = height, L = 44, R = 12, T = 10, B = 24;
  const { xs, ys, yTicks, xTicks, path } = useMemo(() => {
    if (points.length < 2) return { xs: [], ys: [], yTicks: [], xTicks: [], path: "" };
    const t = points.map((p) => Date.parse(p.date));
    const t0 = t[0], t1 = t[t.length - 1];
    const vmin = Math.min(...points.map((p) => p.value)), vmax = Math.max(...points.map((p) => p.value));
    const pad = (vmax - vmin) * 0.1 || 0.1;
    const lo = Math.floor((vmin - pad) * 4) / 4, hi = Math.ceil((vmax + pad) * 4) / 4;
    const x = (ti: number) => L + ((ti - t0) / (t1 - t0)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const xs = t.map(x), ys = points.map((p) => y(p.value));
    const step = (hi - lo) / 4;
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ v: lo + i * step, y: y(lo + i * step) }));
    const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
    const every = Math.ceil(years.length / 8);
    const xTicks = years.filter((_, i) => i % every === 0).map((yr) => ({ label: yr, x: x(Math.max(t0, Date.parse(`${yr}-01-01`))) }));
    const path = xs.map((xi, i) => `${i ? "L" : "M"}${xi.toFixed(1)},${ys[i].toFixed(1)}`).join("");
    return { xs, ys, yTicks, xTicks, path };
  }, [points, H]);

  if (points.length < 2) return <p className="text-xs text-slate-500">Not enough observations to chart yet.</p>;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    setHover(best);
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((tk) => (
          <g key={tk.v}>
            <line x1={L} x2={W - R} y1={tk.y} y2={tk.y} stroke="#e1e0d9" strokeWidth={1} />
            <text x={L - 6} y={tk.y + 3} textAnchor="end" fontSize={10} fill="#898781">{unit}{tk.v.toFixed(2)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#c3c2b7" />
        {xTicks.map((tk) => <text key={tk.label} x={tk.x} y={H - 8} fontSize={10} fill="#898781" textAnchor="middle">{tk.label}</text>)}
        <path d={path} fill="none" stroke="#2a78d6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <g>
            <line x1={xs[hover]} x2={xs[hover]} y1={T} y2={H - B} stroke="#898781" strokeDasharray="3 3" />
            <circle cx={xs[hover]} cy={ys[hover]} r={4} fill="#2a78d6" stroke="#fcfcfb" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded bg-slate-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: `${Math.min((xs[hover] / W) * 100, 80)}%` }}
        >
          {points[hover].date}: <strong>{unit}{points[hover].value.toFixed(3)}</strong>
        </div>
      )}
    </div>
  );
}
