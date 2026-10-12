import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import NewsList from "@/components/NewsList";
import { LocalActionTable } from "@/components/records";
import { Empty, KV, Missing, Page, Panel, Section } from "@/components/ui";
import WatchButton from "@/components/WatchButton";
import { getNews, getCommission, getCounty, getLocalActionsInCounty, getPolicy, getStateGovernment } from "@/lib/repo";
import { stateName } from "@/lib/states";

export async function generateMetadata({ params }: PageProps<"/counties/[fips]">) {
  const c = getCounty((await params).fips);
  return { title: c ? `${c.data.name} County, ${c.state}` : "County" };
}

export default async function CountyPage({ params }: PageProps<"/counties/[fips]">) {
  await connection();
  const { fips } = await params;
  const county = getCounty(fips);
  if (!county) notFound();
  const st = county.state!;
  const actions = getLocalActionsInCounty(fips);
  const policy = getPolicy(st);
  const commission = getCommission(st);
  const gov = getStateGovernment(st);
  const name = county.data.name;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const news = getNews().filter((a) => a.data.states.includes(st) && re.test(`${a.title} ${a.data.summary}`));

  return (
    <Page
      title={`${name} County, ${stateName(st)}`}
      subtitle={<><Link href={`/states/${st}`} className="underline">← {stateName(st)} profile</Link> · FIPS {fips}</>}
      actions={<WatchButton id={county.id} label={`${name} County, ${st}`} href={`/counties/${fips}`} kind="county" />}
    >
      <Section title="Recorded local actions" aside="County and municipal actions in this county (curated sample)">
        <LocalActionTable actions={actions} />
      </Section>

      <Section title="Governing framework" aside="Which authorities apply here: state rules that bind or limit local decisions">
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel className="p-3 text-xs">
            <h3 className="mb-1 font-semibold">Local authority & preemption ({st})</h3>
            {policy ? (
              <>
                <p className="text-slate-700">{policy.data.preemption.summary}</p>
                {policy.data.preemption.remainingApprovals.length > 0 && (
                  <p className="mt-1 text-slate-600"><span className="font-medium">Approvals still required:</span> {policy.data.preemption.remainingApprovals.join("; ")}</p>
                )}
              </>
            ) : <Missing />}
          </Panel>
          <Panel className="p-3 text-xs">
            <h3 className="mb-1 font-semibold">Water</h3>
            {policy ? (
              <>
                <KV items={[["Permitting agency", policy.data.water.agency]]} />
                <p className="mt-1 text-slate-700">{policy.data.water.summary}</p>
              </>
            ) : <Missing />}
            <p className="mt-1 text-slate-400">Local water utility and basin authority aren&apos;t mapped yet.</p>
          </Panel>
          <Panel className="p-3 text-xs">
            <h3 className="mb-1 font-semibold">Power</h3>
            {commission ? <p className="text-slate-700">State regulator: {commission.data.name} ({commission.data.selection}).</p> : <Missing />}
            {policy && <p className="mt-1 text-slate-700">{policy.data.electricity.market}: {policy.data.electricity.summary}</p>}
            {gov && <p className="mt-1 text-slate-600">Governor: {gov.data.governor.name} ({gov.data.governor.party})</p>}
            <p className="mt-1 text-slate-400">Utility service-territory boundaries aren&apos;t mapped yet (planned: HIFLD / EIA-861).</p>
          </Panel>
        </div>
      </Section>

      <Section title="News mentioning this county">
        {news.length ? <NewsList items={news.slice(0, 10)} /> : <Empty title="No monitored stories name this county yet" />}
      </Section>

      <p className="text-xs text-slate-500">
        Coverage gap: zoning codes, planning commission agendas and permit applications aren&apos;t machine-readable nationwide. Records here
        come from curated research of ordinances, meeting records and local reporting.
      </p>
    </Page>
  );
}
