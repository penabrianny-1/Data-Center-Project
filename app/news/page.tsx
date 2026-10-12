import { connection } from "next/server";
import { Suspense } from "react";
import NewsBrowser from "@/components/NewsBrowser";
import { Freshness, Page } from "@/components/ui";
import { EXCLUDED_OUTLETS, FEEDS } from "@/lib/adapters/news";
import { getAdapter, getNews } from "@/lib/repo";

export const metadata = { title: "Live news" };

export default async function NewsPage() {
  await connection();
  const items = getNews();
  const adapter = getAdapter("news-feeds");
  return (
    <Page
      title="Live news"
      subtitle={
        <>
          Data-center coverage from {FEEDS.length} feeds: national and business press, public media, local newspapers, nonprofit newsrooms and trade press. Feeds refresh hourly, and every story is categorized automatically.{" "}
          <Freshness at={adapter?.last_success} label="Last refresh" />
        </>
      }
    >
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-slate-100" />}>
        <NewsBrowser items={items} outlets={FEEDS.map((f) => ({ id: f.id, outlet: f.outlet, type: f.type, home: f.home }))} excluded={EXCLUDED_OUTLETS} />
      </Suspense>
    </Page>
  );
}
