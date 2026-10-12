import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import CountyMap from "@/components/CountyMap";
import DiscoveredBills from "@/components/DiscoveredBills";
import NewsList from "@/components/NewsList";
import { BillTable, CommissionCard, DimensionTable, DocketList, LocalActionTable, RaceSummary } from "@/components/records";
import { ConfidenceBadge, Empty, Evidence, KV, Missing, Page, Panel, Party, Pill, Provenance, Section, Sources, humanize } from "@/components/ui";
import WatchButton from "@/components/WatchButton";
import { getCountyShapes } from "@/lib/data";
import { countyActionIndex } from "@/lib/local";
import {
  getNews, getBills, getDiscoveredBills, getCandidatesForRace, getCommission, getCountiesInState, getDevelopmentsForState, getDockets,
  getLegislators, getLocalActions, getPolicy, getRaces, getState, getStateGovernment, getMemberCommittees,
} from "@/lib/repo";
import type { StateGovernment } from "@/lib/schema";
import { composite, PRESETS, band } from "@/lib/scoring";
import { STATES, STATE_BY_CODE } from "@/lib/states";
import type { Dimension } from "@/lib/schema";

export function generateStaticParams() {
  return STATES.map((s) => ({ code: s.code }));
}

export async function generateMetadata({ params }: PageProps<"/states/[code]">) {
  const { code } = await params;
  return { title: STATE_BY_CODE.get(code.toUpperCase())?.name ?? code };
}

const RESTRICTION_LABEL: Record<string, string> = {
  ban: "Statewide ban / pause", local: "Local bans only", advancing: "Restrictions advancing",
  discussion: "Under discussion", none: "No action found", favorable: "Favorable / incentives",
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
  const dockets = getDockets(code);
  const bills = getBills(code);
  const discovered = getDiscoveredBills(code);
  const locals = getLocalActions(code);
  const races = getRaces(code);
  const devs = getDevelopmentsForState(code);
  const delegation = getLegislators(code);
  const news = getNews().filter((a) => a.data.states.includes(code));
  const counties = getCountiesInState(code);
  const { shapes, borders, viewBox } = await getCountyShapes(meta.fips);
  const countyIndex = countyActionIndex(locals.map((l) => l.data));

  const restriction = state?.data.restriction;
  const score = policy ? composite(policy.data.dimensions as Record<Dimension, { score: number | null; confidence: "high" | "medium" | "low" }>, PRESETS[0].weights) : null;
  const activeBans = locals.filter((l) => l.data.status === "in_effect" && ["ban", "moratorium"].includes(l.data.kind));
  const countiesWithAction = new Set(locals.map((l) => l.data.countyFips)).size;
  const lastUpdated = [state?.verifiedAt, gov?.verifiedAt, policy?.verifiedAt, commission?.verifiedAt, news[0]?.date]
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <Page
      title={meta.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {restriction && <Pill tone={["ban", "local"].includes(restriction.status) ? "red" : restriction.status === "favorable" ? "blue" : "amber"}>{RESTRICTION_LABEL[restriction.status]}</Pill>}
          {gov && <span>Gov. {gov.data.governor.name} <Party party={gov.data.governor.party} /> · {gov.data.trifecta === "divided" ? "divided government" : `${gov.data.trifecta} trifecta`}</span>}
          {score?.value != null && (
            <span>
              · Policy score <strong>{score.value}</strong>/100 ({band(score.value).label}, {Math.round(score.completeness * 100)}% scored) <Evidence type="analysis" />
            </span>
          )}
          <span>· Last updated {lastUpdated ?? "—"}</span>
        </span>
      }
      actions={<WatchButton id={`state:${code}`} label={meta.name} href={`/states/${code}`} kind="state" />}
    >
      <nav className="-mt-2 mb-4 flex flex-wrap gap-3 text-xs text-slate-600">
        {[["overview", "Overview"], ["power", "Who holds power"], ["elections", "2026 elections"], ["legislation", "Legislation"], ["regulator", "Utility regulator"], ["policy", "Policy framework"], ["local", "Local actions"], ["news", "News"]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="underline decoration-slate-300 hover:text-slate-900">{label}</a>
        ))}
        <Link href="/states" className="ml-auto">← All states</Link>
      </nav>

      {/* Overview */}
      <Section id="overview" title="Current status">
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Panel className="p-3">
            {restriction ? (
              <>
                <p className="text-sm leading-relaxed text-slate-800">{restriction.summary}</p>
                {restriction.highlights && restriction.highlights.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
                    {restriction.highlights.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                )}
                <Provenance sources={state!.sources} verifiedAt={state!.verifiedAt} confidence={state!.confidence} />
              </>
            ) : (
              <Missing>No restriction summary researched.</Missing>
            )}
          </Panel>
          <Panel className="p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Priority developments</h3>
            {devs.length ? (
              <ul className="space-y-2 text-xs">
                {devs.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <span className="tabular-nums text-slate-500">{d.data.date}</span> · <span className="font-medium text-slate-900">{d.data.title}</span>
                    <div className="text-slate-500">{d.data.authority} · {humanize(d.data.status)} · severity {d.data.severity}/5</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Missing>No priority developments recorded for this state.</Missing>
            )}
          </Panel>
        </div>
      </Section>

      {/* Power */}
      <Section id="power" title="Who holds power" aside="Officeholders, chambers and executive authority">
        {gov ? <Government g={gov.data} sources={gov.sources} /> : <Empty title="State government composition not researched" />}
        <div className="mt-3">
          <Delegation delegation={delegation} />
        </div>
      </Section>

      {/* Elections */}
      <Section id="elections" title="2026 elections in this state" aside="Election Day: Nov 3, 2026">
        {races.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {races.map((r) => <RaceSummary key={r.id} race={r} candidates={getCandidatesForRace(r.id)} />)}
          </div>
        ) : (
          <Empty title="No statewide federal or gubernatorial race on record for 2026" />
        )}
        {commission && commission.data.seatsUp2026 > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            {commission.data.seatsUp2026} utility commission seat(s) are also on the ballot. See <a href="#regulator" className="underline">Utility regulator</a>.
          </p>
        )}
      </Section>

      {/* Legislation */}
      <Section id="legislation" title="Legislation" aside={<Link href={`/legislation?jurisdiction=${code}`} className="underline">Open in bill tracker →</Link>}>
        <BillTable bills={bills} showJurisdiction={false} />
        {discovered.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Also discovered automatically ({discovered.length})</h3>
            <DiscoveredBills bills={discovered} showState={false} />
          </div>
        )}
      </Section>

      {/* Regulator */}
      <Section id="regulator" title="Utility regulator & proceedings">
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          {commission ? <CommissionCard c={commission.data} sources={commission.sources} /> : <Empty title="Commission not researched" />}
          <DocketList dockets={dockets} />
        </div>
      </Section>

      {/* Policy */}
      <Section id="policy" title="Policy framework" aside={<Link href="/compare" className="underline">Compare states & change weights →</Link>}>
        {policy ? (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel className="p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tax incentives</h3>
                {policy.data.incentives.length ? (
                  <ul className="space-y-1.5 text-xs">
                    {policy.data.incentives.map((i) => (
                      <li key={i.name}>
                        <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-slate-300">{i.name}</a>{" "}
                        <Pill tone={i.status === "enacted" ? "green" : i.status === "proposed" ? "amber" : "red"}>{humanize(i.status)}</Pill>
                        {i.citation && <span className="text-slate-500"> · {i.citation}</span>}
                        {i.sunset && <span className="text-slate-500"> · sunset {i.sunset}</span>}
                        <div className="text-slate-600">{i.summary}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Missing>No data-center incentive found</Missing>
                )}
              </Panel>
              <Panel className="p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Local authority & preemption</h3>
                <p className="text-xs text-slate-700">{policy.data.preemption.summary}</p>
                {policy.data.preemption.statutes.map((s) => (
                  <p key={s.citation} className="mt-1 text-xs">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-slate-300">{s.citation}</a>: {s.summary}
                  </p>
                ))}
                {policy.data.preemption.remainingApprovals.length > 0 && (
                  <p className="mt-1 text-xs text-slate-600"><span className="font-medium">Approvals still required:</span> {policy.data.preemption.remainingApprovals.join("; ")}</p>
                )}
              </Panel>
              <Panel className="p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Water</h3>
                <KV items={[["Doctrine", humanize(policy.data.water.doctrine)], ["Agency", policy.data.water.agency]]} />
                <p className="mt-1 text-xs text-slate-700">{policy.data.water.summary}</p>
                {policy.data.water.recentChanges && <p className="mt-1 text-xs text-amber-800"><span className="font-medium">Recent changes:</span> {policy.data.water.recentChanges}</p>}
                <p className="mt-1 text-[11px] text-slate-500">This describes legal access and permitting, not how scarce water physically is.</p>
              </Panel>
              <Panel className="p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Electricity & environmental review</h3>
                <KV items={[["Market", policy.data.electricity.market], ["State env. review", policy.data.environmentalReview.stateLevelReview ? `Yes${policy.data.environmentalReview.statute ? ` (${policy.data.environmentalReview.statute})` : ""}` : "No general state review"]]} />
                <p className="mt-1 text-xs text-slate-700">{policy.data.electricity.summary}</p>
                <p className="mt-1 text-xs text-slate-700">{policy.data.environmentalReview.summary}</p>
              </Panel>
            </div>
            <DimensionTable policy={policy.data} />
            <Provenance sources={policy.sources} verifiedAt={policy.verifiedAt} confidence={policy.confidence} caveats={policy.data.caveats} />
          </div>
        ) : (
          <Empty title="Policy framework not researched" />
        )}
      </Section>

      {/* Local */}
      <Section
        id="local"
        title="Local actions"
        aside={`${activeBans.length} active bans/moratoriums · ${countiesWithAction} of ${counties.length} counties with a recorded action (${counties.length ? Math.round((countiesWithAction / counties.length) * 100) : 0}%)`}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,440px)_1fr]">
          <Panel className="p-3">
            <CountyMap shapes={shapes} borders={borders} viewBox={viewBox} actions={countyIndex} />
            <p className="mt-1 text-[11px] text-slate-500">Click a county for its profile. Local coverage is a curated sample.</p>
          </Panel>
          <LocalActionTable actions={locals} />
        </div>
      </Section>

      {/* News */}
      <Section
        id="news"
        title={<span className="flex items-center gap-2">Related news <LiveDot /></span>}
        aside={<Link href={`/news?state=${code}`} className="underline">All {news.length} →</Link>}
      >
        <NewsList items={news.slice(0, 12)} />
      </Section>
    </Page>
  );
}

function LiveDot() {
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold normal-case text-emerald-700">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Auto-updating
    </span>
  );
}

function Government({ g, sources }: { g: StateGovernment; sources: Parameters<typeof Provenance>[0]["sources"] }) {
  const chamber = (c: StateGovernment["upper"]) =>
    c && (
      <Panel className="p-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">{c.name}</h3>
          <Pill tone={c.control === "D" ? "blue" : c.control === "R" ? "red" : "slate"}>{humanize(c.control)} control</Pill>
        </div>
        <SeatBar seats={c.seats} total={c.total} />
        <p className="mt-1 text-xs text-slate-600">
          {c.seats.D} D · {c.seats.R} R{c.seats.other ? ` · ${c.seats.other} other` : ""}{c.seats.vacant ? ` · ${c.seats.vacant} vacant` : ""} of {c.total}
          {c.seatsUp2026 !== undefined && ` · ${c.seatsUp2026} seats up in 2026`}
        </p>
        {c.leaders.length > 0 && (
          <ul className="mt-1 text-xs text-slate-700">
            {c.leaders.map((l) => <li key={l.role + l.name}>{l.role}: {l.name} <Party party={l.party} /></li>)}
          </ul>
        )}
      </Panel>
    );
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel className="p-3">
        <h3 className="text-sm font-semibold">Governor</h3>
        <p className="mt-1 text-sm">{g.governor.name} <Party party={g.governor.party} /></p>
        <KV
          items={[
            ["Term ends", g.governor.termEnds ?? null],
            ["On 2026 ballot", g.governor.up2026 ? (g.governor.runningIn2026 === false || g.governor.termLimited ? "Yes (open seat)" : "Yes") : "No"],
            ["Lt. governor", g.lieutenantGovernor ? `${g.lieutenantGovernor.name} (${g.lieutenantGovernor.party})` : null],
            ["Veto override", g.vetoOverride ?? null],
          ]}
        />
        <p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Powers over data-center policy:</span> {g.executivePowers}</p>
      </Panel>
      {chamber(g.upper)}
      {chamber(g.lower) ?? (
        <Panel className="p-3 text-xs text-slate-500">{g.state === "NE" ? "Nebraska has a single-chamber, officially nonpartisan legislature." : "No second chamber."}</Panel>
      )}
      <div className="lg:col-span-3">
        <Provenance sources={sources} verifiedAt={g.verifiedAt} confidence={g.confidence} caveats={g.caveats} />
      </div>
    </div>
  );
}

function SeatBar({ seats, total }: { seats: { D: number; R: number; other: number; vacant: number }; total: number }) {
  const seg = (n: number, color: string, label: string) =>
    n > 0 && <div title={`${label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: color }} className="h-full" />;
  return (
    <div className="mt-2 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-sm bg-slate-100" role="img" aria-label={`${seats.D} Democrats, ${seats.R} Republicans of ${total}`}>
      {seg(seats.D, "#2a78d6", "Democrats")}
      {seg(seats.other, "#b5b3ab", "Other")}
      {seg(seats.vacant, "#e1e0d9", "Vacant")}
      {seg(seats.R, "#e34948", "Republicans")}
    </div>
  );
}

function Delegation({ delegation }: { delegation: ReturnType<typeof getLegislators> }) {
  const sen = delegation.filter((l) => l.data.chamber === "Senate");
  const house = delegation.filter((l) => l.data.chamber === "House").sort((a, b) => (a.data.district ?? 0) - (b.data.district ?? 0));
  const relevant = delegation
    .map((l) => ({ l, cs: getMemberCommittees(l.id).filter((c) => c.committee.status === "relevant" && !c.committee.data.parent) }))
    .filter((x) => x.cs.length);
  return (
    <Panel className="p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Congressional delegation</h3>
        <span className="text-xs text-slate-500">
          {house.filter((h) => h.data.party === "D").length} D · {house.filter((h) => h.data.party === "R").length} R in House
        </span>
      </div>
      <div className="mt-1 grid gap-3 text-xs md:grid-cols-[260px_1fr]">
        <div>
          <div className="text-slate-500">Senators</div>
          {sen.map((s) => (
            <div key={s.id}>
              <Party party={s.data.party} /> {s.title} {s.data.up2026 && <Pill tone="amber">up 2026</Pill>}
            </div>
          ))}
        </div>
        <div>
          <div className="text-slate-500">Members on committees with data-center jurisdiction</div>
          {relevant.length ? (
            <ul>
              {relevant.map(({ l, cs }) => (
                <li key={l.id}>
                  <Party party={l.data.party} /> {l.title}
                  {l.data.chamber === "House" && ` (${l.data.state}-${String(l.data.district ?? 0).padStart(2, "0")})`}:{" "}
                  {cs.map((c, i) => (
                    <span key={c.committee.id}>
                      {i > 0 && ", "}
                      <Link href={`/congress#${c.committee.data.thomasId}`} className="underline decoration-slate-300">
                        {c.committee.title.replace(/^(House|Senate) Committee on /, "")}
                      </Link>
                      {c.title && <strong> ({c.title})</strong>}
                    </span>
                  ))}
                  {l.data.up2026 && <> · <Pill tone="amber">up 2026</Pill></>}
                </li>
              ))}
            </ul>
          ) : (
            <Missing>None</Missing>
          )}
        </div>
      </div>
      <div className="mt-2"><Sources compact sources={sen[0]?.sources ?? []} /> <ConfidenceBadge level="high" /></div>
    </Panel>
  );
}
