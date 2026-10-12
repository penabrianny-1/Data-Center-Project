import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, Evidence, KV, Missing, Page, Panel, Party, Pill, Provenance, Section, SourceKindTag, money, humanize } from "@/components/ui";
import WatchButton from "@/components/WatchButton";
import { titleCase } from "@/components/money";
import { getCandMoney, getStateFinanceForCandidate, getCandidatesForRace, getCommission, getFinanceFor, getIncumbentForRace, getMemberCommittees, getRace, getIeTotals } from "@/lib/repo";

export async function generateMetadata({ params }: PageProps<"/elections/[id]">) {
  const r = getRace((await params).id);
  return { title: r?.title ?? "Race" };
}

export default async function RacePage({ params }: PageProps<"/elections/[id]">) {
  await connection();
  const { id } = await params;
  const race = getRace(id);
  if (!race) notFound();
  const r = race.data;
  const candidates = getCandidatesForRace(race.id);
  const incumbent = getIncumbentForRace(race.id);
  const committees = incumbent ? getMemberCommittees(incumbent.id).filter((c) => c.committee.status === "relevant") : [];
  const ieTotals = new Map(getIeTotals().map((t) => [t.data.fecId, t.data]));
  const commission = r.office === "Governor" ? getCommission(r.state) : null;

  return (
    <Page
      title={race.title}
      subtitle={
        <>
          Election {r.electionDate}
          {r.primaryDate && ` · primary ${r.primaryDate}`}
          {r.runoffDate && ` · runoff ${r.runoffDate}`} · <Link href={`/states/${r.state}`} className="underline">{r.state} profile</Link>
        </>
      }
      actions={<WatchButton id={race.id} label={race.title} href={`/elections/${id}`} kind="race" />}
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div>
          <Section title="Candidates">
            <div className="space-y-3">
              {candidates.map((c) => {
                const fin = getFinanceFor(c.id)[0];
                const ie = fin ? ieTotals.get(fin.data.fecId) : undefined;
                return (
                  <Panel key={c.id} className="p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {c.data.name} <Party party={c.data.party} /> {c.data.incumbent && <span className="text-xs text-slate-500">incumbent</span>}
                      </h3>
                      <div className="flex items-center gap-2 text-xs">
                        <Pill>{humanize(c.data.status)}</Pill>
                        {c.data.website && <a href={c.data.website} target="_blank" rel="noopener noreferrer" className="underline">campaign site</a>}
                      </div>
                    </div>
                    {fin && (() => {
                      const cm = getCandMoney(fin.data.fecId)?.data;
                      if (!cm || (!cm.outside && !cm.pacContributors.length)) return null;
                      return (
                        <div className="mt-2 grid gap-3 rounded-lg bg-slate-50 p-2 text-xs md:grid-cols-2">
                          {cm.outside && (
                            <div>
                              <div className="font-semibold text-slate-700">Outside spending: {money(cm.outside.support)} for · {money(cm.outside.oppose)} against</div>
                              <ul className="mt-1 space-y-0.5">
                                {cm.outside.spenders.slice(0, 5).map((x) => (
                                  <li key={x.id}><Link href={`/money/${x.id}`} className="hover:underline">{titleCase(x.name)}</Link> <span className="text-slate-500">{x.support >= x.oppose ? `for ${money(x.support)}` : `against ${money(x.oppose)}`}</span></li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {cm.pacContributors.length > 0 && (
                            <div>
                              <div className="font-semibold text-slate-700">Top PAC contributors ({money(cm.pacTotal)} total)</div>
                              <ul className="mt-1 space-y-0.5">
                                {cm.pacContributors.slice(0, 5).map((x) => (
                                  <li key={x.id}><Link href={`/money/${x.id}`} className="hover:underline">{titleCase(x.name)}</Link> <span className="text-slate-500">{money(x.amount)} · {x.category}</span></li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {fin && (
                      <div className="mt-1 text-xs text-slate-600">
                        <a href={fin.data.fecUrl} target="_blank" rel="noopener noreferrer" className="underline">FEC {fin.data.fecId}</a>: raised {money(fin.data.receipts)} · spent {money(fin.data.disbursements)} · cash {money(fin.data.cashOnHand)}
                        {fin.data.coverageEnd && ` (through ${fin.data.coverageEnd})`}
                        {ie && <> · outside spending: {money(ie.support)} for, {money(ie.oppose)} against</>}
                      </div>
                    )}
                    {(() => {
                      const sf = getStateFinanceForCandidate(c.id)?.data;
                      if (!sf) return null;
                      return (
                        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
                          <div className="font-semibold text-slate-700">
                            State campaign money: {money(sf.total)} raised since {sf.since} ({sf.count.toLocaleString()} itemized contributions)
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {sf.topDonors.slice(0, 6).map((d) => (
                              <li key={d.name + d.city}>{d.name} <span className="text-slate-500">{money(d.amount)}{d.employer ? ` · ${d.employer}` : ""}</span></li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}
                    {c.data.positions.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {c.data.positions.map((p, i) => (
                          <li key={i} className="text-xs">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Pill tone="slate">{humanize(p.topic)}</Pill>
                              {p.explicitDataCenter ? <Pill tone="amber">Explicit: data centers</Pill> : <Pill>Inferred from broader positions</Pill>}
                              <Evidence type={p.evidence} />
                              {p.date && <span className="text-slate-400">{p.date}</span>}
                            </div>
                            <p className="mt-0.5 text-slate-800">{p.summary}</p>
                            <a href={p.source.url} target="_blank" rel="noopener noreferrer" className="text-slate-500 underline decoration-slate-300">
                              <SourceKindTag kind={p.source.kind} /> {p.source.publisher}: {p.source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs"><Missing>No documented positions on data centers, energy or related issues found.</Missing></p>
                    )}
                  </Panel>
                );
              })}
              {candidates.length === 0 && <Empty title="No candidates recorded" />}
            </div>
          </Section>

          <Section title="What the winner can actually do">
            <Panel className="p-3 text-sm text-slate-800">{r.powers}</Panel>
          </Section>
          <Section title={<span>Implications of a change in control <Evidence type="analysis" /></span>}>
            <Panel className="p-3 text-sm text-slate-800">{r.implications}</Panel>
            {commission && (
              <p className="mt-2 text-xs text-slate-600">
                <span className="font-semibold">Regulator link:</span> {commission.data.electionMechanism}{" "}
                <Link href={`/states/${r.state}#regulator`} className="underline">Commission details</Link>
              </p>
            )}
          </Section>
        </div>

        <aside>
          <Section title="Ratings">
            {r.ratings.length ? (
              <Panel className="divide-y divide-slate-100">
                {r.ratings.map((x) => (
                  <a key={x.rater} href={x.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-slate-50">
                    <span>{x.rater} <span className="text-slate-400">· {x.date}</span></span>
                    <Pill tone={x.rating.includes("D") ? "blue" : x.rating.includes("R") ? "red" : "violet"}>{x.rating}</Pill>
                  </a>
                ))}
              </Panel>
            ) : <Missing>No ratings recorded</Missing>}
          </Section>
          <Section title="Polling">
            {r.polls.length ? (
              <Panel className="divide-y divide-slate-100">
                {r.polls.map((p, i) => (
                  <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block px-3 py-1.5 text-xs hover:bg-slate-50">
                    <div className="flex justify-between"><span className="font-medium">{p.pollster}</span><span className="text-slate-400">{p.endDate}{p.sampleSize && ` · n=${p.sampleSize}`}{p.population && ` ${p.population}`}</span></div>
                    <div className="text-slate-700">{Object.entries(p.results).map(([k, v]) => `${k} ${v}%`).join(" · ")}</div>
                  </a>
                ))}
              </Panel>
            ) : <Missing>No credible public polling on record.</Missing>}
            <p className="mt-1 text-[11px] text-slate-400">Individual polls are snapshots, not forecasts.</p>
          </Section>
          {incumbent && (
            <Section title="Incumbent's committee power">
              <Panel className="p-3 text-xs">
                <KV items={[["Member", `${incumbent.title} (${incumbent.data.party})`], ["Term ends", incumbent.data.termEnd]]} />
                <ul className="mt-2 space-y-0.5">
                  {committees.map((c) => (
                    <li key={c.committee.id}>{c.committee.title} {c.title && <strong>({c.title})</strong>}</li>
                  ))}
                  {committees.length === 0 && <li><Missing>No seats on committees with data-center jurisdiction</Missing></li>}
                </ul>
              </Panel>
            </Section>
          )}
          <Provenance sources={race.sources} verifiedAt={r.verifiedAt} confidence={r.confidence} caveats={r.caveats} />
        </aside>
      </div>
    </Page>
  );
}
