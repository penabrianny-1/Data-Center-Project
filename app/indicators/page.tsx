import { connection } from "next/server";
import GasExplorer from "@/components/GasExplorer";
import { Freshness, Page, Panel, Section, Sources } from "@/components/ui";
import { EIA_AREAS } from "@/lib/adapters/gas";
import { getAdapter, getLatestByArea, getSeries } from "@/lib/repo";
import { stateName } from "@/lib/states";
import { addDays } from "@/lib/time";

export const metadata = { title: "Gas prices" };

export default async function IndicatorsPage() {
  await connection();
  const aaa = getAdapter("aaa-gas");
  const eia = getAdapter("eia-gas");
  const states = getLatestByArea("aaa_regular").filter((o) => o.area !== "US");
  const national = getLatestByArea("aaa_regular").find((o) => o.area === "US");
  const lookback = getSeries("aaa_regular_lookback", "US");
  const grades = ["regular", "midgrade", "premium", "diesel"].map((g) => ({ g, o: getLatestByArea(`aaa_${g}`).find((x) => x.area === "US") }));
  const since = addDays(-5 * 365);
  const eiaSeries = Object.fromEntries(EIA_AREAS.map((a) => [a.area, getSeries("eia_regular_weekly", a.area, since).map((o) => ({ date: o.date, value: o.value }))]));
  const ago = (days: number) => lookback.find((o) => Math.abs(Date.parse(national?.date ?? "") - Date.parse(o.date) - days * 86_400_000) < 2 * 86_400_000);

  return (
    <Page
      title="Gas prices"
      subtitle={
        <>
          Market context, kept separate from the regulatory workflow. Gasoline prices don&apos;t predict data-center construction. They
          belong to the wider energy-affordability politics that also shapes electricity-rate debates.
        </>
      }
    >
      <Section title="National average today (AAA)" aside={<Freshness at={aaa?.last_success} label="Retrieved" />}>
        <Panel className="grid grid-cols-2 divide-x divide-slate-100 sm:grid-cols-4">
          {grades.map(({ g, o }) => (
            <div key={g} className="px-3 py-2">
              <div className="text-xs capitalize text-slate-500">{g === "midgrade" ? "Mid-grade" : g}</div>
              <div className="text-2xl font-semibold tabular-nums">{o ? `$${o.value.toFixed(3)}` : "—"}</div>
            </div>
          ))}
        </Panel>
        {national && (
          <p className="mt-1 text-xs text-slate-600">
            Regular, observed {national.date} (AAA &quot;price as of&quot; date).{" "}
            {[["yesterday", 1], ["week ago", 7], ["month ago", 30], ["year ago", 365]].map(([l, d]) => {
              const o = ago(d as number);
              return o ? <span key={l as string} className="mr-3">{l}: ${o.value.toFixed(3)} ({national.value - o.value >= 0 ? "+" : ""}{(national.value - o.value).toFixed(3)})</span> : null;
            })}
          </p>
        )}
        <div className="mt-1"><Sources compact sources={[{ title: "AAA Gas Prices", url: "https://gasprices.aaa.com/", publisher: "AAA", kind: "data" }]} /></div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Section title="Weekly history (EIA, official)" aside={<Freshness at={eia?.last_success} label="Retrieved" />}>
          <Panel className="p-3">
            <GasExplorer series={eiaSeries} areas={EIA_AREAS.map((a) => ({ area: a.area, label: a.label }))} />
            <p className="mt-2 text-[11px] text-slate-500">
              U.S. EIA weekly retail price survey, regular gasoline, all formulations. EIA publishes weekly series only for the nation, the five
              PADD regions and nine states. Daily state-level history isn&apos;t available from a free official source, so AAA&apos;s daily
              state averages build up history here as the app runs.
            </p>
            <Sources compact sources={[{ title: "EIA Gasoline and Diesel Fuel Update", url: "https://www.eia.gov/petroleum/gasdiesel/", publisher: "U.S. Energy Information Administration", kind: "data" }]} />
          </Panel>
        </Section>
        <Section title="State averages, regular (AAA)">
          <div className="max-h-[480px] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">State</th><th className="px-2 py-1 text-right">Regular</th><th className="px-2 py-1 text-right">vs U.S.</th></tr></thead>
              <tbody>
                {[...states].sort((a, b) => b.value - a.value).map((o) => (
                  <tr key={o.area} className="border-t border-slate-100">
                    <td className="px-2 py-1">{stateName(o.area)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">${o.value.toFixed(3)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">{national ? `${o.value - national.value >= 0 ? "+" : ""}${(o.value - national.value).toFixed(2)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Observed {states[0]?.date ?? "—"}. AAA doesn&apos;t publish local (metro) prices in a structured form; metro coverage isn&apos;t included.</p>
        </Section>
      </div>
    </Page>
  );
}
