import { connection } from "next/server";
import CompareTool, { type CompareRow } from "@/components/CompareTool";
import { Empty, Evidence, Page } from "@/components/ui";
import { getPolicies } from "@/lib/repo";
import { stateName } from "@/lib/states";

export const metadata = { title: "Compare & score" };

export default async function ComparePage() {
  await connection();
  const rows: CompareRow[] = getPolicies().map((p) => ({
    code: p.state!,
    name: stateName(p.state!),
    confidence: p.data.confidence,
    dimensions: Object.fromEntries(
      Object.entries(p.data.dimensions).map(([k, d]) => [k, { score: d.score, confidence: d.confidence, rationale: d.rationale }]),
    ),
  }));
  return (
    <Page
      title="Compare & score"
      subtitle={
        <>
          A transparent, adjustable composite across 10 policy dimensions. Each dimension score (−2 to +2) was assigned from cited
          indicators on the state profile. Weights are yours to set. <Evidence type="analysis" /> This ranks policy environments,
          not sites: it leaves out land prices, labor, fiber and physical water supply.
        </>
      }
    >
      {rows.length ? <CompareTool rows={rows} /> : <Empty title="Policy dataset not yet ingested" />}
    </Page>
  );
}
