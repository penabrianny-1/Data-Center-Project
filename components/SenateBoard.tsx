"use client";

import { useMemo, useState } from "react";
import { RATINGS, shift, type Predictions, type RatingValue } from "@/lib/ratings";

export interface BoardRace {
  id: string;
  state: string;
  stateName: string;
  special: boolean;
  incumbent: { name: string; party: string; running: boolean } | null;
  nominees: { name: string; party: string }[];
  pros: { rater: string; rating: string; date: string; url: string }[];
}

/** Blue → neutral → red, matching the validated ordinal arms used on the map. */
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

function raceLabel(r: BoardRace): string {
  const inc = r.incumbent;
  const who = inc?.running ? `${lastName(inc.name)}, ${inc.party}` : `Open; ${inc ? `${lastName(inc.name)}, ${inc.party}` : "vacant"}`;
  return `${r.stateName}${r.special ? " (Special)" : ""} (${who})`;
}

export default function SenateBoard({ races, notUp, initial }: { races: BoardRace[]; notUp: { D: number; R: number }; initial: Predictions }) {
  const [preds, setPreds] = useState<Predictions>(initial);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<string>(races[0]?.pros[0]?.rater ?? "");

  const raters = useMemo(() => [...new Set(races.flatMap((r) => r.pros.map((p) => p.rater)))], [races]);
  const ratingOf = (id: string) => preds.ratings[id]?.rating ?? null;
  const lastMove = (id: string) => [...preds.history].reverse().find((h) => h.raceId === id);

  async function save(updates: { raceId: string; rating: RatingValue | null; note?: string }[]) {
    setSaving(true);
    setError(null);
    // Optimistic update
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

  const fillFrom = (rater: string) =>
    save(
      races
        .map((r) => ({ raceId: r.id, rating: (r.pros.find((p) => p.rater === rater)?.rating ?? null) as RatingValue | null }))
        .filter((u) => u.rating !== null),
    );

  return (
    <div onClick={() => setMenu(null)}>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-4 border-slate-900 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">2026 Senate Ratings</p>
          <h1 className="text-3xl font-bold tracking-tight">My Senate Ratings</h1>
          <p className="mt-1 text-sm text-slate-500">
            {preds.updatedAt ? `Last updated ${new Date(preds.updatedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}` : "Not rated yet"}
            {saving && " · saving…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Start from:</span>
          {raters.map((r) => (
            <button key={r} type="button" onClick={(e) => { e.stopPropagation(); if (confirm(`Replace your ratings with ${r}'s?`)) fillFrom(r); }} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
              {r.replace(/^The /, "")}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

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
          ].map((s, i) => s.n > 0 && <div key={i} title={s.t} className={`${s.cls} border-r border-white/60`} style={{ width: `${s.n}%` }} />)}
          <div className="absolute inset-y-0 left-1/2 w-0.5 bg-slate-900" title="50 seats" />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>{notUp.D} not up (incl. independents who caucus with Democrats)</span>
          <span>51 for a majority · the Republican vice president breaks 50–50 ties</span>
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
                <RaceCard
                  key={r.id}
                  race={r}
                  rating={rating}
                  move={lastMove(r.id)}
                  compare={r.pros.find((p) => p.rater === compare)?.rating}
                  open={menu === r.id}
                  onOpen={() => setMenu(menu === r.id ? null : r.id)}
                  onPick={(v) => { setMenu(null); save([{ raceId: r.id, rating: v }]); }}
                  onDragStart={() => setDragging(r.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Unrated */}
      {unrated.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Not yet rated ({unrated.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {unrated.map((r) => (
              <RaceCard key={r.id} race={r} rating={null} compare={r.pros.find((p) => p.rater === compare)?.rating} open={menu === r.id} onOpen={() => setMenu(menu === r.id ? null : r.id)} onPick={(v) => { setMenu(null); save([{ raceId: r.id, rating: v }]); }} onDragStart={() => setDragging(r.id)} />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Drag a race into a column, click it to choose a rating, or start from a published set of ratings above.</p>
        </div>
      )}

      {/* Compare & notes */}
      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Your ratings vs. the pros</h2>
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
              <tr><th className="px-3 py-2">Race</th><th className="px-3 py-2">Nominees</th><th className="px-3 py-2">Mine</th><th className="px-3 py-2">{compare.replace(/^The /, "")}</th><th className="px-3 py-2">Difference</th><th className="px-3 py-2">My note</th></tr>
            </thead>
            <tbody>
              {races.map((r) => {
                const mine = ratingOf(r.id);
                const pro = r.pros.find((p) => p.rater === compare);
                const diff = mine && pro ? shift(pro.rating as RatingValue, mine) : null;
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-medium"><a href={`/elections/${r.id}`} className="hover:underline">{raceLabel(r)}</a></td>
                    <td className="px-3 py-2 text-slate-600">{r.nominees.map((n) => `${lastName(n.name)} (${n.party})`).join(" · ") || "—"}</td>
                    <td className="px-3 py-2">{mine ? <Chip rating={mine} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2">{pro ? <a href={pro.url} target="_blank" rel="noopener noreferrer" title={pro.date}><Chip rating={pro.rating as RatingValue} /></a> : "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{diff === null ? "" : diff === 0 ? "Same" : `${Math.abs(diff)} step${Math.abs(diff) > 1 ? "s" : ""} more ${diff < 0 ? "Democratic" : "Republican"}`}</td>
                    <td className="px-3 py-2">
                      <NoteField
                        initial={preds.ratings[r.id]?.note ?? ""}
                        disabled={!mine}
                        onSave={(note) => mine && save([{ raceId: r.id, rating: mine, note }])}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          These are your own ratings, a personal forecast, not data. They&apos;re saved to <code>data/user/predictions.json</code> with a full change history.
        </p>
      </div>
    </div>
  );
}

function Chip({ rating }: { rating: RatingValue }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${STYLE[rating]?.head ?? "bg-slate-200"}`}>{rating}</span>;
}

function RaceCard({
  race, rating, move, compare, open, onOpen, onPick, onDragStart,
}: {
  race: BoardRace;
  rating: RatingValue | null;
  move?: { from: RatingValue | null; to: RatingValue; at: string };
  compare?: string;
  open: boolean;
  onOpen: () => void;
  onPick: (v: RatingValue | null) => void;
  onDragStart: () => void;
}) {
  const dir = move && move.to === rating ? shift(move.from, move.to) : 0;
  const style = rating ? STYLE[rating].card : "bg-white text-slate-900 ring-1 ring-slate-200";
  return (
    <div className="relative">
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title={compare ? `Pro rating: ${compare}` : undefined}
        className={`w-full cursor-grab rounded px-1.5 py-1 text-left text-[12px] font-medium leading-tight shadow-sm active:cursor-grabbing ${style} ${race.incumbent?.running ? "" : "italic"}`}
      >
        {dir !== 0 && <span className="mr-0.5 font-bold" title={`Moved ${dir < 0 ? "toward Democrats" : "toward Republicans"} on ${move!.at.slice(0, 10)}`}>{dir < 0 ? "◀" : "▶"}</span>}
        {raceLabel(race)}
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
      className="w-56 rounded border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-50"
    />
  );
}
