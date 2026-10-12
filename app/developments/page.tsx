import { connection } from "next/server";
import DevelopmentFeed from "@/components/DevelopmentFeed";
import { Empty, Page } from "@/components/ui";
import { getDevelopments } from "@/lib/repo";

export const metadata = { title: "Priority developments" };

export default async function DevelopmentsPage() {
  await connection();
  const devs = getDevelopments();
  return (
    <Page
      title="Priority developments"
      subtitle="The most consequential changes, ranked by impact (5 = biggest)."
    >
      {devs.length ? <DevelopmentFeed items={devs.map((d) => ({ id: d.id, data: d.data, sources: d.sources }))} /> : <Empty title="Not yet researched" />}
    </Page>
  );
}
