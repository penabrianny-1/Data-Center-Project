"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Development, Source } from "@/lib/schema";
import { Evidence, Impact, Pill, Provenance, Severity, humanize } from "./ui";

export interface DevItem {
  id: string;
  data: Development;
  sources: Source[];
}

const LEVELS = ["federal", "state", "regional", "utility", "local"] as const;

export default function DevelopmentFeed({ items, compact = false, limit }: { items: DevItem[]; compact?: boolean; limit?: number }) {
  const [level, setLevel] = useState<string>("all");
  const [topic, setTopic] = useState<string>("all");
  const [minSeverity, setMinSeverity] = useState(1);
  const [impact, setImpact] = useState<string>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"consequence" | "date">("consequence");

  const topics = useMemo(() => [...new Set(items.flatMap((i) => i.data.topics))].sort(), [items]);
  const filtered = items
    .filter(
      ({ data: d }) =>
        (level === "all" || d.level === level) &&
        (topic === "all" || d.topics.includes(topic as Development["topics"][number])) &&
        d.severity >= minSeverity &&
        (impact === "all" || d.impact === impact) &&
        (!q || `${d.title} ${d.whatHappened} ${d.jurisdiction} ${d.authority}`.toLowerCase().includes(q.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "date"
        ? b.data.date.localeCompare(a.data.date)
        : b.data.severity - a.data.severity || b.data.date.localeCompare(a.data.date),
    );
  const shown = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div>
      {!compact && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            className="w-48 rounded border border-slate-300 px-2 py-1"
          />
          <Select value={level} onChange={setLevel} options={[["all", "All levels"], ...LEVELS.map((l) => [l, humanize(l)] as [string, string])]} />
          <Select value={topic} onChange={setTopic} options={[["all", "All topics"], ...topics.map((t) => [t, humanize(t)] as [string, string])]} />
          <Select
            value={impact}
            onChange={setImpact}
            options={[["all", "Any direction"], ["restrictive", "Restrictive"], ["permissive", "Permissive"], ["mixed", "Mixed"], ["unclear", "Unclear"]]}
          />
          <Select
            value={String(minSeverity)}
            onChange={(v) => setMinSeverity(Number(v))}
            options={[["1", "Any severity"], ["3", "Severity ≥ 3"], ["4", "Severity ≥ 4"], ["5", "Severity 5"]]}
          />
          <Select value={sort} onChange={(v) => setSort(v as "consequence" | "date")} options={[["consequence", "Sort: consequence"], ["date", "Sort: newest"]]} />
          <span className="text-slate-500">{filtered.length} items</span>
        </div>
      )}
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {shown.map(({ id, data: d, sources }) => (
          <li key={id} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <Severity level={d.severity} />
              <time dateTime={d.date} className="tabular-nums">{d.date}</time>
              <span className="font-semibold text-slate-700">{d.jurisdiction}</span>
              <span>· {d.authority}</span>
              <Pill>{humanize(d.status)}</Pill>
              <Impact impact={d.impact} />
              <Evidence type={d.evidence} />
            </div>
            <h3 className="mt-1 text-sm font-semibold leading-snug text-slate-900">{d.title}</h3>
            <p className="mt-0.5 text-[13px] leading-relaxed text-slate-700">{d.whatHappened}</p>
            {!compact && (
              <div className="mt-1.5 grid gap-x-6 gap-y-1 text-xs text-slate-600 md:grid-cols-3">
                <p>
                  <span className="font-semibold text-slate-700">Why it matters </span>
                  <Evidence type="analysis" /> {d.whyItMatters}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Affected: </span>
                  {d.affected}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Watch next: </span>
                  {d.watchNext}
                </p>
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {d.states.map((s) => (
                <Link key={s} href={`/states/${s}`} className="rounded bg-slate-100 px-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200">
                  {s}
                </Link>
              ))}
            </div>
            <Provenance sources={sources} verifiedAt={d.verifiedAt} confidence={d.confidence} caveats={d.caveats} />
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No developments match these filters.</li>}
      </ol>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
