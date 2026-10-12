import { connection } from "next/server";
import Link from "next/link";
import { Evidence, Freshness, Missing, Page, Panel, Party, Pill, Section } from "@/components/ui";
import { getAdapter, getCommitteeMembers, getCommittees, getIncumbentRace, getLegislators } from "@/lib/repo";

export const metadata = { title: "Congress & committees" };

export default async function CongressPage() {
  await connection();
  const committees = getCommittees(true).filter((c) => !c.data.parent);
  const subs = getCommittees(true).filter((c) => c.data.parent);
  const legislators = getLegislators();
  const adapter = getAdapter("congress-legislators");
  const senate = legislators.filter((l) => l.data.chamber === "Senate");
  const house = legislators.filter((l) => l.data.chamber === "House");
  const count = (ls: typeof legislators, p: string) => ls.filter((l) => l.data.party === p).length;

  return (
    <Page
      title="Congress & committees"
      subtitle={
        <>
          The committees with real jurisdiction over power, permitting, water, tax and AI policy, their leaders, and which members
          are on the 2026 ballot. <Freshness at={adapter?.last_success} label="Rosters refreshed" />
        </>
      }
    >
      <div className="mb-4 grid gap-3 text-xs md:grid-cols-2">
        <Panel className="p-3">
          <div className="font-semibold">Senate: {count(senate, "R")} R · {count(senate, "D")} D · {count(senate, "I")} I</div>
          <div className="text-slate-600">{senate.filter((s) => s.data.up2026).length} seats held by members whose terms end by Jan 3, 2027.</div>
        </Panel>
        <Panel className="p-3">
          <div className="font-semibold">House: {count(house, "R")} R · {count(house, "D")} D{count(house, "I") ? ` · ${count(house, "I")} I` : ""} (incl. delegates)</div>
          <div className="text-slate-600">Every voting seat is on the 2026 ballot. The majority party chairs every committee and sets the floor agenda.</div>
        </Panel>
      </div>
      <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        <Evidence type="analysis" /> Committee control shapes which bills get hearings and markups. It doesn&apos;t decide outcomes alone:
        floor votes, the Senate filibuster, the president&apos;s signature, and how agencies (FERC, DOE, EPA) implement the law all
        matter, often more. One member&apos;s election rarely changes a committee&apos;s direction unless it flips chamber control.
      </p>

      {committees.map((c) => {
        const members = getCommitteeMembers(c.data.thomasId);
        const leaders = members.filter((m) => m.title);
        const up = members.filter((m) => m.legislator.data.up2026);
        const mySubs = subs.filter((s) => s.data.parent === c.id && c.data.relevance?.keySubcommittees.includes(s.data.thomasId));
        return (
          <Section key={c.id} id={c.data.thomasId} title={c.title} aside={<a href={c.data.url} target="_blank" rel="noopener noreferrer" className="underline">official site</a>}>
            <Panel className="p-3">
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="text-xs">
                  {c.data.relevance && (
                    <p className="text-slate-800">
                      <Evidence type="analysis" /> {c.data.relevance.relevance}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">{c.data.relevance?.topics.map((t) => <Pill key={t}>{t.replace(/_/g, " ")}</Pill>)}</div>
                  {c.data.jurisdiction && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-slate-500">Official jurisdiction text</summary>
                      <p className="mt-1 whitespace-pre-line text-slate-600">{c.data.jurisdiction}</p>
                    </details>
                  )}
                  {mySubs.length > 0 && (
                    <p className="mt-2 text-slate-600"><span className="font-medium">Key subcommittees:</span> {mySubs.map((s) => s.title.split(": ")[1]).join("; ")}</p>
                  )}
                </div>
                <div className="text-xs">
                  <div className="mb-1 font-medium text-slate-700">Leadership</div>
                  {leaders.length ? leaders.map((m) => (
                    <div key={m.legislator.id}>
                      {m.title}: {m.legislator.title} <Party party={m.legislator.data.party} /> ({m.legislator.data.state})
                      {m.legislator.data.up2026 && <> <Pill tone="amber">up 2026</Pill></>}
                    </div>
                  )) : <Missing>Not listed</Missing>}
                  <div className="mt-2 mb-1 font-medium text-slate-700">
                    Members on the 2026 ballot ({up.length} of {members.length})
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {up.map((m) => {
                      const race = getIncumbentRace(m.legislator.id);
                      const label = (
                        <>
                          <Party party={m.legislator.data.party} /> {m.legislator.data.lastName} ({m.legislator.data.state}
                          {m.legislator.data.chamber === "House" ? `-${String(m.legislator.data.district ?? 0).padStart(2, "0")}` : ""})
                        </>
                      );
                      return race ? (
                        <Link key={m.legislator.id} href={`/elections/${race.data.id}`} className="underline decoration-slate-300">{label}</Link>
                      ) : (
                        <span key={m.legislator.id}>{label}</span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Panel>
          </Section>
        );
      })}
    </Page>
  );
}
