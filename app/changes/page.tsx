import { connection } from "next/server";
import ChangeFeed from "@/components/ChangeFeed";
import { Page } from "@/components/ui";
import { getBaselineCounts, getChanges } from "@/lib/repo";

export const metadata = { title: "What changed" };

export default async function ChangesPage() {
  await connection();
  const changes = getChanges(500);
  const baselines = getBaselineCounts();
  return (
    <Page
      title="What changed"
      subtitle="An auditable log of every record added, updated or removed by each refresh. Unchanged records are never shown again as new. Each source's first-ever load is a baseline and is summarized, not listed."
    >
      <ChangeFeed changes={changes} />
      <p className="mt-3 text-xs text-slate-500">
        Baselines: {baselines.map((b) => `${b.adapter} (${b.added} records, ${b.started.slice(0, 10)})`).join(" · ")}
      </p>
    </Page>
  );
}
