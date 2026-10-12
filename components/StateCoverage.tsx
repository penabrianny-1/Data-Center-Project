import Link from "next/link";

export interface CoverageRow {
  code: string;
  name: string;
  federal: boolean;
  stateFinance: "integrated" | "manual" | "blocked" | "unavailable" | "pending";
  lobbying: "integrated" | "manual" | "blocked" | "unavailable" | "pending";
  financeNote: string;
  lobbyNote: string;
}

const LABEL = {
  integrated: { text: "✓ Integrated", cls: "text-emerald-700" },
  manual: { text: "Manual file", cls: "text-amber-700" },
  pending: { text: "Planned", cls: "text-slate-500" },
  blocked: { text: "Site rules forbid", cls: "text-rose-700" },
  unavailable: { text: "No data files", cls: "text-slate-400" },
} as const;

export default function StateCoverage({ rows }: { rows: CoverageRow[] }) {
  const count = (k: "stateFinance" | "lobbying") => rows.filter((r) => r[k] === "integrated" || r[k] === "manual").length;
  return (
    <details className="rounded-xl border border-slate-200">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-800">
        State coverage: federal money in all 50 states · state-race money in {count("stateFinance")} · state lobbying in {count("lobbying")} (see why)
      </summary>
      <div className="max-h-[480px] overflow-auto border-t border-slate-100">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr><th className="px-3 py-1.5">State</th><th className="px-3 py-1.5">Federal races</th><th className="px-3 py-1.5">State-race money</th><th className="px-3 py-1.5">State lobbying</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-slate-100">
                <td className="px-3 py-1.5"><Link href={`/states/${r.code}#money`} className="font-medium hover:underline">{r.name}</Link></td>
                <td className="px-3 py-1.5 text-emerald-700">{r.federal ? "✓" : "—"}</td>
                <td className={`px-3 py-1.5 ${LABEL[r.stateFinance].cls}`} title={r.financeNote}>{LABEL[r.stateFinance].text}</td>
                <td className={`px-3 py-1.5 ${LABEL[r.lobbying].cls}`} title={r.lobbyNote}>{LABEL[r.lobbying].text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
        &quot;Site rules forbid&quot;: robots.txt, a CAPTCHA or bot wall, or terms bar automated collection, so it isn&apos;t circumvented. &quot;Manual file&quot;: the adapter processes a file you download yourself. Hover a cell for details.
      </p>
    </details>
  );
}
