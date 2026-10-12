import type { DiscoveredBill, Row } from "@/lib/repo";
import { Empty, Pill, humanize } from "./ui";

export default function DiscoveredBills({ bills, showState = true }: { bills: Row<DiscoveredBill>[]; showState?: boolean }) {
  if (!bills.length) {
    return <Empty title="No automatically discovered bills yet">Open States discovery runs daily once OPENSTATES_API_KEY is set (see Sources).</Empty>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            {showState && <th className="px-2 py-1.5">St.</th>}
            <th className="px-2 py-1.5">Bill</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="px-2 py-1.5">Latest action</th>
            <th className="px-2 py-1.5">Sponsor</th>
          </tr>
        </thead>
        <tbody>
          {bills.map(({ id, data: b }) => (
            <tr key={id} className="border-t border-slate-100 align-top">
              {showState && <td className="px-2 py-1.5 font-semibold">{b.jurisdiction}</td>}
              <td className="max-w-md px-2 py-1.5">
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-slate-300">{b.identifier}</a>{" "}
                <span className="text-slate-700">{b.title}</span>
                <div className="text-[11px] text-slate-400">{b.session} · <a href={b.openstatesUrl} target="_blank" rel="noopener noreferrer" className="underline">Open States</a></div>
              </td>
              <td className="px-2 py-1.5"><Pill tone={b.status === "enacted" ? "green" : b.status === "vetoed" || b.status === "failed" ? "slate" : "amber"}>{humanize(b.status)}</Pill></td>
              <td className="max-w-xs px-2 py-1.5 text-slate-600"><span className="tabular-nums">{b.latestAction.date}</span> {b.latestAction.text}</td>
              <td className="px-2 py-1.5">{b.sponsors.slice(0, 2).map((s) => `${s.name}${s.party ? ` (${s.party})` : ""}`).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[10px] text-slate-400">Discovered automatically because the bill mentions data centers. Status comes from official action records. Direction and significance haven&apos;t been reviewed.</p>
    </div>
  );
}
