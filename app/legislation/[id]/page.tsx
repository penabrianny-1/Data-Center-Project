import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BillStatus } from "@/components/records";
import { Evidence, Impact, KV, Missing, Page, Panel, Party, Pill, Provenance, Section, humanize } from "@/components/ui";
import WatchButton from "@/components/WatchButton";
import { getEntity, getOfficialBillRecord } from "@/lib/repo";
import type { Bill } from "@/lib/schema";
import { stateName } from "@/lib/states";

export async function generateMetadata({ params }: PageProps<"/legislation/[id]">) {
  const b = getEntity<Bill>(`bill:${(await params).id}`);
  return { title: b ? `${b.data.jurisdiction} ${b.data.number}` : "Bill" };
}

export default async function BillPage({ params }: PageProps<"/legislation/[id]">) {
  await connection();
  const { id } = await params;
  const row = getEntity<Bill>(`bill:${id}`);
  if (!row) notFound();
  const b = row.data;
  const official = getOfficialBillRecord(row.id);
  const related = b.related.map((r) => getEntity<Bill>(`bill:${r}`)).filter(Boolean);

  return (
    <Page
      title={`${b.jurisdiction === "US" ? "Federal" : stateName(b.jurisdiction)} ${b.number}`}
      subtitle={b.title}
      actions={<WatchButton id={row.id} label={`${b.jurisdiction} ${b.number}`} href={`/legislation/${id}`} kind="bill" />}
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div>
          <Section title="What it does">
            <Panel className="p-3 text-sm text-slate-800">{b.summary}</Panel>
          </Section>
          <Section title={<span>Practical significance <Evidence type="analysis" /></span>}>
            <Panel className="p-3 text-sm text-slate-800">{b.significance}</Panel>
          </Section>
          {related.length > 0 && (
            <Section title="Related bills">
              <ul className="text-sm">
                {related.map((r) => (
                  <li key={r!.id}><Link href={`/legislation/${r!.data.id}`} className="underline">{r!.data.jurisdiction} {r!.data.number}</Link>: {r!.data.title}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <aside>
          <Panel className="p-3">
            <KV
              items={[
                ["Status", <BillStatus key="s" status={b.status} />],
                ["Direction", <Impact key="i" impact={b.impact} />],
                ["Names data centers", b.explicitDataCenter ? "Yes" : "No (indirect effect)"],
                ["Session", b.session],
                ["Introduced", b.introduced ?? null],
                ["Latest action", `${b.latestAction.date}: ${b.latestAction.text}`],
                ["Enacted", b.enactedDate ?? (b.status === "enacted" ? null : "—")],
                ["Effective", b.effectiveDate ?? "—"],
                ["Committees", b.committees.length ? b.committees.join("; ") : <Missing key="c">None recorded</Missing>],
                ["Topics", <span key="t" className="flex flex-wrap gap-0.5">{b.themes.map((t) => <Pill key={t}>{humanize(t)}</Pill>)}</span>],
              ]}
            />
            <div className="mt-2 text-xs">
              <span className="text-slate-500">Sponsors: </span>
              {b.sponsors.length ? b.sponsors.map((s, i) => <span key={s.name}>{i > 0 && ", "}{s.name} <Party party={s.party} /></span>) : <Missing>Not recorded</Missing>}
            </div>
            <a href={b.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
              Official bill page & full text →
            </a>
            {official && (
              <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                <div className="font-semibold">Congress.gov official record</div>
                {official.data.latestAction && <div>{official.data.latestAction.actionDate}: {official.data.latestAction.text}</div>}
                <div>{official.data.cosponsorCount} cosponsors · retrieved {official.retrievedAt.slice(0, 10)}</div>
              </div>
            )}
          </Panel>
          <Provenance sources={row.sources} verifiedAt={b.verifiedAt} confidence={b.confidence} caveats={b.caveats} retrievedAt={row.retrievedAt} />
        </aside>
      </div>
    </Page>
  );
}
