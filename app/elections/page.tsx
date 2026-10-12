import { connection } from "next/server";
import Link from "next/link";
import { Empty, Evidence, Page, Party, Pill, Section } from "@/components/ui";
import { getCommissions, getFinanceFor, getRaces, getCandidatesForRace, getLegislators, type Row } from "@/lib/repo";
import type { Race } from "@/lib/schema";

export const metadata = { title: "2026 elections" };

const RATING_ORDER = ["Solid D", "Likely D", "Lean D", "Tilt D", "Toss-up", "Tilt R", "Lean R", "Likely R", "Solid R"];

export default async function ElectionsPage() {
  await connection();
  const races = getRaces();
  const gov = races.filter((r) => r.data.office === "Governor");
  const sen = races.filter((r) => r.data.office === "U.S. Senate");
  const house = races.filter((r) => r.data.office === "U.S. House");
  const commissions = getCommissions().filter((c) => c.data.seatsUp2026 > 0);
  const houseMembers = getLegislators().filter((l) => l.data.chamber === "House");
  const houseByParty = { D: houseMembers.filter((l) => l.data.party === "D").length, R: houseMembers.filter((l) => l.data.party === "R").length };
  const senators = getLegislators().filter((l) => l.data.chamber === "Senate");
  const senByParty = { D: senators.filter((l) => l.data.party === "D").length, R: senators.filter((l) => l.data.party === "R").length, I: senators.filter((l) => l.data.party === "I").length };

  return (
    <Page
      title="2026 elections"
      subtitle="Every race that shapes data-center policy on Nov 3, 2026, sorted by how close it is."
    >
      <div className="mb-5 grid gap-3 text-xs sm:grid-cols-4">
        <Box label="U.S. Senate now" value={`${senByParty.R} R · ${senByParty.D} D · ${senByParty.I} I`} note={`${sen.length} seats up (incl. specials)`} />
        <Box label="U.S. House now" value={`${houseByParty.R} R · ${houseByParty.D} D`} note="All 435 seats up" />
        <Box label="Governorships up" value={String(gov.length)} />
        <Box label="Elected utility regulator seats" value={String(commissions.reduce((n, c) => n + c.data.seatsUp2026, 0))} note={commissions.map((c) => c.state).join(", ")} />
      </div>

      <Section title="Governors" aside="Governors appoint most state utility commissioners and sign or veto data-center bills">
        <RaceTable races={gov} />
      </Section>
      <Section title="U.S. Senate" aside="Senate control decides committee chairs: Energy & Natural Resources, EPW, Commerce, Finance">
        <RaceTable races={sen} />
      </Section>
      <Section title="U.S. House — competitive & data-center-salient races" aside={<span>Incumbents for all 435 seats are on <Link href="/congress" className="underline">Congress</Link></span>}>
        {house.length ? <RaceTable races={house} /> : <Empty title="Competitive House race research pending">Incumbents and FEC finance for every district are available on Congress and Campaign finance.</Empty>}
      </Section>
      <Section title="Utility commission seats on the ballot">
        {commissions.length ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">State</th><th className="px-2 py-1.5">Commission</th><th className="px-2 py-1.5">Seats up</th><th className="px-2 py-1.5">How it matters</th></tr></thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5 font-semibold"><Link href={`/states/${c.state}#regulator`}>{c.state}</Link></td>
                    <td className="px-2 py-1.5">{c.data.name}</td>
                    <td className="px-2 py-1.5">{c.data.seatsUp2026} of {c.data.seats}</td>
                    <td className="px-2 py-1.5 text-slate-700">{c.data.electionMechanism}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="Commission research pending" />}
      </Section>
    </Page>
  );
}

function Box({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

function RaceTable({ races }: { races: Row<Race>[] }) {
  const sorted = [...races].sort((a, b) => {
    const ra = RATING_ORDER.indexOf(a.data.ratings[0]?.rating ?? "zz"), rb = RATING_ORDER.indexOf(b.data.ratings[0]?.rating ?? "zz");
    return Math.abs(ra - 4) - Math.abs(rb - 4) || a.title.localeCompare(b.title);
  });
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">Race</th>
            <th className="px-2 py-1.5 font-medium">Incumbent</th>
            <th className="px-2 py-1.5 font-medium">Nominees</th>
            <th className="px-2 py-1.5 font-medium">Rating</th>
            <th className="px-2 py-1.5 font-medium">Raised (FEC)</th>
            <th className="px-2 py-1.5 font-medium">Data-center positions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const cands = getCandidatesForRace(r.id).filter((c) => ["nominee", "runoff"].includes(c.data.status));
            const explicit = cands.filter((c) => c.data.positions.some((p) => p.explicitDataCenter)).length;
            const rating = r.data.ratings[0];
            return (
              <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                <td className="px-2 py-1.5"><Link href={`/elections/${r.data.id}`} className="font-medium underline decoration-slate-300">{r.title}</Link></td>
                <td className="px-2 py-1.5">{r.data.incumbent ? <>{r.data.incumbent.name} <Party party={r.data.incumbent.party} />{!r.data.incumbent.running && <span className="text-slate-400"> (not running)</span>}</> : "Open"}</td>
                <td className="px-2 py-1.5">{cands.map((c) => <div key={c.id}><Party party={c.data.party} /> {c.data.name}</div>)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {rating ? (
                    <a href={rating.url} target="_blank" rel="noopener noreferrer" title={`${rating.rater}, ${rating.date}`}>
                      <Pill tone={rating.rating.includes("D") ? "blue" : rating.rating.includes("R") ? "red" : "violet"}>{rating.rating}</Pill>
                    </a>
                  ) : "—"}
                  {rating && <div className="text-[10px] text-slate-400">{rating.rater.replace("The ", "")} · {rating.date}</div>}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {cands.map((c) => {
                    const f = getFinanceFor(c.id)[0];
                    return <div key={c.id}>{f ? `$${(f.data.receipts / 1e6).toFixed(1)}M` : <span className="text-slate-300">—</span>}</div>;
                  })}
                </td>
                <td className="px-2 py-1.5">{explicit ? <Pill tone="amber">{explicit} explicit</Pill> : <span className="text-slate-400">none documented</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[10px] text-slate-400">Sorted by competitiveness. FEC receipts cover federal candidates only; state campaign finance isn&apos;t integrated yet. <Evidence type="fact" /> ratings are third-party assessments.</p>
    </div>
  );
}
