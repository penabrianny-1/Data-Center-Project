import type { Row, StateCandMoneyData, StateDonor, StateDonorsData } from "@/lib/repo";
import { money } from "./ui";

const cleanName = (s: string) => s.replace(/\s*\((Mr|Mrs|Ms|Dr|The Honorable)\.?\)/gi, "").replace(/^(.+?), (.+)$/, "$2 $1");

export function DonorList({ donors, limit = 8 }: { donors: StateDonor[]; limit?: number }) {
  return (
    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {donors.slice(0, limit).map((d) => (
        <li key={`${d.type}-${d.name}-${d.city}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{d.name}</span>
            <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold ${d.type === "ENTITY" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-600"}`}>{d.type === "ENTITY" ? "PAC / organization" : "Individual"}</span>
            {(d.employer || d.occupation) && <span className="block text-[11px] text-slate-500">{[d.employer, d.occupation].filter(Boolean).join(" · ")}{d.city ? ` · ${d.city}` : ""}</span>}
          </span>
          <span className="font-semibold tabular-nums">{money(d.amount)}</span>
        </li>
      ))}
    </ol>
  );
}

/** State-race money (state campaign finance agency data), e.g. Texas Ethics Commission. */
export default function StateRaceMoney({ donors, candidates, agency }: { donors: Row<StateDonorsData>; candidates: Row<StateCandMoneyData>[]; agency: string }) {
  const byOffice = new Map<string, Row<StateCandMoneyData>[]>();
  for (const c of candidates) byOffice.set(c.data.office, [...(byOffice.get(c.data.office) ?? []), c]);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Statewide candidates: money raised since {donors.data.since}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {[...byOffice].map(([office, cands]) => (
            <div key={office} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{office}</div>
              <ul className="space-y-2">
                {cands.slice(0, 4).map((c) => (
                  <li key={c.id}>
                    <details>
                      <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                        <span className="font-medium">{cleanName(c.data.name)}</span>
                        <span className="font-semibold tabular-nums">{money(c.data.total)}</span>
                      </summary>
                      <p className="mt-1 text-xs text-slate-500">
                        {c.data.count.toLocaleString()} itemized contributions · {money(c.data.fromIndividuals)} from individuals · {money(c.data.fromEntities)} from PACs and organizations
                      </p>
                      <div className="mt-2"><DonorList donors={c.data.topDonors} limit={10} /></div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Biggest PAC & organization donors to state candidates</h3>
          <DonorList donors={donors.data.topEntities} limit={10} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Biggest individual donors to state candidates</h3>
          <DonorList donors={donors.data.topIndividuals} limit={10} />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Source: {agency} bulk data. Itemized contributions since {donors.data.since}, to candidates and their supporting committees, with superseded reports excluded and transfers between a candidate&apos;s own committees removed.
      </p>
    </div>
  );
}
