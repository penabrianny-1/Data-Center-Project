"use client";

import { useMemo, useState } from "react";
import { RATINGS, shift, type Predictions, type RatingValue } from "@/lib/ratings";

export interface PartyMoney {
  name: string;
  raised: number | null;
  cash: number | null;
  through: string | null;
  outsideFor: number | null;
  outsideAgainst: number | null;
  source: string | null;
}

export interface BoardRace {
  id: string;
  state: string;
  stateName: string;
  special: boolean;
  incumbent: { name: string; party: string; running: boolean } | null;
  nominees: { name: string; party: string }[];
  pros: { rater: string; rating: string; date: string; url: string }[];
  markets: { avgD: number; avgR: number; quotes: { market: string; url: string; D: number; R: number; volume: number | null }[] } | null;
  money: Record<string, PartyMoney>;
}

const STYLE: Record<RatingValue, { head: string; card: string }> = {
  "Solid D": { head: "bg-[#0d366b] text-white", card: "bg-[#0d366b] text-white" },
  "Likely D": { head: "bg-[#1c5cab] text-white", card: "bg-[#1c5cab] text-white" },
  "Lean D": { head: "bg-[#3987e5] text-white", card: "bg-[#3987e5] text-white" },
  "Tilt D": { head: "bg-[#86b6ef] text-slate-900", card: "bg-[#cde2fb] text-slate-900" },
  "Toss-up": { head: "bg-[#b5b3ab] text-slate-900", card: "bg-[#ecebe6] text-slate-900" },
  "Tilt R": { head: "bg-[#eea197] text-slate-900", card: "bg-[#f9d9d4] text-slate-900" },
  "Lean R": { head: "bg-[#e2706a] text-white", card: "bg-[#e2706a] text-white" },
  "Likely R": { head: "bg-[#c43c3a] text-white", card: "bg-[#c43c3a] text-white" },
  "Solid R": { head: "bg-[#8f1d1d] text-white", card: "bg-[#8f1d1d] text-white" },
};

const LABEL: Record<RatingValue, string> = {
  "Solid D": "Solid Democratic", "Likely D": "Likely Democratic", "Lean D": "Lean Democratic", "Tilt D": "Tilt Democratic",
  "Toss-up": "Toss-up", "Tilt R": "Tilt Republican", "Lean R": "Lean Republican", "Likely R": "Likely Republican", "Solid R": "Solid Republican",
};

const lastName = (n: string) => n.replace(/,? (Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").at(-1) ?? n;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

function raceLabel(r: BoardRace): string {
  const inc = r.incumbent;
  const who = inc?.running ? `${lastName(inc.name)}, ${inc.party}` : `Open; ${inc ? `${lastName(inc.name)}, ${inc.party}` : "vacant"}`;
  return `${r.stateName}${r.special ? " (Special)" : ""} (${who})`;
}

interface Props {
  office: "sen" | "gov";
  races: BoardRace[];
  notUp: { D: number; R: number };
  total: number;
  majority: number;
  control: { D: number; R: number; markets: string[] } | null;
  initial: Predictions;
}

export default function SenateBoard({ office, races, notUp, total, majority, control, initial }: Props) {
  const [preds, setPreds] = useState<Predictions>(initial);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const raters = useMemo(() => [...new Set(races.flatMap((r) => r.pros.map((p) => p.rater)))], [races]);
  const [compare, setCompare] = useState<string>(raters[0] ?? "");
  const noun = office === "sen" ? "Senate" : "Governor";

  const ratingOf = (id: string) => preds.ratings[id]?.rating ?? null;
  const lastMove = (id: string) => [...preds.history].reverse().find((h) => h.raceId === id);

  async function save(updates: { raceId: string; rating: RatingValue | null; note?: string }[]) {
    setSaving(true);
    setError(null);
    setPreds((p) => {
      const next = structuredClone(p);
      for (const u of updates) {
        if (u.rating === null) delete next.ratings[u.raceId];
        else next.ratings[u.raceId] = { rating: u.rating, note: u.note ?? next.ratings[u.raceId]?.note, updatedAt: new Date().toISOString() };
      }
      return next;
    });
    try {
      const res = await fetch("/api/predictions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates }) });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setPreds(await res.json());
    } catch (e) {
      setError(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const byRating = Object.fromEntries(RATINGS.map((r) => [r, races.filter((x) => ratingOf(x.id) === r)])) as Record<RatingValue, BoardRace[]>;
  const unrated = races.filter((r) => !ratingOf(r.id));
  const dSide = (["Solid D", "Likely D", "Lean D", "Tilt D"] as const).reduce((n, k) => n + byRating[k].length, 0);
  const rSide = (["Solid R", "Likely R", "Lean R", "Tilt R"] as const).reduce((n, k) => n + byRating[k].length, 0);
  const toss = byRating["Toss-up"].length;
  const projD = notUp.D + dSide;
  const projR = notUp.R + rSide;
  // Market-implied expected seats: sum of each race's average D probability.
  const marketD = notUp.D + races.reduce((n, r) => n + (r.markets?.avgD ?? 0.5), 0);
  const marketPriced = races.filter((r) => r.markets).length;

  const party = (p: "D" | "R") => races.reduce(
    (acc, r) => {
      const m = r.money[p];
      if (m) {
        acc.raised += m.raised ?? 0;
        acc.cash += m.cash ?? 0;
      }
      // Outside money helping a party = for its nominee + against the other party's nominee.
      const other = r.money[p === "D" ? "R" : "D"];
      acc.outside += (m?.outsideFor ?? 0) + (other?.outsideAgainst ?? 0);
      return acc;
    },
    { raised: 0, cash: 0, outside: 0 },
  );
  const dm = party("D");
  const rm = party("R");

  const fillFrom = (rater: string) =>
    save(races.map((r) => ({ raceId: r.id, rating: (r.pros.find((p) => p.rater === rater)?.rating ?? null) as RatingValue | null })).filter((u) => u.rating !== null));
  const fillFromMarkets = () =>
    save(
      races.filter((r) => r.markets).map((r) => {
        const d = r.markets!.avgD / (r.markets!.avgD + r.markets!.avgR || 1);
        const rating: RatingValue = d >= 0.95 ? "Solid D" : d >= 0.8 ? "Likely D" : d >= 0.65 ? "Lean D" : d >= 0.55 ? "Tilt D" : d > 0.45 ? "Toss-up" : d > 0.35 ? "Tilt R" : d > 0.2 ? "Lean R" : d > 0.05 ? "Likely R" : "Solid R";
        return { raceId: r.id, rating };
      }),
    );

  return (
    <div onClick={() => setMenu(null)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-4 border-slate-900 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">2026 {noun} Ratings</p>
          <h1 className="text-3xl font-bold tracking-tight">My {noun} Ratings</h1>
          <p className="mt-1 text-sm text-slate-500">
            {preds.updatedAt ? `Last updated ${new Date(preds.updatedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}` : "Not rated yet"}
            {saving && " · saving…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Start from:</span>
          {raters.map((r) => (
            <button key={r} type="button" onClick={(e) => { e.stopPropagation(); if (confirm(`Replace your ${noun.toLowerCase()} ratings with ${r}'s?`)) fillFrom(r); }} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
              {r.replace(/^The /, "")}
            </button>
          ))}
          <button type="button" onClick={(e) => { e.stopPropagation(); if (confirm("Replace your ratings with ones derived from prediction-market prices?")) fillFromMarkets(); }} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
            Prediction markets
          </button>
        </div>
      </div>
      {error && <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {/* Summary strip */}
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Prediction markets</div>
          {office === "sen" && control ? (
            <div className="mt-1"><strong className="text-[#1c5cab]">D {pct(control.D)}</strong> · <strong className="text-[#c43c3a]">R {pct(control.R)}</strong> to win the Senate <span className="text-xs text-slate-400">({control.markets.join(", ")})</span></div>
          ) : null}
          <div className="mt-0.5 text-slate-600">Market-implied: <strong>{marketD.toFixed(1)}</strong> {office === "sen" ? "Democratic seats" : "Democratic governors"} <span className="text-xs text-slate-400">({marketPriced}/{races.length} races priced)</span></div>
        </div>
        <MoneyBox label="Raised by nominees (these races)" d={dm.raised} r={rm.raised} note={office === "gov" ? "State-race money integrated for Texas so far" : "FEC, through latest reports"} />
        <MoneyBox label="Outside spending helping each party" d={dm.outside} r={rm.outside} note={office === "gov" ? "Federal filings only; not available for governors" : "FEC 24/48-hour reports"} />
      </div>

      {/* Seat math */}
      <div className="mb-5">
        <div className="mb-1 flex justify-between text-sm font-semibold">
          <span className="text-[#1c5cab]">Democrats {projD}</span>
          <span className="text-slate-600">{toss} Toss-up{toss === 1 ? "" : "s"}{unrated.length ? ` · ${unrated.length} unrated` : ""}</span>
          <span className="text-[#c43c3a]">Republicans {projR}</span>
        </div>
        <div className="relative flex h-7 w-full overflow-hidden rounded" role="img" aria-label={`Projected ${projD} D, ${toss} toss-ups, ${projR} R`}>
          {[
            { n: notUp.D, cls: "bg-[#0d366b]", t: `${notUp.D} D not up` },
            ...(["Solid D", "Likely D", "Lean D", "Tilt D"] as const).map((k) => ({ n: byRating[k].length, cls: STYLE[k].head.split(" ")[0], t: `${byRating[k].length} ${k}` })),
            { n: toss + unrated.length, cls: "bg-[#ecebe6]", t: `${toss} toss-ups, ${unrated.length} unrated` },
            ...(["Tilt R", "Lean R", "Likely R", "Solid R"] as const).map((k) => ({ n: byRating[k].length, cls: STYLE[k].head.split(" ")[0], t: `${byRating[k].length} ${k}` })),
            { n: notUp.R, cls: "bg-[#8f1d1d]", t: `${notUp.R} R not up` },
          ].map((s, i) => s.n > 0 && <div key={i} title={s.t} className={`${s.cls} border-r border-white/60`} style={{ width: `${(s.n / total) * 100}%` }} />)}
          <div className="absolute inset-y-0 left-1/2 w-0.5 bg-slate-900" title={`${total / 2}`} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>{notUp.D} not up{office === "sen" ? " (incl. independents who caucus with Democrats)" : ""}</span>
          <span>{office === "sen" ? `${majority} for a majority · the Republican vice president breaks 50–50 ties` : `${majority} for a majority of governorships`}</span>
          <span>{notUp.R} not up</span>
        </div>
      </div>

      {/* Rating columns */}
      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-9">
        {RATINGS.map((rating) => (
          <div
            key={rating}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging && ratingOf(dragging) !== rating) save([{ raceId: dragging, rating }]);
              setDragging(null);
            }}
            className={`flex min-h-48 flex-col rounded ${dragging ? "ring-2 ring-dashed ring-slate-300" : ""}`}
          >
            <div className={`rounded-t px-2 py-2 text-center ${STYLE[rating].head}`}>
              <div className="text-[13px] font-bold leading-tight">{LABEL[rating]}</div>
              <div className="text-xs opacity-80">{byRating[rating].length}</div>
            </div>
            <div className="flex flex-1 flex-col gap-1 rounded-b bg-slate-50 p-1">
              {byRating[rating].map((r) => (
                <RaceCard key={r.id} race={r} rating={rating} move={lastMove(r.id)} open={menu === r.id} onOpen={() => setMenu(menu === r.id ? null : r.id)} onPick={(v) => { setMenu(null); save([{ raceId: r.id, rating: v }]); }} onDragStart={() => setDragging(r.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {unrated.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Not yet rated ({unrated.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {unrated.map((r) => (
              <RaceCard key={r.id} race={r} rating={null} open={menu === r.id} onOpen={() => setMenu(menu === r.id ? null : r.id)} onPick={(v) => { setMenu(null); save([{ raceId: r.id, rating: v }]); }} onDragStart={() => setDragging(r.id)} />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Drag a race into a column, click it to choose a rating, or start from published ratings or market prices above.</p>
        </div>
      )}

      {/* Race table: my rating, pros, markets, money */}
      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Every race: your rating, the pros, the markets and the money</h2>
          <label className="text-sm text-slate-600">
            Compare with{" "}
            <select value={compare} onChange={(e) => setCompare(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1">
              {raters.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Race</th>
                <th className="px-3 py-2">Mine</th>
                <th className="px-3 py-2">{compare.replace(/^The /, "")}</th>
                <th className="px-3 py-2">Markets (D win %)</th>
                <th className="px-3 py-2">Democrat: raised · cash</th>
                <th className="px-3 py-2">Republican: raised · cash</th>
                <th className="px-3 py-2">Outside $ (helping D / R)</th>
                <th className="px-3 py-2">My note</th>
              </tr>
            </thead>
            <tbody>
              {races.map((r) => {
                const mine = ratingOf(r.id);
                const pro = r.pros.find((p) => p.rater === compare);
                const diff = mine && pro ? shift(pro.rating as RatingValue, mine) : null;
                const D = r.money.D, R = r.money.R;
                const helpD = (D?.outsideFor ?? 0) + (R?.outsideAgainst ?? 0);
                const helpR = (R?.outsideFor ?? 0) + (D?.outsideAgainst ?? 0);
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-medium"><a href={`/elections/${r.id}`} className="hover:underline">{raceLabel(r)}</a></td>
                    <td className="px-3 py-2">{mine ? <Chip rating={mine} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2">
                      {pro ? <a href={pro.url} target="_blank" rel="noopener noreferrer" title={pro.date}><Chip rating={pro.rating as RatingValue} /></a> : "—"}
                      {diff !== null && diff !== 0 && <div className="text-[10px] text-slate-500">you: {Math.abs(diff)} more {diff < 0 ? "D" : "R"}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {r.markets ? (
                        <div>
                          <MarketBar d={r.markets.avgD} r={r.markets.avgR} />
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                            {r.markets.quotes.map((q) => (
                              <a key={q.market} href={q.url} target="_blank" rel="noopener noreferrer" className="rounded bg-slate-100 px-1 text-slate-600 hover:bg-slate-200" title={q.volume ? `Volume $${Math.round(q.volume).toLocaleString()}` : undefined}>
                                {q.market} {pct(q.D)}
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : <span className="text-xs text-slate-400">No market</span>}
                    </td>
                    <td className="px-3 py-2 text-xs"><Money m={D} /></td>
                    <td className="px-3 py-2 text-xs"><Money m={R} /></td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {helpD || helpR ? <><span className="text-[#1c5cab]">{usd(helpD)}</span> / <span className="text-[#c43c3a]">{usd(helpR)}</span></> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <NoteField initial={preds.ratings[r.id]?.note ?? ""} disabled={!mine} onSave={(note) => mine && save([{ raceId: r.id, rating: mine, note }])} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Market odds are the average implied probability across Kalshi, Polymarket and PredictIt, refreshed hourly. They reflect traders&apos; bets, not polls. Money comes from FEC filings for Senate candidates and state filings for governors where integrated. Your ratings are a personal forecast, saved to <code>data/user/predictions.json</code>.
        </p>
      </div>
    </div>
  );
}

function MoneyBox({ label, d, r, note }: { label: string; d: number; r: number; note: string }) {
  const t = d + r;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1"><strong className="text-[#1c5cab]">D {usd(d)}</strong> · <strong className="text-[#c43c3a]">R {usd(r)}</strong></div>
      {t > 0 && (
        <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-[#2a78d6]" style={{ width: `${(d / t) * 100}%` }} />
          <div className="bg-[#e34948]" style={{ width: `${(r / t) * 100}%` }} />
        </div>
      )}
      <div className="mt-1 text-[11px] text-slate-400">{note}</div>
    </div>
  );
}

function MarketBar({ d, r }: { d: number; r: number }) {
  const t = d + r || 1;
  return (
    <div className="w-28">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-[#2a78d6]" style={{ width: `${(d / t) * 100}%` }} />
        <div className="bg-[#e34948]" style={{ width: `${(r / t) * 100}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] font-semibold"><span className="text-[#1c5cab]">D {pct(d / t)}</span><span className="text-[#c43c3a]">R {pct(r / t)}</span></div>
    </div>
  );
}

function Money({ m }: { m?: PartyMoney }) {
  if (!m) return <span className="text-slate-400">—</span>;
  return (
    <div>
      <div className="font-medium text-slate-800">{lastName(m.name)}</div>
      {m.raised != null ? (
        <div className="tabular-nums text-slate-600">{usd(m.raised)}{m.cash != null && ` · ${usd(m.cash)} cash`}</div>
      ) : (
        <div className="text-slate-400">Not integrated yet</div>
      )}
      {m.through && <div className="text-[10px] text-slate-400">{m.source} thru {m.through}</div>}
    </div>
  );
}

function Chip({ rating }: { rating: RatingValue }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${STYLE[rating]?.head ?? "bg-slate-200"}`}>{rating}</span>;
}

function RaceCard({
  race, rating, move, open, onOpen, onPick, onDragStart,
}: {
  race: BoardRace;
  rating: RatingValue | null;
  move?: { from: RatingValue | null; to: RatingValue; at: string };
  open: boolean;
  onOpen: () => void;
  onPick: (v: RatingValue | null) => void;
  onDragStart: () => void;
}) {
  const dir = move && move.to === rating ? shift(move.from, move.to) : 0;
  const style = rating ? STYLE[rating].card : "bg-white text-slate-900 ring-1 ring-slate-200";
  const m = race.markets;
  const marketTip = m ? `Markets: D ${pct(m.avgD / (m.avgD + m.avgR || 1))}` : "No market";
  return (
    <div className="relative">
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title={`${marketTip}${race.pros[0] ? ` · ${race.pros[0].rater}: ${race.pros[0].rating}` : ""}`}
        className={`w-full cursor-grab rounded px-1.5 py-1 text-left text-[12px] font-medium leading-tight shadow-sm active:cursor-grabbing ${style} ${race.incumbent?.running ? "" : "italic"}`}
      >
        {dir !== 0 && <span className="mr-0.5 font-bold" title={`Moved ${dir < 0 ? "toward Democrats" : "toward Republicans"} on ${move!.at.slice(0, 10)}`}>{dir < 0 ? "◀" : "▶"}</span>}
        {raceLabel(race)}
        {m && <span className="ml-1 whitespace-nowrap text-[10px] font-normal opacity-80">· D {pct(m.avgD / (m.avgD + m.avgR || 1))}</span>}
      </button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
          {RATINGS.map((v) => (
            <button key={v} type="button" onClick={() => onPick(v)} className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-slate-50 ${v === rating ? "font-bold" : ""}`}>
              <span className={`inline-block h-3 w-3 rounded-sm ${STYLE[v].head.split(" ")[0]}`} /> {LABEL[v]}
            </button>
          ))}
          {rating && <button type="button" onClick={() => onPick(null)} className="w-full border-t border-slate-100 px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-50">Clear rating</button>}
        </div>
      )}
    </div>
  );
}

function NoteField({ initial, disabled, onSave }: { initial: string; disabled: boolean; onSave: (note: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      type="text"
      value={v}
      disabled={disabled}
      placeholder={disabled ? "Rate first" : "Add a note…"}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== initial && onSave(v)}
      className="w-48 rounded border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-50"
    />
  );
}
