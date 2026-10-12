import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import CountyMap from "@/components/CountyMap";
import DiscoveredBills from "@/components/DiscoveredBills";
import StateRaceMoney from "@/components/StateRaceMoney";
import NewsTabs from "@/components/NewsTabs";
import { CommissionCard, DimensionTable, DocketList, RaceSummary } from "@/components/records";
import { Party, Provenance, Severity, humanize, money } from "@/components/ui";
import { CategoryBadge, LeanBar, titleCase } from "@/components/money";
import type { CmteRef } from "@/lib/repo";
import WatchButton from "@/components/WatchButton";
import { getCountyShapes } from "@/lib/data";
import { countyActionIndex } from "@/lib/local";
import {
  getBills, getCandidatesForRace, getCommission, getCountiesInState, getDevelopmentsForState, getDiscoveredBills, getDockets,
  getLobbyClients, getLocalActions, getNews, getPolicy, getRaces, getState, getStateGovernment, getStateMoney, getStateDonors, getStateCandMoneyList,
} from "@/lib/repo";
import type { Dimension } from "@/lib/schema";
import { composite, PRESETS, band } from "@/lib/scoring";
import { STATES, STATE_BY_CODE } from "@/lib/states";

export function generateStaticParams() {
  return STATES.map((s) => ({ code: s.code }));
}

export async function generateMetadata({ params }: PageProps<"/states/[code]">) {
  const { code } = await params;
  return { title: STATE_BY_CODE.get(code.toUpperCase())?.name ?? code };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ban: { label: "Statewide ban / pause", cls: "bg-[#8f1d1d] text-white" },
  local: { label: "Local bans", cls: "bg-[#c43c3a] text-white" },
  advancing: { label: "Restrictions advancing", cls: "bg-[#e2706a] text-white" },
  discussion: { label: "Under discussion", cls: "bg-[#eea197] text-slate-900" },
  none: { label: "No action", cls: "bg-slate-200 text-slate-800" },
  favorable: { label: "Favorable / incentives", cls: "bg-[#2a78d6] text-white" },
};

const LOCAL_STATUS: Record<string, string> = {
  in_effect: "bg-rose-100 text-rose-800",
  proposed: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  denied: "bg-slate-200 text-slate-700",
  expired: "bg-slate-100 text-slate-500",
};

export default async function StatePage({ params }: PageProps<"/states/[code]">) {
  await connection();
  const code = (await params).code.toUpperCase();
  const meta = STATE_BY_CODE.get(code);
  if (!meta) notFound();

  const state = getState(code);
  const gov = getStateGovernment(code);
  const policy = getPolicy(code);
  const commission = getCommission(code);
  const bills = getBills(code);
  const discovered = getDiscoveredBills(code);
  const locals = getLocalActions(code).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const races = getRaces(code);
  const devs = getDevelopmentsForState(code);
  const dockets = getDockets(code);
  const news = getNews().filter((n) => n.data.states.includes(code));
  const counties = getCountiesInState(code);
  const stateMoney = getStateMoney(code);
  const lobbyClients = getLobbyClients(8, code);
  const stateDonors = getStateDonors(code);
  const { shapes, borders, viewBox } = await getCountyShapes(meta.fips);

  const restriction = state?.data.restriction;
  const status = STATUS[restriction?.status ?? ""] ?? null;
  const score = policy ? composite(policy.data.dimensions as Record<Dimension, { score: number | null; confidence: "high" | "medium" | "low" }>, PRESETS[0].weights) : null;
  const activeBans = locals.filter((l) => l.data.status === "in_effect" && ["ban", "moratorium"].includes(l.data.kind)).length;
  const countiesHit = new Set(locals.map((l) => l.data.countyFips)).size;
  const lastUpdated = [state?.verifiedAt, gov?.verifiedAt, policy?.verifiedAt, news[0]?.date].filter(Boolean).sort().at(-1);
  const g = gov?.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← Back to map</Link>

      <header className="mt-3 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{meta.name}</h1>
          <WatchButton id={`state:${code}`} label={meta.name} href={`/states/${code}`} kind="state" />
        </div>
        {status && <span className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-semibold ${status.cls}`}>{status.label}</span>}
        {restriction?.summary && <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-slate-700">{restriction.summary}</p>}
        {lastUpdated && <p className="mt-2 text-xs text-slate-400">Last updated {lastUpdated}</p>}
      </header>

      <section className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label="Governor" value={g ? <>{g.governor.name} <Party party={g.governor.party} /></> : "—"} note={g?.governor.up2026 ? "Seat on Nov 3 ballot" : undefined} />
        <Fact label="Legislature" value={g ? (g.trifecta === "divided" ? "Divided control" : `${g.trifecta === "D" ? "Democratic" : "Republican"} control`) : "—"} />
        <Fact label="2026 races" value={races.length ? races.map((r) => r.data.office.replace("U.S. ", "")).join(", ") : "None statewide"} />
        <Fact
          label="Utility regulator"
          value={commission ? humanize(commission.data.selection) : "—"}
          note={commission?.data.seatsUp2026 ? `${commission.data.seatsUp2026} seat(s) on ballot` : score?.value != null ? `Policy score ${score.value}/100 · ${band(score.value).label}` : undefined}
        />
      </section>

      <Block title={<span className="flex items-center gap-2">News <LiveDot /></span>} aside={<Link href={`/news?state=${code}`} className="text-sm text-slate-500 hover:text-slate-800">All {news.length} →</Link>}>
        <NewsTabs items={news} limit={8} />
      </Block>

      <Block title="Legislation" aside={<Link href={`/legislation?jurisdiction=${code}`} className="text-sm text-slate-500 hover:text-slate-800">Bill tracker →</Link>}>
        {bills.length ? (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-3">Bill</th><th className="py-2 pr-3">Title</th><th className="py-2">Status</th></tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 align-top">
                  <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">
                    <Link href={`/legislation/${b.data.id}`} className="text-blue-700 hover:underline">{b.data.number}</Link>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-700">{b.data.title}</td>
                  <td className="py-2.5 whitespace-nowrap text-slate-600">{humanize(b.data.status)} <span className="text-xs text-slate-400">{b.data.latestAction.date}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">No data-center bills on record yet.</p>
        )}
        {discovered.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-600">+ {discovered.length} more bills found automatically</summary>
            <div className="mt-2"><DiscoveredBills bills={discovered} showState={false} /></div>
          </details>
        )}
      </Block>

      <Block title="Local actions">
        <p className="mb-4 text-sm text-slate-600">
          <span className="text-2xl font-bold text-slate-900">{activeBans}</span> active bans or moratoriums ·{" "}
          {countiesHit} of {counties.length} counties ({counties.length ? Math.round((countiesHit / counties.length) * 100) : 0}%) with a recorded action
        </p>
        <div className="grid gap-6 md:grid-cols-[minmax(0,380px)_1fr]">
          <CountyMap shapes={shapes} borders={borders} viewBox={viewBox} actions={countyActionIndex(locals.map((l) => l.data))} />
          {locals.length ? (
            <ul className="space-y-3">
              {locals.map(({ id, data: a, sources }) => (
                <li key={id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/counties/${a.countyFips}`} className="font-semibold text-slate-900 hover:underline">{a.jurisdiction}</Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LOCAL_STATUS[a.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {humanize(a.status)} {a.kind.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{a.summary}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    {a.adopted && <span>{a.adopted}{a.expires && ` → ${a.expires}`}</span>}
                    {sources[0] && <a href={sources[0].url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">View source →</a>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No local actions recorded yet. Local coverage is a sample, so this doesn&apos;t mean none exist.</p>
          )}
        </div>
      </Block>

      <Block title="Money & influence" aside={<Link href="/money" className="text-sm text-slate-500 hover:text-slate-800">All money →</Link>}>
        <div id="money" className="-mt-16 pt-16" />
        {stateMoney ? (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-6">
              <div>
                <div className="text-2xl font-bold tabular-nums">{money(stateMoney.data.total)}</div>
                <div className="text-sm text-slate-600">outside spending in {meta.name}&apos;s federal races</div>
              </div>
              <LeanBar proD={stateMoney.data.proD} proR={stateMoney.data.proR} primary={stateMoney.data.primary} />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <MoneyList title="Biggest outside spenders" rows={stateMoney.data.topSpenders.slice(0, 8)} />
              <MoneyList title="Top PACs giving to candidates" rows={stateMoney.data.topPacContributors.slice(0, 8)} />
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">No federal outside spending reported in this state yet.</p>
        )}
        {lobbyClients.length > 0 && (
          <p className="mt-4 text-sm text-slate-600">
            <strong>{meta.name}-based groups lobbying Congress on data centers:</strong>{" "}
            {lobbyClients.map((c, i) => <span key={c.id}>{i > 0 && ", "}{titleCase(c.data.name)}</span>)}
          </p>
        )}
        {stateDonors ? (
          <div className="mt-8">
            <h3 className="mb-3 text-lg font-bold">State races (governor, statewide offices, legislature)</h3>
            <StateRaceMoney donors={stateDonors} candidates={getStateCandMoneyList(code)} agency={code === "TX" ? "Texas Ethics Commission" : "State campaign finance agency"} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">Federal races only. State-race money (governor, legislature) for {meta.name} is filed with the state and isn&apos;t integrated yet.</p>
        )}
      </Block>

      <h2 className="mb-3 text-lg font-bold">More detail</h2>
      <div className="space-y-2">
        <Fold title="2026 elections" count={races.length}>
          <div className="grid gap-3 md:grid-cols-2">{races.map((r) => <RaceSummary key={r.id} race={r} candidates={getCandidatesForRace(r.id)} />)}</div>
        </Fold>
        <Fold title="Who holds power">
          {g ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p><strong>Governor:</strong> {g.governor.name} ({g.governor.party}){g.governor.termEnds && `, term ends ${g.governor.termEnds}`}</p>
              {g.upper && <p><strong>{g.upper.name}:</strong> {g.upper.seats.D} D · {g.upper.seats.R} R ({humanize(g.upper.control)} control)</p>}
              {g.lower && <p><strong>{g.lower.name}:</strong> {g.lower.seats.D} D · {g.lower.seats.R} R ({humanize(g.lower.control)} control)</p>}
              <p><strong>Governor&apos;s powers:</strong> {g.executivePowers}</p>
              <Provenance sources={gov!.sources} verifiedAt={g.verifiedAt} confidence={g.confidence} caveats={g.caveats} />
            </div>
          ) : <p className="text-sm text-slate-500">Not researched.</p>}
        </Fold>
        <Fold title="Utility regulator & proceedings" count={dockets.length}>
          <div className="space-y-3">
            {commission && <CommissionCard c={commission.data} sources={commission.sources} />}
            <DocketList dockets={dockets} />
          </div>
        </Fold>
        <Fold title="Policy framework & score">
          {policy ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700"><strong>Local authority:</strong> {policy.data.preemption.summary}</p>
              <p className="text-sm text-slate-700"><strong>Water:</strong> {policy.data.water.summary}</p>
              <p className="text-sm text-slate-700"><strong>Power:</strong> {policy.data.electricity.market}. {policy.data.electricity.summary}</p>
              <DimensionTable policy={policy.data} />
              <Provenance sources={policy.sources} verifiedAt={policy.verifiedAt} confidence={policy.confidence} caveats={policy.data.caveats} />
            </div>
          ) : <p className="text-sm text-slate-500">Not researched.</p>}
        </Fold>
        <Fold title="Key developments" count={devs.length}>
          <ul className="space-y-2">
            {devs.map((d) => (
              <li key={d.id} className="text-sm">
                <Severity level={d.data.severity} /> <span className="text-slate-500">{d.data.date}</span> · <span className="font-medium">{d.data.title}</span>
                <p className="text-slate-600">{d.data.whatHappened}</p>
              </li>
            ))}
          </ul>
        </Fold>
        {restriction && state && (
          <Fold title="Sources for this summary">
            <Provenance sources={state.sources} verifiedAt={state.verifiedAt} confidence={state.confidence} />
            {restriction.highlights && <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">{restriction.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
          </Fold>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
      {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

function Block({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline justify-between border-b border-slate-200 pb-2">
        <h2 className="text-xl font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-medium text-slate-800 hover:bg-slate-50">
        <span>{title}{count !== undefined && <span className="ml-2 text-sm font-normal text-slate-400">{count}</span>}</span>
        <span className="text-slate-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">{children}</div>
    </details>
  );
}

function LiveDot() {
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
    </span>
  );
}

function MoneyList({ title, rows }: { title: string; rows: (CmteRef & { amount: number })[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>
              <Link href={`/money/${x.id}`} className="font-medium hover:underline">{titleCase(x.name)}</Link> <CategoryBadge category={x.category} group={x.group} />
            </span>
            <span className="font-semibold tabular-nums">{money(x.amount)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">None reported.</li>}
      </ol>
    </div>
  );
}
