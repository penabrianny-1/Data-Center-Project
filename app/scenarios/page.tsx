import { connection } from "next/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { BillTable } from "@/components/records";
import { ConfidenceBadge, Empty, Evidence, Page, Panel, Party, Pill, Section } from "@/components/ui";
import {
  getBills, getCandidatesForRace, getCommissions, getCommitteeMembers, getCommittees, getLocalActions, getPolicies, getRaces,
  getStateGovernments,
} from "@/lib/repo";
import type { Dimension } from "@/lib/schema";
import { composite, PRESETS } from "@/lib/scoring";
import { stateName } from "@/lib/states";

export const metadata = { title: "Scenarios" };

export default async function ScenariosPage() {
  await connection();
  const races = getRaces();
  const commissions = new Map(getCommissions().map((c) => [c.state!, c]));
  const govs = new Map(getStateGovernments().map((g) => [g.state!, g.data]));
  const policies = getPolicies();
  const locals = getLocalActions();
  const bills = getBills();

  // 1. Governor race → appointment → commission chains
  const govRaces = races.filter((r) => r.data.office === "Governor");
  const chains = govRaces
    .map((r) => {
      const c = commissions.get(r.state!);
      if (!c || c.data.selection !== "appointed") return null;
      const expiring = c.data.commissioners.filter((m) => m.termEnds && m.termEnds >= "2027-01-01" && m.termEnds <= "2028-12-31");
      return { r, c, expiring };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.expiring.length > 0)
    .sort((a, b) => b.expiring.length / b.c.data.seats - a.expiring.length / a.c.data.seats);
  const elected = [...commissions.values()].filter((c) => c.data.seatsUp2026 > 0);

  // 2. Permissive state framework but restrictive local environment
  const localByState = new Map<string, number>();
  for (const l of locals) if (l.data.status === "in_effect" && ["moratorium", "ban"].includes(l.data.kind)) localByState.set(l.state!, (localByState.get(l.state!) ?? 0) + 1);
  const scoreOf = (p: (typeof policies)[number]) =>
    composite(p.data.dimensions as Record<Dimension, { score: number | null; confidence: "high" | "medium" | "low" }>, PRESETS[0].weights);
  const tension = policies
    .map((p) => ({ p, s: scoreOf(p), local: localByState.get(p.state!) ?? 0, gov: govs.get(p.state!) }))
    .filter((x) => (x.s.value ?? 0) >= 50 && x.local >= 2)
    .sort((a, b) => b.local - a.local);

  // 3. Water as a binding constraint
  const water = policies
    .filter((p) => (p.data.dimensions.water?.score ?? 0) <= -1 || /restrict|ban|prohibit|moratori|reporting/i.test(p.data.water.recentChanges ?? ""))
    .sort((a, b) => (a.data.dimensions.water?.score ?? 0) - (b.data.dimensions.water?.score ?? 0));

  // 4. Restrictive bills still alive
  const alive = bills.filter((b) => b.data.impact === "restrictive" && ["passed_committee", "passed_chamber", "passed_legislature", "in_committee", "carried_over"].includes(b.data.status));
  const advanced = alive.filter((b) => ["passed_chamber", "passed_legislature", "passed_committee"].includes(b.data.status));

  // 5. Incentives at risk
  const incentives = policies.flatMap((p) => p.data.incentives.filter((i) => i.status !== "enacted").map((i) => ({ state: p.state!, i })));

  // 6. Governor races where nominees explicitly address data centers
  const explicitRaces = govRaces
    .map((r) => ({ r, cands: getCandidatesForRace(r.id).filter((c) => c.data.status === "nominee" && c.data.positions.some((p) => p.explicitDataCenter)) }))
    .filter((x) => x.cands.length > 0);

  // 7. Senate control → committee gavels
  const senateCommittees = getCommittees(true).filter((c) => !c.data.parent && c.data.chamber === "senate");

  return (
    <Page
      title="Scenarios & cross-jurisdiction analysis"
      subtitle={
        <>
          Each scenario shows the legal or institutional mechanism, the affected jurisdictions (computed from sourced records), and the
          consequences that follow. <Evidence type="scenario" /> These are conditional what-ifs, not forecasts. No probabilities are
          assigned because no documented method supports them.
        </>
      }
    >
      <Scenario
        title="A governor changes → utility commission appointments → large-load tariff and cost-allocation decisions"
        mechanism={["2026 governor's race", "Governor appoints commissioners (usually with Senate confirmation)", "Seats expiring 2027–28 filled by the new governor", "Commission majority decides large-load tariffs, special contracts and IRPs", "Cost and speed of connecting data centers"]}
        confidence="medium"
        note="Commissioners are quasi-judicial and bound by statute and the record, so a new appointee changes outcomes at the margin, not overnight."
      >
        {chains.length ? (
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-1">State</th><th>Race</th><th>Seats turning over</th><th>Tariff status</th></tr></thead>
            <tbody>
              {chains.map(({ r, c, expiring }) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 font-semibold"><Link href={`/states/${r.state}#regulator`}>{r.state}</Link></td>
                  <td><Link href={`/elections/${r.data.id}`} className="underline decoration-slate-300">{r.title}</Link> {r.data.ratings[0] && <Pill>{r.data.ratings[0].rating}</Pill>}</td>
                  <td>{expiring.length} of {c.data.seats}: {expiring.map((m) => `${m.name} (${m.termEnds})`).join(", ")}</td>
                  <td>{c.data.largeLoadTariff.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No appointed commissions with verified 2027–28 term expirations" />}
        <p className="mt-2 text-xs text-slate-600">
          <span className="font-semibold">Direct route:</span> voters elect commissioners in{" "}
          {elected.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/states/${c.state}#regulator`} className="underline">{c.state}</Link> ({c.data.seatsUp2026} of {c.data.seats})</span>)}.
          Where one party holds a narrow majority, as on Georgia&apos;s PSC, these races can flip control of the commission directly.
        </p>
      </Scenario>

      <Scenario
        title="Senate control flips → committee gavels change → which energy, permitting and tax bills get hearings"
        mechanism={["2026 Senate races", "Majority party sets committee ratios and chairs", "Chairs control hearings and markups", "Permitting reform, FERC oversight, energy tax credits", "Federal conditions for data-center power"]}
        confidence="high"
        note="Committee control shapes the agenda. It doesn't decide outcomes: floor votes, the filibuster, the president and agency implementation still apply."
      >
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Committee</th><th>Chair now</th><th>Would likely chair if control flips (ranking member)</th></tr></thead>
          <tbody>
            {senateCommittees.map((c) => {
              const m = getCommitteeMembers(c.data.thomasId);
              const chair = m.find((x) => /chair/i.test(x.title ?? ""));
              const ranking = m.find((x) => /ranking/i.test(x.title ?? ""));
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1"><Link href={`/congress#${c.data.thomasId}`} className="underline decoration-slate-300">{c.title.replace("Senate Committee on ", "")}</Link></td>
                  <td>{chair ? <>{chair.legislator.title} <Party party={chair.legislator.data.party} />{chair.legislator.data.up2026 && <> <Pill tone="amber">up 2026</Pill></>}</> : "—"}</td>
                  <td>{ranking ? <>{ranking.legislator.title} <Party party={ranking.legislator.data.party} />{ranking.legislator.data.up2026 && <> <Pill tone="amber">up 2026</Pill></>}</> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-slate-500">Seniority and conference rules usually, but not always, make the ranking member the next chair.</p>
      </Scenario>

      <Scenario
        title="Permissive state framework, restrictive local environment"
        mechanism={["State incentives and power access look favorable", "Counties and cities keep zoning authority", "Local moratoriums or bans in effect", "Site feasibility decided locally despite the state's posture"]}
        confidence="medium"
        note="Local counts come from a curated sample, so absence elsewhere isn't evidence of no restrictions."
      >
        {tension.length ? (
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-1">State</th><th>Policy score</th><th>Local bans/moratoriums in effect</th><th>Governor</th></tr></thead>
            <tbody>
              {tension.map(({ p, s, local, gov }) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1 font-semibold"><Link href={`/states/${p.state}#local`}>{stateName(p.state!)}</Link></td>
                  <td className="tabular-nums">{s.value} ({Math.round(s.completeness * 100)}% scored)</td>
                  <td className="tabular-nums">{local}</td>
                  <td>{gov ? <>{gov.governor.name} <Party party={gov.governor.party} /></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No state currently meets both conditions in the dataset" />}
      </Scenario>

      <Scenario
        title="Water permitting becomes the binding constraint"
        mechanism={["Withdrawal permits / water rights / basin limits", "Cooling-water demand from large campuses", "New reporting, consumptive-use limits or denials", "Shift to closed-loop / air cooling or relocation"]}
        confidence="medium"
        note="Legal restrictions, physical scarcity, infrastructure limits and political opposition are different things. This list reflects legal and permitting signals only."
      >
        {water.length ? (
          <ul className="space-y-1 text-xs">
            {water.map((p) => (
              <li key={p.id}>
                <Link href={`/states/${p.state}#policy`} className="font-semibold underline decoration-slate-300">{stateName(p.state!)}</Link>{" "}
                (water score {p.data.dimensions.water?.score ?? "n/a"}, {p.data.water.doctrine.replace(/_/g, " ")}): {p.data.water.recentChanges ?? p.data.dimensions.water?.rationale}
              </li>
            ))}
          </ul>
        ) : <Empty title="No state flagged" />}
      </Scenario>

      <Scenario
        title="A pending moratorium or restriction bill passes"
        mechanism={["Bill advances through committee and floor", "Governor signs or a veto is overridden", "New statewide restriction or condition", "Pipeline projects delayed, redesigned or moved across state lines"]}
        confidence="medium"
        note="Restrictive bills that have cleared at least one vote are listed first. Most introduced bills never pass."
      >
        <p className="mb-2 text-xs text-slate-600">{advanced.length} restrictive bills have cleared at least one committee or chamber vote; {alive.length - advanced.length} more are pending in committee or carried over.</p>
        <BillTable bills={[...advanced, ...alive.filter((b) => !advanced.includes(b))].slice(0, 25)} />
      </Scenario>

      <Scenario
        title="A tax exemption expires, is suspended or is repealed"
        mechanism={["Legislature or governor acts on sales/use or property tax exemption", "Higher equipment and construction cost", "Project economics reassessed, especially for hardware-heavy AI builds"]}
        confidence="high"
      >
        {incentives.length ? (
          <ul className="space-y-1 text-xs">
            {incentives.map(({ state, i }) => (
              <li key={state + i.name}>
                <Link href={`/states/${state}#policy`} className="font-semibold">{state}</Link> · <a href={i.url} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300">{i.name}</a>{" "}
                <Pill tone={i.status === "repealed" || i.status === "suspended" ? "red" : "amber"}>{i.status}</Pill> {i.summary}
              </li>
            ))}
          </ul>
        ) : <Empty title="No non-enacted incentive changes recorded" />}
      </Scenario>

      <Section title="Governor races where nominees explicitly address data centers">
        {explicitRaces.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {explicitRaces.map(({ r, cands }) => (
              <Panel key={r.id} className="p-3 text-xs">
                <Link href={`/elections/${r.data.id}`} className="text-sm font-semibold underline decoration-slate-300">{r.title}</Link>{" "}
                {r.data.ratings[0] && <Pill>{r.data.ratings[0].rating}</Pill>}
                <ul className="mt-1 space-y-1">
                  {cands.map((c) => (
                    <li key={c.id}>
                      <Party party={c.data.party} /> <span className="font-medium">{c.data.name}</span>:{" "}
                      {c.data.positions.filter((p) => p.explicitDataCenter).map((p) => p.summary).join(" ")}
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        ) : <Empty title="No explicit positions recorded" />}
      </Section>
    </Page>
  );
}

function Scenario({ title, mechanism, confidence, note, children }: { title: string; mechanism: string[]; confidence: "high" | "medium" | "low"; note?: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <Panel className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
          <Evidence type="scenario" />
          {mechanism.map((m, i) => (
            <span key={m} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-400">→</span>}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{m}</span>
            </span>
          ))}
          <span className="ml-auto">Mechanism confidence: <ConfidenceBadge level={confidence} /></span>
        </div>
        {children}
        {note && <p className="mt-2 text-[11px] text-slate-500">{note}</p>}
      </Panel>
    </Section>
  );
}
