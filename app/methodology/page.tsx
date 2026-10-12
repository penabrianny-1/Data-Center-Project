import Link from "next/link";
import { Evidence, Page, Panel, Section } from "@/components/ui";
import { DIMENSION_KEYS, DIMENSION_META } from "@/lib/scoring";

export const metadata = { title: "Methodology" };

export default function MethodologyPage() {
  return (
    <Page title="Methodology" subtitle="How records are collected, labeled, scored and kept current.">
      <div className="grid gap-4 text-sm text-slate-800 xl:grid-cols-2">
        <Section title="Evidence labels">
          <Panel className="space-y-1.5 p-3 text-xs">
            <p><Evidence type="fact" /> Backed by an official record: statute, bill page, order, filing or government dataset.</p>
            <p><Evidence type="reported" /> Reported by credible journalism; the official record wasn&apos;t independently confirmed.</p>
            <p><Evidence type="analysis" /> An interpretation drawn from documented evidence, such as &quot;why it matters&quot;, dimension scores or committee relevance.</p>
            <p><Evidence type="forecast" /> A forward-looking estimate. None are shown unless a documented method supports them.</p>
            <p><Evidence type="scenario" /> A conditional what-if with explicit assumptions. It isn&apos;t a prediction.</p>
            <p className="pt-1 text-slate-600">Candidate positions are marked <em>explicit</em> only when the candidate addressed data centers directly. Otherwise they&apos;re <em>inferred</em> from broader energy or economic positions, and party is never used as a stand-in.</p>
          </Panel>
        </Section>
        <Section title="Provenance & freshness">
          <Panel className="space-y-1.5 p-3 text-xs">
            <p>Every record stores its sources (typed as official, data, journalism, research or aggregator), last-verified date, confidence and caveats. Automated records also store a retrieval timestamp.</p>
            <p>Each record needs at least one non-aggregator source. Wikipedia, other wikis, forums and AI-generated content sites are rejected at validation.</p>
            <p>Material changes are kept: the prior version goes to history, and every addition, update or removal is written to the <Link href="/changes" className="underline">change log</Link>.</p>
            <p>Sources update on their own schedules. Nothing is labeled real-time unless the source is. See <Link href="/sources" className="underline">Sources & coverage</Link> for each adapter&apos;s cadence and last success.</p>
          </Panel>
        </Section>
        <Section title="Policy score">
          <Panel className="p-3 text-xs">
            <p>Researchers assign each of the ten dimensions an integer from −2 (strongly constrains development) to +2 (strongly favors it), based on cited indicators. A dimension with too little evidence is left blank (null) and never guessed.</p>
            <p className="mt-1">Composite = Σ(weight × score) / Σ(weight over scored dimensions), rescaled from [−2, 2] to [0, 100]. Completeness = scored weight ÷ total weight. Both are always shown together.</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {DIMENSION_KEYS.map((k) => <li key={k}><span className="font-medium">{DIMENSION_META[k].label}:</span> {DIMENSION_META[k].description}</li>)}
            </ul>
            <p className="mt-2 text-slate-600">Correlation isn&apos;t causation. Power availability, land, transmission, water, labor and local opposition all shape outcomes alongside policy.</p>
          </Panel>
        </Section>
        <Section title="Automation">
          <Panel className="space-y-1.5 p-3 text-xs">
            <p>While the app server runs, a scheduler checks every 10 minutes for due sources and refreshes them in a separate process: news hourly, AAF every 3 hours, gas prices every 6–12 hours, FEC every 12 hours, and Congress and federal bill status daily. Overlapping runs are prevented by a lock file.</p>
            <p>Curated research files (races, policy, commissions, bills, local actions) are re-validated and re-ingested hourly, so edits show up without a restart. Re-verifying those facts against the world still takes research, and each record carries its verified date.</p>
            <p>Manual run: <code className="rounded bg-slate-100 px-1">npm run ingest</code> (all), or <code className="rounded bg-slate-100 px-1">npm run ingest -- --due</code>.</p>
          </Panel>
        </Section>
      </div>
    </Page>
  );
}
