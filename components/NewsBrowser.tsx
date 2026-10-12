"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { NEWS_CATEGORIES, NEWS_SIGNALS, type NewsCategory, type NewsSignal } from "@/lib/news-classify";
import { OUTLET_TYPE_LABEL, type ClassifiedNews } from "@/lib/news-meta";
import { STATES } from "@/lib/states";
import { NewsRow } from "./NewsList";

interface Outlet {
  id: string;
  outlet: string;
  type: keyof typeof OUTLET_TYPE_LABEL;
  home: string;
}

export default function NewsBrowser({ items, outlets, excluded }: { items: ClassifiedNews[]; outlets: Outlet[]; excluded: { outlet: string; reason: string }[] }) {
  const params = useSearchParams();
  const [state, setState] = useState(params.get("state") ?? "all");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState<"all" | NewsCategory>((params.get("category") as NewsCategory) ?? "all");
  const [signal, setSignal] = useState<"all" | NewsSignal>("all");
  const [intl, setIntl] = useState(false);
  const [q, setQ] = useState("");

  const base = items.filter((i) => intl || !i.international);
  const shown = base
    .filter(
      (i) =>
        (state === "all" || i.data.states.includes(state)) &&
        (type === "all" || i.data.outletType === type) &&
        (category === "all" || i.topics.includes(category)) &&
        (signal === "all" || i.signal === signal) &&
        (!q || `${i.title} ${i.data.summary} ${i.data.outlet}`.toLowerCase().includes(q.toLowerCase())),
    )
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const catCounts = Object.fromEntries((Object.keys(NEWS_CATEGORIES) as NewsCategory[]).map((c) => [c, base.filter((i) => i.category === c).length]));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
      <div>
        {/* Category tabs, in the spirit of datacenterbans.com's Moratoriums / Construction / AI Legislation */}
        <div className="mb-2 flex flex-wrap gap-1 text-xs" role="tablist" aria-label="News category">
          <button type="button" onClick={() => setCategory("all")} className={`rounded px-2 py-1 ${category === "all" ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>
            All <span className="opacity-60">{base.length}</span>
          </button>
          {(Object.keys(NEWS_CATEGORIES) as NewsCategory[]).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded px-2 py-1 ${category === c ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>
              {NEWS_CATEGORIES[c]} <span className="opacity-60">{catCounts[c]}</span>
            </button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter headlines…" className="w-52 rounded border border-slate-300 px-2 py-1" />
          <select value={state} onChange={(e) => setState(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
            <option value="all">All states</option>
            {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
          <select value={signal} onChange={(e) => setSignal(e.target.value as "all" | NewsSignal)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
            <option value="all">Any status signal</option>
            {(Object.keys(NEWS_SIGNALS) as NewsSignal[]).filter((s) => s !== "none").map((s) => <option key={s} value={s}>{NEWS_SIGNALS[s]}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
            <option value="all">All outlet types</option>
            {Object.entries(OUTLET_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-1"><input type="checkbox" checked={intl} onChange={(e) => setIntl(e.target.checked)} /> Include international</label>
          <span className="text-slate-500">{shown.length} stories</span>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {shown.slice(0, 300).map((i) => <NewsRow key={i.id} item={i} />)}
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No stories match.</li>}
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">
          Categories and status signals are assigned automatically by transparent keyword rules applied to each headline and summary.
          Treat them as triage, not a verified finding. Open the story to confirm.
        </p>
      </div>
      <aside className="text-xs">
        <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Monitored outlets ({outlets.length} feeds)</h3>
        <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
          {Object.entries(OUTLET_TYPE_LABEL).map(([t, label]) => {
            const group = [...new Map(outlets.filter((o) => o.type === t).map((o) => [o.outlet.replace(/ \(.*\)$/, ""), o])).values()];
            if (!group.length) return null;
            return (
              <div key={t}>
                <div className="font-medium text-slate-700">{label}</div>
                <ul>
                  {group.map((o) => (
                    <li key={o.id}><a href={o.home} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300">{o.outlet.replace(/ \(.*\)$/, "")}</a></li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer font-medium text-slate-600">Not included ({excluded.length}) and why</summary>
          <ul className="mt-1 space-y-1 text-slate-500">
            {excluded.map((e) => <li key={e.outlet}><span className="font-medium text-slate-700">{e.outlet}:</span> {e.reason}</li>)}
          </ul>
        </details>
        <p className="mt-2 text-slate-500">
          State tags combine the outlet&apos;s home state with states named in the headline or summary. Paywalled outlets (FT, WaPo, NYT)
          link to the publisher; only headlines and summaries are shown here.
        </p>
      </aside>
    </div>
  );
}
