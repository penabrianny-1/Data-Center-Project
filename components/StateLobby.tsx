import type { Row, StateLobbyData, StateMoneySource } from "@/lib/repo";
import { money } from "./ui";

export function StateLobby({ lobby }: { lobby: Row<StateLobbyData> }) {
  const d = lobby.data;
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">
        {d.registrations.toLocaleString()} registrations · {d.clientCount.toLocaleString()} clients · {d.period}
        {d.amountMeaning && <span className="text-slate-400"> · amounts = {d.amountMeaning}</span>}
      </p>
      {d.dataCenterClients.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
          <strong>Lobbying that mentions data centers:</strong> {d.dataCenterClients.slice(0, 10).map((c) => c.name).join(", ")}
        </div>
      )}
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {d.topClients.slice(0, 10).map((c) => (
          <li key={c.name} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{c.name}</span>
              {c.dataCenter && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">data centers</span>}
              <span className="block text-[11px] text-slate-500">{[c.firms.slice(0, 2).join(", "), c.issues.slice(0, 3).join(" · ")].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="font-semibold tabular-nums">{c.amount != null ? money(c.amount) : `${c.filings} filing${c.filings === 1 ? "" : "s"}`}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[11px] text-slate-400">Source: {d.agency}{d.dataAsOf ? ` · data as of ${d.dataAsOf.slice(0, 10)}` : ""}</p>
    </div>
  );
}

const METHOD_TEXT: Record<string, string> = {
  bulk: "publishes bulk data files",
  api: "offers an API",
  export: "only offers a search page with CSV export",
  none: "only offers an HTML search (no downloadable data)",
};

/** Explains why a state's data isn't shown yet, with a link to the official search. */
export function StateDataGap({ kind, src }: { kind: "campaign finance" | "lobbying"; src: StateMoneySource["campaignFinance"] | undefined }) {
  if (!src) return <p className="text-sm text-slate-500">State {kind} data isn&apos;t integrated yet.</p>;
  const why = src.robotsOrTermsBlock
    ? "its site rules (robots.txt or terms) don't allow automated collection"
    : METHOD_TEXT[src.method] ?? "has no machine-readable data";
  return (
    <p className="text-sm text-slate-500">
      Not integrated: {src.agency} {why}.{" "}
      {src.page && <a href={src.page} target="_blank" rel="noopener noreferrer" className="underline">Search it directly →</a>}
    </p>
  );
}
