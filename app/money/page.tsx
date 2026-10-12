import { connection } from "next/server";
import Link from "next/link";
import { Empty, Freshness, Page, Panel, Party, Pill, Section, money } from "@/components/ui";
import { getAdapter, getFinance, getIeTotals, getRaces, getCandidatesForRace, getFinanceFor } from "@/lib/repo";

export const metadata = { title: "Campaign finance" };

export default async function MoneyPage() {
  await connection();
  const fec = getAdapter("fec-bulk");
  const ieAdapter = getAdapter("fec-ie");
  const finance = getFinance();
  const ie = new Map(getIeTotals().map((t) => [t.data.fecId, t.data]));

  // Race-level totals for curated Senate/House races (candidate committees only).
  const races = getRaces().filter((r) => r.data.office !== "Governor");
  const raceTotals = races
    .map((r) => {
      const fins = getCandidatesForRace(r.id).flatMap((c) => getFinanceFor(c.id).map((f) => ({ c, f })));
      const raised = fins.reduce((n, x) => n + x.f.data.receipts, 0);
      const outside = fins.reduce((n, x) => n + (ie.get(x.f.data.fecId)?.support ?? 0) + (ie.get(x.f.data.fecId)?.oppose ?? 0), 0);
      return { r, fins, raised, outside };
    })
    .filter((x) => x.fins.length)
    .sort((a, b) => b.raised + b.outside - (a.raised + a.outside));

  const recentIe = finance
    .flatMap((f) => (f.data.recentIeFilings ?? []).map((x) => ({ ...x, cand: f.data })))
    .filter((x) => x.amount >= 100_000)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.amount - a.amount)
    .slice(0, 40);

  return (
    <Page
      title="Campaign finance"
      subtitle={
        <>
          Disclosed federal campaign money from FEC filings. Contributions to candidate committees, independent expenditures, lobbying and
          ad buys are separate categories with different reporting rules and are never added together here.{" "}
          <Freshness at={fec?.last_success} label="FEC bulk refreshed" />
        </>
      }
    >
      <div className="mb-4 grid gap-3 text-xs md:grid-cols-4">
        <Cat title="Candidate committee money" status="Integrated" tone="green" note="FEC bulk summaries: receipts, spending, cash, PAC and party contributions for every House and Senate campaign." />
        <Cat title="Independent expenditures" status={ieAdapter?.last_success ? "Integrated" : "Raw filings only"} tone={ieAdapter?.last_success ? "green" : "amber"} note={ieAdapter?.last_success ? "FEC processed totals by candidate and spender." : "Set FEC_API_KEY for FEC-processed totals. Until then, individual filings are listed and never summed."} />
        <Cat title="Lobbying" status="Not integrated" tone="slate" note="Senate LDA disclosures are planned. Lobbying is never mixed with campaign money." />
        <Cat title="Ad spending (AdImpact)" status="Licensed" tone="slate" note="Proprietary. Only figures AdImpact itself published, cited in curated records, are used." />
      </div>

      <Section title="Tracked races by money raised" aside="Candidate committees (+ processed outside spending when configured)">
        {raceTotals.length ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Race</th><th className="px-2 py-1.5 text-right">Candidates raised</th><th className="px-2 py-1.5 text-right">Outside (processed)</th><th className="px-2 py-1.5">Candidates</th></tr></thead>
              <tbody>
                {raceTotals.slice(0, 30).map(({ r, fins, raised, outside }) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5"><Link href={`/elections/${r.data.id}`} className="font-medium underline decoration-slate-300">{r.title}</Link></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(raised)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{ie.size ? money(outside) : <span className="text-slate-300">needs key</span>}</td>
                    <td className="px-2 py-1.5">
                      {fins.map(({ c, f }) => (
                        <div key={f.id}>
                          <Party party={c.data.party} /> <a href={f.data.fecUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300">{c.data.name}</a>: {money(f.data.receipts)} raised · {money(f.data.cashOnHand)} cash
                          {f.data.coverageEnd && <span className="text-slate-400"> (thru {f.data.coverageEnd})</span>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No tracked federal races linked to FEC records yet" />}
      </Section>

      <Section title="Recent large independent expenditures (raw FEC filings, ≥ $100K)" aside="Individual 24/48-hour and periodic reports, each linked to the filing image. Not totals.">
        {recentIe.length ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Spender</th><th className="px-2 py-1.5">For / against</th><th className="px-2 py-1.5">Candidate</th><th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5">Purpose</th></tr></thead>
              <tbody>
                {recentIe.map((x, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 tabular-nums">{x.date ?? "—"}</td>
                    <td className="px-2 py-1.5">{x.spender}</td>
                    <td className="px-2 py-1.5"><Pill tone={x.side === "support" ? "green" : "red"}>{x.side}</Pill></td>
                    <td className="px-2 py-1.5"><Party party={x.cand.party} /> {x.cand.name} ({x.cand.state}{x.cand.district ? `-${x.cand.district}` : ""})</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(x.amount)}</td>
                    <td className="px-2 py-1.5">{x.purpose}{x.filingUrl && <> · <a href={x.filingUrl} target="_blank" rel="noopener noreferrer" className="underline">filing</a></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No independent expenditure filings ingested" />}
      </Section>

      <Panel className="p-3 text-xs text-slate-600">
        <p className="font-semibold text-slate-800">Interpretation limits</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Spending doesn&apos;t establish competitiveness, persuasion, coordination or policy influence.</li>
          <li>Money is tied to an industry only when disclosed records support it. A donor&apos;s employer doesn&apos;t establish why they gave.</li>
          <li>Governor, state legislative and utility commission races file with state agencies, which aren&apos;t integrated yet (see Sources).</li>
        </ul>
      </Panel>
    </Page>
  );
}

function Cat({ title, status, tone, note }: { title: string; status: string; tone: "green" | "amber" | "slate"; note: string }) {
  return (
    <Panel className="p-3">
      <div className="flex items-center justify-between"><span className="font-semibold">{title}</span><Pill tone={tone}>{status}</Pill></div>
      <p className="mt-1 text-slate-600">{note}</p>
    </Panel>
  );
}
