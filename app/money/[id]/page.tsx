import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryBadge, LeanBar, titleCase } from "@/components/money";
import { Party, money } from "@/components/ui";
import { getSpender } from "@/lib/repo";
import { stateName } from "@/lib/states";

export async function generateMetadata({ params }: PageProps<"/money/[id]">) {
  const s = getSpender((await params).id);
  return { title: s ? titleCase(s.data.name) : "Spender" };
}

export default async function SpenderPage({ params }: PageProps<"/money/[id]">) {
  await connection();
  const { id } = await params;
  const row = getSpender(id);
  if (!row) notFound();
  const s = row.data;
  const o = s.outside;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/money" className="text-sm text-slate-500 hover:text-slate-800">← Money & influence</Link>
      <header className="mt-3 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{titleCase(s.name)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <CategoryBadge category={s.category} group={s.group} />
          {s.connectedOrg && <span>Sponsored by {titleCase(s.connectedOrg)}</span>}
          <a href={`https://www.fec.gov/data/committee/${s.committeeId}/`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">FEC {s.committeeId} →</a>
        </div>
      </header>

      <section className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label="Outside spending (2026)" value={o ? money(o.total) : "—"} note={o?.lastDate ? `through ${o.lastDate}` : undefined} />
        <Fact label="Given to candidates" value={money(s.pacGiving)} />
        <Fact label="Raised" value={s.summary ? money(s.summary.receipts) : "—"} note={s.summary?.through ? `as of ${s.summary.through}` : undefined} />
        <Fact label="Cash on hand" value={s.summary ? money(s.summary.cash) : "—"} note={s.summary?.through ? `as of ${s.summary.through}` : undefined} />
      </section>

      {o && (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-bold">Who it&apos;s helping</h2>
            <LeanBar proD={o.proD} proR={o.proR} primary={o.primary} />
            <p className="mt-2 text-sm text-slate-600">
              {money(o.support)} supporting candidates · {money(o.oppose)} opposing candidates{o.primary > 0 ? ` · ${money(o.primary)} in primaries` : ""} · {o.filings} reports
            </p>
          </section>

          <div className="grid gap-8 md:grid-cols-2">
            <section>
              <h2 className="mb-3 text-xl font-bold">Top races</h2>
              <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {o.topTargets.map((t) => (
                  <li key={t.cand} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      <Party party={t.party} /> <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-slate-500">{t.state}{t.office === "H" ? `-${t.district}` : " Senate"} · {t.oppose > t.support ? "opposing" : "supporting"}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{money(t.total)}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h2 className="mb-3 text-xl font-bold">By state</h2>
              <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {o.byState.slice(0, 15).map((x) => (
                  <li key={x.state} className="flex items-center justify-between px-3 py-2 text-sm">
                    <Link href={`/states/${x.state}#money`} className="font-medium hover:underline">{x.state === "US" ? "Unspecified" : stateName(x.state)}</Link>
                    <span className="font-semibold tabular-nums">{money(x.amount)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
      <p className="mt-8 text-xs text-slate-500">Source: FEC filings (24/48-hour independent-expenditure reports, PAC contributions and periodic summaries).</p>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  );
}
