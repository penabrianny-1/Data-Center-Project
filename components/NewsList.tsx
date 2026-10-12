import { NEWS_CATEGORIES, NEWS_SIGNALS } from "@/lib/news-classify";
import { OUTLET_TYPE_LABEL, SIGNAL_TONE, type ClassifiedNews } from "@/lib/news-meta";
import { Empty, Pill } from "./ui";

export type { NewsData } from "@/lib/news-meta";

export default function NewsList({ items, showSummary = true }: { items: ClassifiedNews[]; showSummary?: boolean }) {
  if (!items.length) return <Empty title="No matching stories in the monitored feeds yet">New stories appear here automatically as feeds refresh (hourly).</Empty>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {items.map((a) => <NewsRow key={a.id} item={a} showSummary={showSummary} />)}
    </ul>
  );
}

export function NewsRow({ item: a, showSummary = true }: { item: ClassifiedNews; showSummary?: boolean }) {
  const d = a.data;
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <time className="tabular-nums" dateTime={d.published ?? undefined}>{a.date ?? "undated"}</time>
        <span className="font-medium text-slate-700">{d.outlet}</span>
        <span className="rounded bg-slate-100 px-1">{OUTLET_TYPE_LABEL[d.outletType] ?? d.outletType}</span>
        <Pill tone="blue">{NEWS_CATEGORIES[a.category]}</Pill>
        {a.signal !== "none" && <Pill tone={SIGNAL_TONE[a.signal]}>{NEWS_SIGNALS[a.signal]}</Pill>}
        {d.states.slice(0, 4).map((s) => (
          <a key={s} href={`/states/${s}`} className="rounded bg-slate-100 px-1 font-medium hover:bg-slate-200">{s}</a>
        ))}
        {a.international && <span className="rounded bg-slate-100 px-1 italic">international</span>}
      </div>
      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium leading-snug text-slate-900 underline decoration-slate-200 hover:decoration-slate-600">
        {a.title}
      </a>
      {showSummary && d.summary && <p className="line-clamp-2 text-xs text-slate-600">{d.summary}</p>}
    </li>
  );
}
