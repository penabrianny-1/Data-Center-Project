"use client";

import { useState } from "react";
import { NEWS_CATEGORIES, NEWS_SIGNALS } from "@/lib/news-classify";
import { OUTLET_TYPE_LABEL, SIGNAL_TONE, type ClassifiedNews } from "@/lib/news-meta";

type Tab = "all" | "official" | "national" | "local" | "industry";

const TABS: { id: Tab; label: string; match: (n: ClassifiedNews) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "official", label: "Official", match: (n) => n.data.outletType === "government" },
  { id: "national", label: "National", match: (n) => ["national_news", "business_news"].includes(n.data.outletType) },
  { id: "local", label: "Local", match: (n) => ["local_news", "public_media", "nonprofit_news"].includes(n.data.outletType) },
  { id: "industry", label: "Industry", match: (n) => ["trade", "press_release"].includes(n.data.outletType) },
];

const DOT: Record<string, string> = { red: "bg-[#c43c3a]", amber: "bg-amber-500", violet: "bg-violet-500", green: "bg-emerald-500", slate: "bg-slate-300" };

/** Simple, scannable news list with source-type tabs (Official / National / Local / Industry). */
export default function NewsTabs({ items, limit = 12 }: { items: ClassifiedNews[]; limit?: number }) {
  const [tab, setTab] = useState<Tab>("all");
  const [expanded, setExpanded] = useState(false);
  const counts = Object.fromEntries(TABS.map((t) => [t.id, items.filter(t.match).length]));
  const list = items.filter(TABS.find((t) => t.id === tab)!.match);
  const shown = expanded ? list.slice(0, 60) : list.slice(0, limit);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.filter((t) => t.id === "all" || counts[t.id] > 0).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1 text-sm ${tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {t.label} <span className="opacity-60">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No stories yet. New ones appear automatically.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((n) => (
            <li key={n.id} className="py-3">
              <a href={n.data.url} target="_blank" rel="noopener noreferrer" className="group block">
                <p className="font-medium leading-snug text-slate-900 group-hover:text-blue-700">{n.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{n.data.outlet}</span>
                  {n.data.outletType === "government" && <span className="rounded bg-slate-900 px-1 text-[10px] font-semibold text-white">{OUTLET_TYPE_LABEL.government}</span>}
                  <span>{n.date}</span>
                  <span>· {NEWS_CATEGORIES[n.category]}</span>
                  {n.signal !== "none" && (
                    <span className="flex items-center gap-1">
                      · <span className={`inline-block h-2 w-2 rounded-full ${DOT[SIGNAL_TONE[n.signal]]}`} />
                      {NEWS_SIGNALS[n.signal]}
                    </span>
                  )}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.length > limit && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="mt-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          {expanded ? "Show less" : `Show more (${Math.min(list.length, 60) - limit} more)`}
        </button>
      )}
    </div>
  );
}
