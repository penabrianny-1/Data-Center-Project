import Link from "next/link";
import type { CandidateData, Row } from "@/lib/repo";
import type { Bill, Commission, Docket, LocalAction, Race, StatePolicy } from "@/lib/schema";
import { DIMENSION_KEYS, DIMENSION_META } from "@/lib/scoring";
import { ConfidenceBadge, Empty, Evidence, Impact, KV, Missing, Party, Pill, Provenance, Sources, humanize } from "./ui";

// ---------------------------------------------------------------------------
// Bills

const BILL_STATUS_TONE: Record<string, "slate" | "red" | "amber" | "green" | "blue" | "violet"> = {
  enacted: "green", vetoed: "red", failed: "slate", inactive: "slate", carried_over: "violet",
  passed_legislature: "blue", passed_chamber: "blue", passed_committee: "amber", in_committee: "amber", introduced: "slate",
};

export function BillStatus({ status }: { status: string }) {
  return <Pill tone={BILL_STATUS_TONE[status] ?? "slate"}>{humanize(status)}</Pill>;
}

export function BillTable({ bills, showJurisdiction = true }: { bills: Row<Bill>[]; showJurisdiction?: boolean }) {
  if (!bills.length) return <Empty title="No bills on record">Bill research for this jurisdiction hasn&apos;t been completed or found nothing that matches.</Empty>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            {showJurisdiction && <th className="px-2 py-1.5 font-medium">Jur.</th>}
            <th className="px-2 py-1.5 font-medium">Bill</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            <th className="px-2 py-1.5 font-medium">Latest action</th>
            <th className="px-2 py-1.5 font-medium">Direction</th>
            <th className="px-2 py-1.5 font-medium">Verified</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
              {showJurisdiction && <td className="px-2 py-1.5 font-semibold">{b.data.jurisdiction}</td>}
              <td className="max-w-md px-2 py-1.5">
                <Link href={`/legislation/${b.data.id}`} className="font-medium text-slate-900 underline decoration-slate-300">
                  {b.data.number}
                </Link>{" "}
                <span className="text-slate-700">{b.data.title}</span>
                {!b.data.explicitDataCenter && <span className="ml-1 text-[10px] text-slate-400">(indirect)</span>}
              </td>
              <td className="px-2 py-1.5"><BillStatus status={b.data.status} /></td>
              <td className="px-2 py-1.5 text-slate-600">
                <span className="tabular-nums">{b.data.latestAction.date}</span> {b.data.latestAction.text}
              </td>
              <td className="px-2 py-1.5"><Impact impact={b.data.impact} /></td>
              <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                {b.data.verifiedAt} <ConfidenceBadge level={b.data.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dockets

export function DocketList({ dockets }: { dockets: Row<Docket>[] }) {
  if (!dockets.length) return <Empty title="No proceedings on record">No data-center proceeding has been researched for this regulator yet.</Empty>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {dockets.map(({ id, data: d, sources }) => (
        <li key={id} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">{d.state === "US" ? "FERC / RTO" : d.state}</span>
            {d.docketNumber && <span className="font-mono">{d.docketNumber}</span>}
            {d.utility && <span>· {d.utility}</span>}
            <Pill>{humanize(d.type)}</Pill>
            <Pill tone={d.status === "final_order" ? "green" : d.status === "open" ? "amber" : d.status === "appealed" ? "red" : "slate"}>{humanize(d.status)}</Pill>
            {d.latestAction && <span className="tabular-nums">{d.latestAction.date}</span>}
          </div>
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-sm font-semibold text-slate-900 underline decoration-slate-300">
            {d.title}
          </a>
          <p className="text-[13px] text-slate-700">{d.summary}</p>
          {d.latestAction && <p className="text-xs text-slate-600"><span className="font-medium">Latest:</span> {d.latestAction.text}</p>}
          <p className="mt-0.5 text-xs text-slate-600">
            <Evidence type="analysis" /> {d.significance}
          </p>
          <Provenance sources={sources} verifiedAt={d.verifiedAt} confidence={d.confidence} caveats={d.caveats} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Commission

export function CommissionCard({ c, sources }: { c: Commission; sources: Row<Commission>["sources"] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline decoration-slate-300">
          {c.name}
        </a>
        <Pill tone={c.selection === "elected" ? "amber" : "blue"}>{humanize(c.selection)}</Pill>
      </div>
      <div className="mt-2">
        <KV
          items={[
            ["Selection", c.selectionDetail],
            ["Seats / term", `${c.seats} seats${c.termYears ? ` · ${c.termYears}-year terms` : ""}`],
            ["On 2026 ballot", c.seatsUp2026 ? <span className="font-semibold text-amber-800">{c.seatsUp2026} seat(s)</span> : "None"],
            ["Large-load tariff", humanize(c.largeLoadTariff)],
          ]}
        />
      </div>
      {c.commissioners.length > 0 ? (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {c.commissioners.map((m) => (
              <tr key={m.name} className="border-t border-slate-100">
                <td className="py-1">{m.name} <Party party={m.party} /></td>
                <td className="py-1 text-slate-500">{m.role}</td>
                <td className="py-1 text-right text-slate-500">{m.termEnds ? `term ends ${m.termEnds}` : <Missing>term n/a</Missing>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs"><Missing>Roster not verified</Missing></p>
      )}
      <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">
        <span className="font-semibold">How 2026 reaches this commission:</span> {c.electionMechanism}
      </div>
      <Provenance sources={sources} verifiedAt={c.verifiedAt} confidence={c.confidence} caveats={c.caveats} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Races

export function RaceSummary({ race, candidates }: { race: Row<Race>; candidates?: Row<CandidateData>[] }) {
  const r = race.data;
  const cands = candidates?.map((c) => c.data) ?? r.candidates;
  const nominees = cands.filter((c) => c.status === "nominee" || c.status === "runoff");
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/elections/${r.id}`} className="text-sm font-semibold underline decoration-slate-300">
          {race.title}
        </Link>
        <div className="flex gap-1">
          {r.ratings.slice(0, 2).map((x) => (
            <a key={x.rater} href={x.url} target="_blank" rel="noopener noreferrer" title={`${x.rater}, ${x.date}`}>
              <Pill tone={x.rating.includes("D") ? "blue" : x.rating.includes("R") ? "red" : "violet"}>{x.rating}</Pill>
            </a>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {r.electionDate}
        {r.incumbent ? <> · Incumbent {r.incumbent.name} ({r.incumbent.party}){r.incumbent.running ? "" : ", not running"}</> : " · Open seat"}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {nominees.map((c) => (
          <li key={c.name}>
            <Party party={c.party} /> <span className="font-medium">{c.name}</span>
            {c.incumbent && <span className="text-slate-400"> (inc.)</span>}
            {c.positions.some((p) => p.explicitDataCenter) && <Pill tone="amber">talks data centers</Pill>}
          </li>
        ))}
        {nominees.length === 0 && <li><Missing>Nominees not recorded</Missing></li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local actions

export function LocalActionTable({ actions, showState = false }: { actions: Row<LocalAction>[]; showState?: boolean }) {
  if (!actions.length) return <Empty title="No local actions recorded">This is a curated sample. An empty result means not yet researched, not that no rules exist.</Empty>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            {showState && <th className="px-2 py-1.5 font-medium">St.</th>}
            <th className="px-2 py-1.5 font-medium">Jurisdiction</th>
            <th className="px-2 py-1.5 font-medium">Action</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            <th className="px-2 py-1.5 font-medium">Dates</th>
            <th className="px-2 py-1.5 font-medium">Summary & sources</th>
          </tr>
        </thead>
        <tbody>
          {actions.map(({ id, data: a, sources }) => (
            <tr key={id} className="border-t border-slate-100 align-top hover:bg-slate-50">
              {showState && <td className="px-2 py-1.5 font-semibold"><Link href={`/states/${a.state}`}>{a.state}</Link></td>}
              <td className="px-2 py-1.5">
                <Link href={`/counties/${a.countyFips}`} className="font-medium underline decoration-slate-300">{a.jurisdiction}</Link>
                <div className="text-slate-500">{a.authority}</div>
              </td>
              <td className="px-2 py-1.5">{humanize(a.kind)}</td>
              <td className="px-2 py-1.5">
                <Pill tone={a.status === "in_effect" ? "red" : a.status === "expired" ? "slate" : a.status === "proposed" || a.status === "pending" ? "amber" : "slate"}>
                  {humanize(a.status)}
                </Pill>
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-slate-600">
                {a.adopted ?? "—"}
                {a.expires && <div>→ {a.expires}</div>}
              </td>
              <td className="max-w-lg px-2 py-1.5 text-slate-700">
                {a.summary}
                <div className="mt-0.5 flex items-center gap-2">
                  <Sources compact sources={sources} max={3} /> <ConfidenceBadge level={a.confidence} />
                </div>
                {a.caveats && <div className="text-[11px] text-amber-800">{a.caveats}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policy dimensions

export function DimensionTable({ policy }: { policy: StatePolicy }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">Dimension</th>
            <th className="px-2 py-1.5 font-medium">Score</th>
            <th className="px-2 py-1.5 font-medium">Rationale <Evidence type="analysis" /></th>
            <th className="px-2 py-1.5 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {DIMENSION_KEYS.map((k) => {
            const d = policy.dimensions[k];
            return (
              <tr key={k} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1.5 font-medium" title={DIMENSION_META[k].description}>{DIMENSION_META[k].label}</td>
                <td className="px-2 py-1.5"><ScoreChip score={d?.score ?? null} /></td>
                <td className="max-w-xl px-2 py-1.5 text-slate-700">
                  {d?.rationale ?? <Missing />}
                  {d?.indicators?.length ? <div className="mt-0.5 text-slate-500">Indicators: {d.indicators.join("; ")}</div> : null}
                </td>
                <td className="px-2 py-1.5">
                  {d?.sources?.length ? <Sources compact sources={d.sources} max={3} /> : <Missing>none</Missing>}
                  <div><ConfidenceBadge level={d?.confidence} /></div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ScoreChip({ score }: { score: number | null }) {
  if (score === null) return <span className="rounded bg-slate-100 px-1.5 py-px text-[11px] text-slate-400">n/a</span>;
  const cls = score >= 2 ? "bg-blue-700 text-white" : score === 1 ? "bg-blue-200 text-blue-900" : score === 0 ? "bg-slate-200 text-slate-800" : score === -1 ? "bg-rose-200 text-rose-900" : "bg-rose-700 text-white";
  return <span className={`rounded px-1.5 py-px text-[11px] font-semibold tabular-nums ${cls}`}>{score > 0 ? `+${score}` : score}</span>;
}
