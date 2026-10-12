import { connection } from "next/server";
import StatesTable, { type StateRow } from "@/components/StatesTable";
import { Page } from "@/components/ui";
import { buildMapData } from "@/lib/layers";

export const metadata = { title: "States" };

export default async function StatesIndex() {
  await connection();
  const { layers, summaries } = buildMapData();
  const coverage = layers.find((l) => l.id === "coverage")!;
  const rows: StateRow[] = Object.values(summaries).map((s) => ({
    ...s,
    coverage: Number(coverage.cells[s.code]?.detail.match(/^(\d)/)?.[1] ?? 0),
  }));
  return (
    <Page title="States" subtitle="Every state and DC, side by side. Click a column to sort; click a state for its full profile.">
      <StatesTable rows={rows} />
    </Page>
  );
}
