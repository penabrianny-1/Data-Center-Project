import { connection } from "next/server";
import Link from "next/link";
import NationalMap from "@/components/NationalMap";
import NewsTabs from "@/components/NewsTabs";
import { Empty, Severity } from "@/components/ui";
import { getStateShapes } from "@/lib/data";
import { buildMapData } from "@/lib/layers";
import { dbStatus, getAdapters, getCommissions, getDevelopments, getLocalActions, getNews, getRaces, getStateGovernments } from "@/lib/repo";
import { STATES } from "@/lib/states";
import { today } from "@/lib/time";

const ELECTION_DAY = "2026-11-03";

export default async function Home() {
  await connection();
  if (!dbStatus().ready) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Empty title="Database not built yet">
          Run <code className="rounded bg-slate-900 px-1.5 py-0.5 text-white">npm run ingest</code> once, then reload.
        </Empty>
      </div>
    );
  }

  const { shapes, borders } = await getStateShapes();
  const { layers, summaries } = buildMapData();
  const fipsToCode = Object.fromEntries(STATES.map((s) => [s.fips, s.code]));
  const lastRefresh = getAdapters().map((a) => a.last_success).filter(Boolean).sort().at(-1);

  const devs = getDevelopments();
  const statewide = devs.filter((d) => d.data.level === "state" && d.data.topics.includes("moratorium") && ["enacted", "in_effect"].includes(d.data.status));
  const localBans = getLocalActions().filter((l) => l.data.status === "in_effect" && ["moratorium", "ban"].includes(l.data.kind)).length;
  const govRaces = getStateGovernments().filter((g) => g.data.governor.up2026).length;
  const pucSeats = getCommissions().reduce((n, c) => n + c.data.seatsUp2026, 0);
  const daysLeft = Math.ceil((Date.parse(ELECTION_DAY) - Date.parse(today())) / 86_400_000);
  const competitive = getRaces().filter((r) => /Toss-up|Lean|Tilt/.test(r.data.ratings[0]?.rating ?? "")).length;
  const news = getNews().filter((n) => !n.international).slice(0, 60);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">U.S. Data Center Tracker</h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-slate-600">
          Where states and towns are restricting or welcoming data centers, and the 2026 elections that could change it.
        </p>
        {lastRefresh && <p className="mt-2 text-sm text-slate-400">Updated {relative(lastRefresh)}</p>}
      </section>

      <section className="mb-10">
        <NationalMap shapes={shapes} borders={borders} layers={layers} summaries={summaries} fipsToCode={fipsToCode} />
      </section>

      <section className="mb-12 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={statewide.length} label="Statewide pauses in effect" href="/developments" tone="red" />
        <Stat value={localBans} label="Local bans & moratoriums" href="/local" tone="red" />
        <Stat value={govRaces} label="Governor races Nov 3" href="/elections" note={daysLeft > 0 ? `${daysLeft} days away · ${competitive} competitive races` : undefined} />
        <Stat value={pucSeats} label="Utility regulator seats on ballot" href="/utilities" />
      </section>

      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              Latest news
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
              </span>
            </h2>
            <Link href="/news" className="text-sm font-medium text-slate-600 hover:text-slate-900">All news →</Link>
          </div>
          <NewsTabs items={news} limit={10} />
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-bold">Biggest developments</h2>
            <Link href="/developments" className="text-sm font-medium text-slate-600 hover:text-slate-900">All →</Link>
          </div>
          <ol className="space-y-3">
            {devs.slice(0, 7).map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Severity level={d.data.severity} />
                  <span>{d.data.date}</span>
                  <span className="font-semibold text-slate-700">{d.data.jurisdiction}</span>
                </div>
                <p className="mt-1 text-sm font-semibold leading-snug text-slate-900">{d.data.title}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Stat({ value, label, href, note, tone }: { value: number; label: string; href: string; note?: string; tone?: "red" }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:shadow-sm">
      <div className={`text-3xl font-bold tabular-nums ${tone === "red" ? "text-[#c43c3a]" : "text-slate-900"}`}>{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
      {note && <div className="mt-0.5 text-xs text-slate-400">{note}</div>}
    </Link>
  );
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}
