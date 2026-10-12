import { fetchAafFeed } from "../aaf";
import type { Adapter } from "../ingest/types";

export const aafAdapter: Adapter = {
  id: "aaf",
  name: "American Action Forum research",
  url: "https://www.americanactionforum.org",
  sourceKind: "research",
  method: "search-index",
  schedule: "Hourly (live in app) / daily (ingest)",
  refreshMinutes: 180,
  coverage:
    "AAF analysis that mentions data centers or hyperscale facilities, found through AAF's public site-search index, with a fallback that scans its sitemaps. AAF's REST API and RSS feed are disabled. This is a single think tank's output, not comprehensive news coverage.",
  async run() {
    const feed = await fetchAafFeed();
    return {
      entities: feed.articles.map((a) => ({
        id: `article:${a.id}`,
        kind: "article" as const,
        state: "US",
        title: a.title,
        date: a.date.slice(0, 10),
        status: a.relevance,
        searchText: `${a.excerpt} ${a.author ?? ""} ${a.type}`,
        sources: [{ title: a.title, url: a.url, publisher: "American Action Forum", kind: "research" as const, published: a.date.slice(0, 10) }],
        confidence: "high" as const,
        data: a,
      })),
      warnings: feed.method === "scrape" ? ["Algolia search index unavailable; used sitemap scrape (narrower coverage)"] : [],
    };
  },
};
