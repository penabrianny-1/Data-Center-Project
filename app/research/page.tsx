import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import ResearchList from "@/components/ResearchList";
import { Page } from "@/components/ui";
import { getFeed } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "AAF research",
};

export default async function ResearchPage() {
  await connection();
  return (
    <Page title="AAF research" subtitle="American Action Forum analysis on data centers, AI infrastructure and the power grid. One think tank's output (research, not news), shown for its policy analysis.">
      <Suspense fallback={<div className="animate-pulse bg-slate-100 rounded-xl h-96" />}>
        <Feed />
      </Suspense>
    </Page>
  );
}

async function Feed() {
  const feed = await getFeed();
  return (
    <>
      <ResearchList articles={feed.articles} />
      <p className="mt-6 text-xs text-slate-400">
        Fetched {formatDate(feed.fetchedAt, { month: "short", hour: "numeric", minute: "2-digit" })} ET via{" "}
        {feed.method}. “Focused” shows articles with “data center” in the title or at least four mentions.
      </p>
    </>
  );
}
