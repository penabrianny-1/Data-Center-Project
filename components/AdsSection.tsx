import Link from "next/link";
import type { EcGroupData, GoogleAdvertiserData, GoogleStateData, Row } from "@/lib/repo";
import { titleCase } from "./money";
import { money } from "./ui";

const TYPE_STYLE: Record<string, string> = {
  "Issue group (not FEC-registered)": "bg-rose-100 text-rose-800",
  "Prediction-market company": "bg-amber-100 text-amber-900",
  "Candidate campaign": "bg-slate-100 text-slate-700",
  "Party committee": "bg-slate-800 text-white",
};

export function AdType({ type }: { type: string }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_STYLE[type] ?? "bg-violet-100 text-violet-800"}`}>{type}</span>;
}

export function GoogleAdvertisers({ rows }: { rows: Row<GoogleAdvertiserData>[] }) {
  return (
    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
          <span>
            <span className="mr-1.5 text-xs tabular-nums text-slate-400">{i + 1}</span>
            {r.data.fecId ? <Link href={`/money/${r.data.fecId}`} className="font-medium hover:underline">{titleCase(r.data.name)}</Link> : <a href={r.sources[0]?.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{titleCase(r.data.name)}</a>}{" "}
            <AdType type={r.data.type} />
            <span className="block text-[11px] text-slate-500">Top states: {r.data.topStates.slice(0, 4).map((s) => s.state).join(", ") || "—"}</span>
          </span>
          <span className="font-semibold tabular-nums">{money(r.data.cycleSpend)}</span>
        </li>
      ))}
    </ol>
  );
}

export function GoogleStateList({ data }: { data: GoogleStateData }) {
  return (
    <div>
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {data.top.slice(0, 8).map((r) => (
          <li key={r.advertiserId} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <span>{titleCase(r.name)} <AdType type={r.type} /></span>
            <span className="font-semibold tabular-nums">{money(r.amount)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[11px] text-slate-400">{data.note}</p>
    </div>
  );
}

export function EcGroups({ rows, state }: { rows: Row<EcGroupData>[]; state?: string }) {
  const list = state ? rows.filter((r) => r.data.states.includes(state)) : rows;
  if (!list.length) return <p className="text-sm text-slate-500">No electioneering communications reported{state ? " naming this state's candidates" : ""} in 2025–26.</p>;
  return (
    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {list.slice(0, 12).map((r) => (
        <li key={r.id} className="px-3 py-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <a href={r.sources[0]?.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{titleCase(r.data.name)}</a>
            <span className="font-semibold tabular-nums">{money(r.data.total)}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Ads naming {r.data.candidates.slice(0, 3).map((c) => `${c.name} (${c.state})`).join(", ")} · last {r.data.lastDate}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AdImpactPosts({ posts, limit = 6 }: { posts: Row<import("@/lib/repo").AdImpactPost>[]; limit?: number }) {
  if (!posts.length) return <p className="text-sm text-slate-500">No AdImpact analyses published for this yet.</p>;
  return (
    <ul className="space-y-3">
      {posts.slice(0, limit).map((p) => (
        <li key={p.id} className="rounded-lg border border-slate-200 p-3">
          <a href={p.data.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{p.data.title}</a>
          <div className="text-[11px] text-slate-400">AdImpact · {p.data.date}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
            {p.data.figures.slice(0, 3).map((f) => <li key={f}>{f.replace(/^Written by [^.]*?(?=[A-Z][a-z]+ )/, "").slice(0, 260)}</li>)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
