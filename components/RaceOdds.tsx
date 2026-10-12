import type { MarketData, PollsData } from "@/lib/repo";

const clean = (n: string) => n.replace(/\s*\*\s*$/, "");
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Prediction-market prices for one race, one row per market. */
export function MarketsPanel({ m, url }: { m: MarketData; url?: string }) {
  return (
    <div className="space-y-1.5 text-xs">
      {m.quotes.map((q) => {
        const d = q.byParty.D ?? 0, r = q.byParty.R ?? 0, t = d + r || 1;
        return (
          <a key={q.market} href={q.url} target="_blank" rel="noopener noreferrer" className="block rounded border border-slate-200 px-2 py-1.5 hover:bg-slate-50">
            <div className="flex justify-between"><span className="font-medium">{q.market}</span><span className="text-slate-400">{q.volume ? `$${Math.round(q.volume).toLocaleString()} traded` : ""}</span></div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100"><div className="bg-[#2a78d6]" style={{ width: `${(d / t) * 100}%` }} /><div className="bg-[#e34948]" style={{ width: `${(r / t) * 100}%` }} /></div>
            <div className="mt-0.5 flex justify-between font-semibold"><span className="text-[#1c5cab]">D {pct(d / t)}</span><span className="text-[#c43c3a]">R {pct(r / t)}</span></div>
            {q.candidates.length > 0 && <div className="text-[10px] text-slate-500">{q.candidates.slice(0, 3).map((c) => `${c.name} ${Math.round(c.price * 100)}¢`).join(" · ")}</div>}
          </a>
        );
      })}
      <p className="text-[10px] text-slate-400">Prices are traders&apos; bets, read as implied chances. They aren&apos;t polls or forecasts.{url ? "" : ""}</p>
    </div>
  );
}

/** 270toWin's polling average and every listed poll for the general-election matchup. */
export function PollsPanel({ p }: { p: PollsData }) {
  const m = p.matchup;
  if (!m) {
    const latest = p.polls[0];
    return latest ? (
      <p className="text-xs text-slate-600">Latest: {latest.pollster} ({latest.date}): {latest.results.map((r) => `${clean(r.name)} ${r.pct}%`).join(" · ")}</p>
    ) : <p className="text-xs text-slate-500">No public polls listed.</p>;
  }
  return (
    <div className="text-xs">
      {m.average && (
        <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="font-semibold text-slate-700">270toWin average of {m.average.polls} polls</div>
          <div className="mt-0.5 flex flex-wrap gap-3">
            {m.candidates.map((c, i) => (
              <span key={c.name} className={c.party === "D" ? "text-[#1c5cab]" : c.party === "R" ? "text-[#c43c3a]" : "text-slate-700"}>
                <strong>{clean(c.name)}</strong> {m.average!.values[i] ?? "—"}%
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr><th className="px-2 py-1">Pollster</th><th className="px-2 py-1">Date</th><th className="px-2 py-1">Sample</th>{m.candidates.map((c) => <th key={c.name} className="px-2 py-1 text-right">{clean(c.name)}</th>)}</tr>
          </thead>
          <tbody>
            {m.polls.map((poll, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 py-1">{poll.url ? <a href={poll.url} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300">{poll.pollster}</a> : poll.pollster}{poll.inAverage && <span className="ml-1 text-[9px] text-slate-400">avg</span>}</td>
                <td className="px-2 py-1 tabular-nums text-slate-500">{poll.date}</td>
                <td className="px-2 py-1 text-slate-500">{poll.sample}</td>
                {m.candidates.map((c, j) => <td key={c.name} className="px-2 py-1 text-right tabular-nums">{poll.values[j] ?? "—"}%</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        Polls as listed by {p.statePage ? <a href={p.statePage} target="_blank" rel="noopener noreferrer" className="underline">270toWin</a> : "270toWin"}, each linked to the pollster&apos;s release. Silver Bulletin (paywalled; its site blocks AI agents) and FiveThirtyEight (shut down in 2025) aren&apos;t included.
      </p>
    </div>
  );
}
