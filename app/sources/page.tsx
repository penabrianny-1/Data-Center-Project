import { connection } from "next/server";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Freshness, Page, Panel, Pill, Section, SourceKindTag } from "@/components/ui";
import { PENDING_SOURCES } from "@/lib/adapters";
import { FEEDS } from "@/lib/adapters/news";
import { getAdapters, countsByState, byKind } from "@/lib/repo";
import { SEED_FILES } from "@/lib/schema";
import { isStale } from "@/lib/time";

export const metadata = { title: "Sources & coverage" };

const STALE_FACTOR = 3;

export default async function SourcesPage() {
  await connection();
  const adapters = getAdapters();
  const seedDir = join(process.cwd(), "data", "seed");
  const seedFiles = existsSync(seedDir) ? readdirSync(seedDir) : [];
  const counts = countsByState();
  const states = new Set(counts.map((c) => c.state).filter((s) => s !== "US"));
  const kinds: [string, string, number][] = [
    ["state_government", "State government composition", 51],
    ["policy", "State policy frameworks", 51],
    ["commission", "Utility commissions", 51],
    ["race", "2026 races (gov + Senate + House)", 0],
    ["bill", "Legislation", 0],
    ["docket", "Regulatory proceedings", 0],
    ["local_action", "Local actions", 0],
    ["development", "Priority developments", 0],
  ];

  return (
    <Page
      title="Sources & coverage"
      subtitle="Every adapter, when it last ran, what it covers and what it doesn't. Stale or failed sources keep their last good data and are flagged here, never silently presented as current."
    >
      <Section title="Source hierarchy">
        <Panel className="grid gap-2 p-3 text-xs md:grid-cols-5">
          {([
            ["official", "Statutes, legislative records, orders, dockets, filings, local codes"],
            ["data", "Official agency datasets and structured government feeds (FEC, EIA, GovInfo)"],
            ["journalism", "Credible news: public media, nonprofit newsrooms, trade press"],
            ["research", "Established policy research and law-firm analysis"],
            ["aggregator", "Third-party trackers, used to find and cross-check, never the only source"],
          ] as const).map(([k, d]) => (
            <div key={k}><SourceKindTag kind={k} /><p className="mt-1 text-slate-600">{d}</p></div>
          ))}
        </Panel>
        <p className="mt-1 text-xs text-slate-500">
          Every curated record needs at least one official, data, journalism or research source. Wikipedia, other wikis, forums and
          AI-generated content sites are rejected at validation time.
        </p>
      </Section>

      <Section title="Automated adapters" aside="Auto-refresh runs every 10 min while the app is running; each source refreshes on its own interval">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-2 py-1.5">Source</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Last success</th><th className="px-2 py-1.5">Records</th><th className="px-2 py-1.5">Coverage & limits</th></tr>
            </thead>
            <tbody>
              {adapters.map((a) => {
                const interval = { "news-feeds": 60, aaf: 180, curated: 60, resolver: 60, "aaa-gas": 360, "eia-gas": 720, "fec-bulk": 720 }[a.id] ?? 1440;
                const stale = isStale(a.last_success, interval, STALE_FACTOR);
                const warnings: string[] = a.warnings ? JSON.parse(a.warnings) : [];
                return (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5">
                      <a href={a.url.startsWith("http") ? a.url : undefined} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-slate-300">{a.name}</a>
                      <div className="text-slate-400">{a.id} · {a.method} · {a.schedule}</div>
                    </td>
                    <td className="px-2 py-1.5"><SourceKindTag kind={a.source_kind as "official"} /></td>
                    <td className="px-2 py-1.5">
                      {a.last_status === "ok" && !stale && <Pill tone="green">OK</Pill>}
                      {a.last_status === "ok_with_warnings" && !stale && <Pill tone="amber">OK, {warnings.length} warning(s)</Pill>}
                      {stale && <Pill tone="amber">Stale</Pill>}
                      {a.last_status === "error" && <Pill tone="red">Error</Pill>}
                      {a.last_status === "not_configured" && <Pill>Needs {a.requires_env}</Pill>}
                      {!a.last_status && <Pill>Never run</Pill>}
                      {a.last_error && <div className="mt-0.5 max-w-xs text-rose-700">{a.last_error}</div>}
                    </td>
                    <td className="px-2 py-1.5"><Freshness at={a.last_success} label="" /></td>
                    <td className="px-2 py-1.5 tabular-nums">{a.record_count.toLocaleString()}</td>
                    <td className="max-w-lg px-2 py-1.5 text-slate-600">
                      {a.coverage}
                      {warnings.length > 0 && (
                        <details className="mt-1"><summary className="cursor-pointer text-amber-700">Warnings</summary><ul className="list-disc pl-4">{warnings.slice(0, 20).map((w) => <li key={w}>{w}</li>)}</ul></details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Curated datasets">
          <Panel className="p-3 text-xs">
            <table className="w-full">
              <tbody>
                {kinds.map(([k, label, expected]) => {
                  const rows = byKind(k as "bill");
                  const st = new Set(rows.map((r) => r.state)).size;
                  const low = rows.filter((r) => r.confidence === "low").length;
                  return (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="py-1">{label}</td>
                      <td className="py-1 text-right tabular-nums">{rows.length}{expected ? ` / ${expected}` : ""}</td>
                      <td className="py-1 pl-3 text-slate-500">{st} jurisdictions</td>
                      <td className="py-1 pl-3 text-slate-500">{low ? `${low} low-confidence` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-slate-500">
              Seed files: {Object.keys(SEED_FILES).map((f) => (seedFiles.some((x) => x.startsWith(f.replace(".json", ""))) ? `✓ ${f}` : `✗ ${f} (pending)`)).join(" · ")}
            </p>
            <p className="mt-1 text-slate-500">{states.size} of 51 jurisdictions have at least one curated record.</p>
          </Panel>
        </Section>

        <Section title={`News feeds monitored (${FEEDS.length})`}>
          <Panel className="p-3 text-xs">
            <ul className="columns-2 gap-4">
              {FEEDS.map((f) => (
                <li key={f.id} className="break-inside-avoid"><a href={f.url} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300">{f.outlet}</a> <span className="text-slate-400">{f.mode}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-slate-500">
              Excluded: outlets whose feeds block automated access (several States Newsroom sites, KERA, WABE). Those blocks are respected, not
              worked around.
            </p>
          </Panel>
        </Section>
      </div>

      <Section title="Evaluated but not integrated">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <tbody>
              {PENDING_SOURCES.map((s) => (
                <tr key={s.name} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5"><a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-slate-300">{s.name}</a></td>
                  <td className="px-2 py-1.5"><Pill tone={s.status === "Needs API key" ? "amber" : "slate"}>{s.status}</Pill></td>
                  <td className="px-2 py-1.5 text-slate-600">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </Page>
  );
}
