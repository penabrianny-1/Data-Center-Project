"use client";

import Link from "next/link";
import { useState } from "react";
import type { StateSummary } from "@/lib/layers";

export type StateRow = StateSummary & { coverage: number };

const RESTRICTION_ORDER = ["ban", "local", "advancing", "discussion", "none", "favorable"];
const RESTRICTION_LABEL: Record<string, string> = {
  ban: "Statewide ban", local: "Local bans", advancing: "Advancing", discussion: "Discussion", none: "No action", favorable: "Favorable",
};

type Key = "name" | "restriction" | "trifecta" | "races" | "policyScore" | "localActions" | "coverage";

export default function StatesTable({ rows }: { rows: StateRow[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [q, setQ] = useState("");
  const val = (r: StateRow, k: Key): string | number => {
    switch (k) {
      case "restriction": return RESTRICTION_ORDER.indexOf(r.restriction ?? "zzz");
      case "races": return r.races.length;
      case "policyScore": return r.policyScore ?? -1;
      default: return (r[k] as string | number | null) ?? "";
    }
  };
  const sorted = rows
    .filter((r) => !q || `${r.name} ${r.code} ${r.governor ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const x = val(a, sort.key), y = val(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  const th = (k: Key, label: string, cls = "") => (
    <th className={`px-2 py-1.5 font-medium ${cls}`}>
      <button type="button" onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : 1 })} className="hover:text-slate-900">
        {label} {sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}
      </button>
    </th>
  );
  return (
    <div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter states or governors…" className="mb-2 w-64 rounded border border-slate-300 px-2 py-1 text-xs" />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              {th("name", "State")}
              {th("restriction", "Restrictions")}
              {th("trifecta", "Control")}
              <th className="px-2 py-1.5 font-medium">Governor</th>
              {th("races", "2026 ballot")}
              <th className="px-2 py-1.5 font-medium">Utility regulator</th>
              {th("policyScore", "Policy score", "text-right")}
              {th("localActions", "Local actions", "text-right")}
              {th("coverage", "Coverage", "text-right")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.code} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-2 py-1.5"><Link href={`/states/${r.code}`} className="font-medium underline decoration-slate-300">{r.name}</Link></td>
                <td className="px-2 py-1.5">{r.restriction ? RESTRICTION_LABEL[r.restriction] : <span className="text-slate-400">—</span>}</td>
                <td className="px-2 py-1.5">{r.trifecta ? (r.trifecta === "divided" ? "Divided" : `${r.trifecta} trifecta`) : "—"}</td>
                <td className="px-2 py-1.5">{r.governor ?? "—"}</td>
                <td className="px-2 py-1.5">{r.races.join(", ") || <span className="text-slate-400">none</span>}</td>
                <td className="max-w-56 truncate px-2 py-1.5" title={r.commission ?? ""}>{r.commission ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.policyScore ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.localActions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.coverage}/5</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Policy score is analysis: a balanced-weight composite of researched dimensions. Coverage counts the core datasets with a verified record.</p>
    </div>
  );
}
