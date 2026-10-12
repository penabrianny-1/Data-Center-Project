import { connection } from "next/server";
import Link from "next/link";
import DevelopmentFeed from "@/components/DevelopmentFeed";
import NationalMap from "@/components/NationalMap";
import NewsList from "@/components/NewsList";
import { Empty, Evidence, Freshness, Page, Panel, Party, Pill, Section } from "@/components/ui";
import { getStateShapes } from "@/lib/data";
import { buildMapData } from "@/lib/layers";
import {
  dbStatus, getAdapters, getNews, getCommissions, getDevelopments, getLocalActions, getPolicies, getRaces,
  getStateGovernments,
} from "@/lib/repo";
import type { Race } from "@/lib/schema";
import { STATES } from "@/lib/states";
import { addDays, today } from "@/lib/time";

const ELECTION_DAY = "2026-11-03";

export default async function Overview() {
  await connection();
  const status = dbStatus();
  if (!status.ready) return <NotBuilt />;

  const { shapes, borders } = await getStateShapes();
  const { layers, summaries } = buildMapData();
  const fipsToCode = Object.fromEntries(STATES.map((s) => [s.fips, s.code]));
  const developments = getDevelopments();
  const adapters = getAdapters();
  const lastRefresh = adapters.map((a) => a.last_success).filter(Boolean).sort().at(-1) ?? null;

  return (
    <Page
      title="National overview"
      subtitle={
        <>
          Where U.S. data-center development is getting easier or harder, why, and which elections could change it.{" "}
          <Freshness at={lastRefresh} label="Last refresh" /> ·{" "}
          <Link href="/sources" className="underline decoration-slate-300">
            sources & coverage
          </Link>
        </>
      }
    >
      <Outlook />

      <Section title="Where it's happening" aside="Pick a layer, then click a state">
        <Panel className="p-3">
          <NationalMap shapes={shapes} borders={borders} layers={layers} summaries={summaries} fipsToCode={fipsToCode} />
        </Panel>
      </Section>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_420px]">
        <Section
          title="What's changing: priority developments"
          aside={
            <Link href="/developments" className="underline decoration-slate-300">
              All {developments.length} with filters →
            </Link>
          }
        >
          {developments.length ? (
            <DevelopmentFeed items={developments.map((d) => ({ id: d.id, data: d.data, sources: d.sources }))} compact limit={10} />
          ) : (
            <Empty title="Developments dataset not yet researched" />
          )}
        </Section>

        <div>
          <UpcomingElections />
          <LatestNews />
        </div>
      </div>
    </Page>
  );
}

/** Data-derived national outlook. Counts are facts from the dataset; the framing is labeled analysis. */
function Outlook() {
  const policies = getPolicies();
  const devs = getDevelopments();
  const govs = getStateGovernments();
  const locals = getLocalActions();
  const commissions = getCommissions();

  const statewidePause = devs.filter((d) => d.data.level === "state" && d.data.topics.includes("moratorium") && ["enacted", "in_effect"].includes(d.data.status));
  const incentivePaused = policies.flatMap((p) =>
    p.data.incentives.filter((i) => i.status === "suspended" || i.status === "repealed").map((i) => ({ state: p.state!, name: i.name, status: i.status })),
  );
  const localInEffect = locals.filter((l) => l.data.status === "in_effect" && ["moratorium", "ban"].includes(l.data.kind));
  const expiringSoon = locals
    .filter((l) => l.data.status === "in_effect" && l.data.expires && l.data.expires >= today() && l.data.expires <= addDays(110))
    .sort((a, b) => a.data.expires!.localeCompare(b.data.expires!));
  const govUp = govs.filter((g) => g.data.governor.up2026);
  const openGov = govUp.filter((g) => g.data.governor.runningIn2026 === false || g.data.governor.termLimited);
  const pucSeats = commissions.reduce((n, c) => n + c.data.seatsUp2026, 0);
  const tariffs = commissions.filter((c) => c.data.largeLoadTariff === "approved").length;

  const stat = (value: number | string, label: string, href?: string, note?: string) => (
    <div className="px-3 py-2">
      <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="text-xs text-slate-600">{href ? <Link href={href} className="underline decoration-slate-300">{label}</Link> : label}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );

  return (
    <Section title="National outlook" aside={<><Evidence type="fact" /> counts from sourced records · framing is <Evidence type="analysis" /></>}>
      <Panel className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {stat(statewidePause.length, "statewide pauses in effect", "/developments", statewidePause.map((d) => d.data.states.join("/")).join(", ") || undefined)}
        {stat(incentivePaused.length, "tax incentives suspended/repealed", "/compare", [...new Set(incentivePaused.map((i) => i.state))].join(", ") || undefined)}
        {stat(localInEffect.length, "local moratoriums/bans in effect", "/local", locals.length ? `in a ${locals.length}-record sample` : "dataset pending")}
        {stat(govUp.length, "governorships on the ballot", "/elections", openGov.length ? `${openGov.length} without a running incumbent` : undefined)}
        {stat(pucSeats, "elected regulator seats up", "/utilities", commissions.length < 51 ? `${commissions.length}/51 commissions researched` : undefined)}
        {stat(tariffs, "states w/ approved large-load tariffs", "/utilities")}
      </Panel>
      <div className="mt-2 grid gap-3 text-xs text-slate-600 md:grid-cols-3">
        <p>
          <span className="font-semibold text-slate-800">Tightening.</span> Constraints are moving from local zoning boards up to
          states and utility regulators: statewide permit pauses, incentive suspensions, and large-load tariffs that make
          developers pay for grid upgrades.
        </p>
        <p>
          <span className="font-semibold text-slate-800">Binding constraint.</span> In most top markets the limit is power, not land:
          interconnection queues, capacity prices and cost-allocation rules. Local moratoriums mostly decide where in a state
          projects land.
        </p>
        <p>
          <span className="font-semibold text-slate-800">Election risk.</span> The 2026 races that matter most are governorships in
          states where the governor appoints utility regulators, plus the directly elected commission seats (see{" "}
          <Link href="/scenarios" className="underline">scenarios</Link>).
          {expiringSoon.length > 0 && (
            <>
              {" "}
              {expiringSoon.length} local moratoriums expire within ~3½ months, so expect renewal votes.
            </>
          )}
        </p>
      </div>
    </Section>
  );
}

function UpcomingElections() {
  const races = getRaces();
  const rated = races
    .map((r) => ({ r, rating: r.data.ratings[0]?.rating }))
    .filter((x) => x.rating && /Toss-up|Lean|Tilt/.test(x.rating));
  const days = Math.ceil((Date.parse(ELECTION_DAY) - Date.parse(today())) / 86_400_000);
  return (
    <Section
      title={`2026 elections · Nov 3`}
      aside={
        <Link href="/elections" className="underline decoration-slate-300">
          All races →
        </Link>
      }
    >
      <Panel className="p-3">
        <p className="mb-2 text-xs text-slate-500">
          {days > 0 ? `${days} days to Election Day.` : "Election Day has passed; results are not yet integrated."} Competitive races (Toss-up or Lean in the latest rating on record):
        </p>
        {rated.length ? (
          <table className="w-full text-xs">
            <tbody>
              {rated.slice(0, 14).map(({ r, rating }) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2">
                    <Link href={`/elections/${r.data.id}`} className="font-medium underline decoration-slate-300">
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-1 pr-2">
                    {nominees(r.data).map((c) => (
                      <span key={c.name} className="mr-2 whitespace-nowrap">
                        <Party party={c.party} /> {c.name.split(" ").at(-1)}
                      </span>
                    ))}
                  </td>
                  <td className="py-1 text-right">
                    <Pill tone={rating!.includes("D") ? "blue" : rating!.includes("R") ? "red" : "violet"}>{rating}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No race ratings yet" />
        )}
      </Panel>
    </Section>
  );
}

const nominees = (r: Race) => r.candidates.filter((c) => c.status === "nominee").slice(0, 3);

function LatestNews() {
  // Prefer stories with a policy status signal; fall back to newest U.S. stories.
  const all = getNews().filter((n) => !n.international);
  const signal = all.filter((n) => n.signal !== "none");
  const news = [...signal, ...all.filter((n) => n.signal === "none")].slice(0, 8).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return (
    <Section
      title="Live news"
      aside={
        <Link href="/news" className="underline decoration-slate-300">
          All {all.length} →
        </Link>
      }
    >
      <NewsList items={news} showSummary={false} />
      <p className="mt-1 text-[11px] text-slate-400">National, local, public media and trade outlets · auto-categorized · refreshed hourly</p>
    </Section>
  );
}

function NotBuilt() {
  return (
    <Page title="Database not built yet">
      <Empty title="Run the ingestion pipeline to build data/intel.db">
        <code className="mt-2 block rounded bg-slate-900 px-3 py-2 text-left font-mono text-xs text-white">npm run ingest</code>
      </Empty>
    </Page>
  );
}
