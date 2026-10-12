"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { Bill } from "@/lib/schema";
import { STATES } from "@/lib/states";
import { ConfidenceBadge, Impact, Pill, humanize } from "./ui";

interface Item {
  id: string;
  data: Bill;
  official: { date: string | null; text: string | null; retrievedAt: string } | null;
}

const STATUS_GROUPS: Record<string, string[]> = {
  active: ["introduced", "in_committee", "passed_committee", "passed_chamber", "passed_legislature"],
  enacted: ["enacted"],
  dead: ["failed", "vetoed", "inactive"],
  carried: ["carried_over"],
};

export default function BillBrowser({ bills }: { bills: Item[] }) {
  const params = useSearchParams();
  const [jur, setJur] = useState(params.get("jurisdiction") ?? "all");
  const [status, setStatus] = useState("all");
  const [theme, setTheme] = useState("all");
  const [impact, setImpact] = useState("all");
  const [explicit, setExplicit] = useState("all");
  const [q, setQ] = useState("");

  const themes = useMemo(() => [...new Set(bills.flatMap((b) => b.data.themes))].sort(), [bills]);
  const jurisdictions = useMemo(() => [...new Set(bills.map((b) => b.data.jurisdiction))].sort(), [bills]);
  const shown = bills
    .filter(({ data: b }) =>
      (jur === "all" || b.jurisdiction === jur) &&
      (status === "all" || STATUS_GROUPS[status].includes(b.status)) &&
      (theme === "all" || b.themes.includes(theme as Bill["themes"][number])) &&
      (impact === "all" || b.impact === impact) &&
      (explicit === "all" || (explicit === "yes") === b.explicitDataCenter) &&
      (!q || `${b.number} ${b.title} ${b.summary} ${b.sponsors.map((s) => s.name).join(" ")}`.toLowerCase().includes(q.toLowerCase())),
    )
    .sort((a, b) => b.data.latestAction.date.localeCompare(a.data.latestAction.date));

  const sel = (value: string, set: (v: string) => void, opts: [string, string][]) => (
    <select value={value} onChange={(e) => set(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const name = (code: string) => (code === "US" ? "Federal" : STATES.find((s) => s.code === code)?.name ?? code);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, title, sponsor…" className="w-60 rounded border border-slate-300 px-2 py-1" />
        {sel(jur, setJur, [["all", "All jurisdictions"], ...jurisdictions.map((j) => [j, name(j)] as [string, string])])}
        {sel(status, setStatus, [["all", "Any status"], ["active", "Active / pending"], ["enacted", "Enacted"], ["carried", "Carried over"], ["dead", "Failed / vetoed / inactive"]])}
        {sel(theme, setTheme, [["all", "All topics"], ...themes.map((t) => [t, humanize(t)] as [string, string])])}
        {sel(impact, setImpact, [["all", "Any direction"], ["restrictive", "Restrictive"], ["permissive", "Permissive"], ["mixed", "Mixed"], ["neutral", "Neutral"], ["unclear", "Unclear"]])}
        {sel(explicit, setExplicit, [["all", "Explicit + indirect"], ["yes", "Names data centers"], ["no", "Indirect effect"]])}
        <span className="text-slate-500">{shown.length} of {bills.length} curated</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Jur.</th>
              <th className="px-2 py-1.5">Bill</th>
              <th className="px-2 py-1.5">Topics</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5">Latest action</th>
              <th className="px-2 py-1.5">Direction</th>
              <th className="px-2 py-1.5">Verified</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ id, data: b, official }) => (
              <tr key={id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                <td className="px-2 py-1.5 font-semibold">{b.jurisdiction}</td>
                <td className="max-w-md px-2 py-1.5">
                  <Link href={`/legislation/${b.id}`} className="font-medium underline decoration-slate-300">{b.number}</Link>{" "}
                  <span className="text-slate-700">{b.title}</span>
                  <div className="text-[11px] text-slate-500">
                    {b.session}
                    {b.sponsors.length > 0 && ` · ${b.sponsors.slice(0, 2).map((s) => `${s.name}${s.party ? ` (${s.party})` : ""}`).join(", ")}${b.sponsors.length > 2 ? ` +${b.sponsors.length - 2}` : ""}`}
                    {!b.explicitDataCenter && " · indirect"}
                  </div>
                </td>
                <td className="px-2 py-1.5"><div className="flex max-w-48 flex-wrap gap-0.5">{b.themes.slice(0, 3).map((t) => <Pill key={t}>{humanize(t)}</Pill>)}</div></td>
                <td className="px-2 py-1.5"><Pill tone={b.status === "enacted" ? "green" : ["failed", "vetoed", "inactive"].includes(b.status) ? "slate" : "amber"}>{humanize(b.status)}</Pill></td>
                <td className="max-w-xs px-2 py-1.5 text-slate-600">
                  <span className="tabular-nums">{b.latestAction.date}</span> {b.latestAction.text}
                  {official?.date && official.date !== b.latestAction.date && (
                    <div className="text-emerald-800">Official record: {official.date} {official.text}</div>
                  )}
                </td>
                <td className="px-2 py-1.5"><Impact impact={b.impact} /></td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{b.verifiedAt}<div><ConfidenceBadge level={b.confidence} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
