"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StateShape } from "@/lib/data";

interface Props {
  shapes: StateShape[];
  borders: string;
  viewBox: string;
  /** county FIPS → strongest recorded action and count */
  actions: Record<string, { key: string; count: number; label: string }>;
}

// Same validated red ordinal arm as the national restriction layer.
const COLORS: Record<string, string> = {
  ban: "#8f1d1d",
  moratorium: "#c43c3a",
  rules: "#e2706a",
  decision: "#eea197",
};
export const COUNTY_LEGEND = [
  { key: "ban", label: "Ban in effect" },
  { key: "moratorium", label: "Moratorium in effect" },
  { key: "rules", label: "Zoning rules / special-use requirements" },
  { key: "decision", label: "Other recorded action (expired, project decision, lawsuit…)" },
];

export default function CountyMap({ shapes, borders, viewBox, actions }: Props) {
  const router = useRouter();
  const [hover, setHover] = useState<{ fips: string; name: string; x: number; y: number } | null>(null);
  return (
    <div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={viewBox} className="h-auto max-h-[460px] w-full" role="img" aria-label="County map of recorded local actions">
          {shapes.map((s) => {
            const a = actions[s.fips];
            return (
              <path
                key={s.fips}
                d={s.d}
                fill={a ? COLORS[a.key] : "#ecebe6"}
                className="cursor-pointer outline-none hover:brightness-95"
                tabIndex={0}
                aria-label={`${s.name} County: ${a ? a.label : "no recorded action"}`}
                onMouseMove={(e) => {
                  const box = e.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect();
                  setHover({ fips: s.fips, name: s.name, x: e.clientX - box.left, y: e.clientY - box.top });
                }}
                onClick={() => router.push(`/counties/${s.fips}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/counties/${s.fips}`)}
              />
            );
          })}
          <path d={borders} fill="none" stroke="#fcfcfb" strokeWidth={0.5} pointerEvents="none" />
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded bg-slate-900 px-2 py-1 text-xs text-white shadow"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="font-semibold">{hover.name}</div>
            <div className="text-slate-300">
              {actions[hover.fips] ? `${actions[hover.fips].count} recorded · ${actions[hover.fips].label}` : "No recorded action (not necessarily none)"}
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {COUNTY_LEGEND.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS[l.key] }} />
            {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: "#ecebe6" }} />
          None recorded / not researched
        </span>
      </div>
    </div>
  );
}
