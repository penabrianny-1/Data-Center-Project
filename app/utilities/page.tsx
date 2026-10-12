import { connection } from "next/server";
import Link from "next/link";
import { DocketList } from "@/components/records";
import { ConfidenceBadge, Evidence, Page, Pill, Section, humanize } from "@/components/ui";
import { getCommissions, getDockets } from "@/lib/repo";

export const metadata = { title: "Utility commissions" };

export default async function UtilitiesPage() {
  await connection();
  const commissions = getCommissions().sort((a, b) => a.state!.localeCompare(b.state!));
  const dockets = getDockets();
  const ferc = dockets.filter((d) => d.state === "US");
  const state = dockets.filter((d) => d.state !== "US");
  const by = (k: string) => commissions.filter((c) => c.data.selection === k).length;

  return (
    <Page
      title="Utility commissions"
      subtitle="The regulators who decide whether data centers get power, and who pays for it."
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Pill tone="blue">{by("appointed")} appointed</Pill>
        <Pill tone="amber">{by("elected")} elected</Pill>
        <Pill tone="green">{by("legislature") + by("mixed")} chosen by legislature or mixed</Pill>
        <Pill>{commissions.filter((c) => c.data.largeLoadTariff === "approved").length} with approved large-load tariffs</Pill>
        <Pill>{commissions.filter((c) => c.data.seatsUp2026 > 0).length} with seats on the 2026 ballot</Pill>
      </div>

      <Section title="All commissions" aside={<span>How 2026 reaches each commission: <Evidence type="analysis" /> causal chain, not a forecast</span>}>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-2 py-1.5">St.</th>
                <th className="px-2 py-1.5">Commission</th>
                <th className="px-2 py-1.5">Selection</th>
                <th className="px-2 py-1.5">Seats</th>
                <th className="px-2 py-1.5">2026 ballot</th>
                <th className="px-2 py-1.5">Large-load tariff</th>
                <th className="px-2 py-1.5">Election → commission mechanism</th>
                <th className="px-2 py-1.5">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-semibold"><Link href={`/states/${c.state}#regulator`}>{c.state}</Link></td>
                  <td className="px-2 py-1.5"><a href={c.data.url} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300">{c.data.name}</a></td>
                  <td className="px-2 py-1.5">{humanize(c.data.selection)}<div className="text-slate-500">{c.data.selectionDetail}</div></td>
                  <td className="px-2 py-1.5 tabular-nums">{c.data.seats}</td>
                  <td className="px-2 py-1.5">{c.data.seatsUp2026 ? <Pill tone="amber">{c.data.seatsUp2026}</Pill> : "—"}</td>
                  <td className="px-2 py-1.5">
                    <Pill tone={c.data.largeLoadTariff === "approved" ? "green" : c.data.largeLoadTariff === "pending" ? "amber" : "slate"}>{humanize(c.data.largeLoadTariff)}</Pill>
                  </td>
                  <td className="max-w-md px-2 py-1.5 text-slate-700">{c.data.electionMechanism}</td>
                  <td className="px-2 py-1.5"><ConfidenceBadge level={c.data.confidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 2xl:grid-cols-2">
        <Section title={`State proceedings (${state.length})`} aside="Large-load tariffs, IRPs, special contracts, cost allocation">
          <DocketList dockets={state} />
        </Section>
        <Section title={`FERC & regional grid operators (${ferc.length})`} aside="Federal rules on interconnection, co-location and capacity markets">
          <DocketList dockets={ferc} />
        </Section>
      </div>
    </Page>
  );
}
