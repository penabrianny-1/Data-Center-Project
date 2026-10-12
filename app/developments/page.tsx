import { connection } from "next/server";
import DevelopmentFeed from "@/components/DevelopmentFeed";
import { Empty, Evidence, Page } from "@/components/ui";
import { getDevelopments } from "@/lib/repo";

export const metadata = { title: "Priority developments" };

export default async function DevelopmentsPage() {
  await connection();
  const devs = getDevelopments();
  return (
    <Page
      title="Priority developments"
      subtitle={
        <>
          Ranked by consequence for data-center development, not by recency. Severity 5 changes feasibility across a major market;
          1 is a minor signal. &quot;What happened&quot; is sourced fact; &quot;why it matters&quot; and &quot;watch next&quot; are <Evidence type="analysis" />.
        </>
      }
    >
      {devs.length ? <DevelopmentFeed items={devs.map((d) => ({ id: d.id, data: d.data, sources: d.sources }))} /> : <Empty title="Not yet researched" />}
    </Page>
  );
}
