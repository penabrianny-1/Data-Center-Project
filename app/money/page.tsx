import { connection } from "next/server";
import Link from "next/link";
import StateMoneyPicker from "@/components/StateMoneyPicker";
import { AdImpactPosts, EcGroups, GoogleAdvertisers } from "@/components/AdsSection";
import { CategoryBadge, LeanBar, SpenderName, titleCase } from "@/components/money";
import { Empty, Freshness, money } from "@/components/ui";
import { getAdImpactPosts, getAdapter, getAllStateMoney, getEcGroups, getEntity, getGoogleAdvertisers, getGoogleSummary, getLobbyBills, getLobbyClients, getLobbySummary, getTopPacGivers, getTopSpenders } from "@/lib/repo";
import type { Bill } from "@/lib/schema";
import { stateName } from "@/lib/states";

export const metadata = { title: "Money & influence" };

export default async function MoneyPage() {
  await connection();
  const spenders = getTopSpenders(30);
  const pacGivers = getTopPacGivers(15).filter((p) => p.data.pacGiving > 0);
  const states = getAllStateMoney().filter((s) => s.state !== "US");
  const lobbyBills = getLobbyBills(20);
  const lobbyClients = getLobbyClients(15);
  const lobby = getLobbySummary()?.data;
  const fec = getAdapter("fec-money");
  const googleAds = getGoogleAdvertisers(15);
  const google = getGoogleSummary();
  const ecGroups = getEcGroups();
  const adimpact = getAdImpactPosts();
  const lda = getAdapter("lda");
  const totalOutside = states.reduce((n, s) => n + s.data.total, 0);
  const latest = spenders.map((s) => s.data.outside?.lastDate ?? "").sort().at(-1);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Money & influence</h1>
        <p className="mt-2 max-w-3xl text-[15px] text-slate-600">Who is spending to shape the 2026 midterms, and who is lobbying Congress on data centers.</p>
        <p className="mt-1 text-xs text-slate-400">
          FEC filings through {latest ?? "—"} · <Freshness at={fec?.last_success} label="refreshed" /> · Lobbying <Freshness at={lda?.last_success} label="refreshed" />
        </p>
      </header>

      <section className="mb-12 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={money(totalOutside)} label="Outside spending in 2026 federal races" />
        <Stat value={spenders[0] ? money(spenders[0].data.outside!.total) : "—"} label={spenders[0] ? `Biggest spender: ${titleCase(spenders[0].data.name)}` : "Biggest spender"} />
        <Stat value={String(lobby?.clients ?? 0)} label="Companies & groups lobbying Congress on data centers" />
        <Stat value={String(lobby?.filings ?? 0)} label="Federal lobbying filings mentioning data centers (2025–26)" />
      </section>

      {/* Outside spending */}
      <Block title="Biggest outside spenders" note="Super PACs, parties and groups spending independently of campaigns. Totals include the latest 24/48-hour reports.">
        {spenders.length ? (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-2">#</th><th className="py-2 pr-3">Spender</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3 text-right">Spent</th><th className="py-2 pr-3">Helping</th><th className="py-2">Top states</th></tr>
            </thead>
            <tbody>
              {spenders.map((s, i) => (
                <tr key={s.id} className="border-b border-slate-100 align-top">
                  <td className="py-2.5 pr-2 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="py-2.5 pr-3"><SpenderName id={s.data.committeeId} name={s.data.name} connectedOrg={s.data.connectedOrg} /></td>
                  <td className="py-2.5 pr-3"><CategoryBadge category={s.data.category} group={s.data.group} /></td>
                  <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{money(s.data.outside!.total)}</td>
                  <td className="py-2.5 pr-3"><LeanBar proD={s.data.outside!.proD} proR={s.data.outside!.proR} primary={s.data.outside!.primary} /></td>
                  <td className="py-2.5 text-xs text-slate-600">
                    {s.data.outside!.byState.filter((x) => x.state !== "US").slice(0, 4).map((x, j) => (
                      <span key={x.state}>{j > 0 && ", "}<Link href={`/states/${x.state}#money`} className="hover:underline">{x.state}</Link> {money(x.amount)}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No FEC outside-spending data ingested yet" />}
      </Block>

      {/* By state */}
      <Block title="Spending by state" note="Pick a state to see who's spending in its House and Senate races, and which PACs give to its candidates.">
        <StateMoneyPicker
          states={states.map((s) => ({
            code: s.state!, name: stateName(s.state!), total: s.data.total, proD: s.data.proD, proR: s.data.proR, primary: s.data.primary,
            spenders: s.data.topSpenders.slice(0, 10), pacs: s.data.topPacContributors.slice(0, 10),
          }))}
        />
      </Block>

      {/* PAC contributions */}
      <Block title="Top PAC contributors to federal candidates" note="Direct contributions from PACs to candidate campaigns. These are separate from outside spending.">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2 pr-3">PAC</th><th className="py-2 pr-3">Type</th><th className="py-2 text-right">Given to candidates</th></tr>
          </thead>
          <tbody>
            {pacGivers.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="py-2 pr-3"><SpenderName id={p.data.committeeId} name={p.data.name} connectedOrg={p.data.connectedOrg} /></td>
                <td className="py-2 pr-3"><CategoryBadge category={p.data.category} group={p.data.group} /></td>
                <td className="py-2 text-right font-semibold tabular-nums">{money(p.data.pacGiving)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      {/* Ads & dark money */}
      <Block title="Ad spending & dark money" note="Online election ads from Google's transparency report, and broadcast issue ads naming candidates filed by groups that don't report donors.">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Biggest Google & YouTube election advertisers since 2025{google ? ` · ${money(google.data.total)} total` : ""}
            </h3>
            {googleAds.length ? <GoogleAdvertisers rows={googleAds} /> : <Empty title="Google ads data not ingested yet" />}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Issue ads naming candidates (FEC electioneering communications)</h3>
            <EcGroups rows={ecGroups} />
            <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">TV & streaming ad totals (AdImpact&apos;s published figures)</h3>
            <AdImpactPosts posts={adimpact} limit={5} />
            <p className="mt-2 text-xs text-slate-500">
              <strong>Dark money:</strong> 501(c)(4) groups don&apos;t disclose donors. Their spending shows up only when they run ads that name candidates near an election (FEC Form 9, above), or when they buy online election ads (marked &quot;Issue group (not FEC-registered)&quot; in the Google list).
            </p>
          </div>
        </div>
      </Block>

      {/* Lobbying */}
      <Block title="Lobbying Congress on data centers" note="Bills named most often in federal lobbying reports that mention data centers, and the clients behind them (2025–26).">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Most-lobbied bills</h3>
            {lobbyBills.length ? (
              <ol className="space-y-2">
                {lobbyBills.slice(0, 12).map((b, i) => {
                  const tracked = b.data.billId ? getEntity<Bill>(b.data.billId) : null;
                  return (
                    <li key={b.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <span className="mr-1.5 text-xs tabular-nums text-slate-400">{i + 1}</span>
                        {tracked ? <Link href={`/legislation/${tracked.data.id}`} className="font-semibold hover:underline">{b.title}</Link> : <span className="font-semibold">{b.title}</span>}
                        {b.data.name && b.data.isNumber && <span className="text-slate-600">: {b.data.name}</span>}
                        <div className="text-xs text-slate-500">{b.data.topClients.slice(0, 3).map((c) => titleCase(c.name)).join(", ")}</div>
                      </div>
                      <div className="text-right text-xs whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{b.data.filings} reports</div>
                        <div className="text-slate-500">{b.data.clientCount} clients</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <Empty title="No lobbying data yet" />}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Biggest lobbying clients</h3>
            <ol className="space-y-2">
              {lobbyClients.map((c, i) => (
                <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <div>
                    <span className="mr-1.5 text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <a href={c.sources[0]?.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{titleCase(c.data.name)}</a>
                    <div className="text-xs text-slate-500">{c.data.issues.slice(0, 3).join(" · ")}{c.data.registrants.length ? ` · via ${c.data.registrants.length} firm${c.data.registrants.length > 1 ? "s" : ""}` : ""}</div>
                  </div>
                  <div className="text-right text-xs whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{money(c.data.amount)}</div>
                    <div className="text-slate-500">{c.data.filings} reports</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
        {lobby && (
          <p className="mt-4 text-xs text-slate-500">
            Most-lobbied agencies: {lobby.agencies.filter((a) => !/HOUSE OF REP|SENATE/.test(a.name)).slice(0, 6).map((a) => a.name).join(" · ")}
          </p>
        )}
      </Block>

      <details className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-800">How to read these numbers</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Outside spending</strong> is money spent independently to support or oppose candidates (ads, mail, canvassing), from FEC 24/48-hour reports with amendments applied. Spending in primaries is grey in the bars and doesn&apos;t count toward a party.</li>
          <li><strong>PAC contributions</strong> go directly to candidate campaigns and have legal limits. They&apos;re counted separately and never added to outside spending.</li>
          <li><strong>Lobbying dollars</strong> are what each quarterly report discloses for <em>all</em> its issues, so they show how active a client is, not money spent on data centers alone. This mirrors the OpenSecrets &quot;top bills&quot; approach of counting reports.</li>
          <li>Interest-group types come from FEC&apos;s own committee codes. Spending doesn&apos;t prove influence or coordination.</li>
          <li><strong>Online ads</strong> come from Google&apos;s transparency report (Google, YouTube and partner sites only). Meta, TV, radio and streaming buys aren&apos;t included. AdImpact&apos;s reservation data is a paid product; only its published figures are shown.</li>
          <li>Not included yet: state-level lobbying outside the sources listed on the Sources page, and individual donors to federal candidates.</li>
        </ul>
      </details>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-4 border-b border-slate-200 pb-2">
        <h2 className="text-xl font-bold">{title}</h2>
        {note && <p className="mt-0.5 text-sm text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}
