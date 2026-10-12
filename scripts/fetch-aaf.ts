/**
 * Fetch AAF data-center coverage and write data/aaf-snapshot.json.
 * The snapshot is the app's last-resort fallback when live fetching fails.
 *
 *   npm run fetch:aaf              # Algolia, then scrape fallback
 *   npm run fetch:aaf -- --scrape  # force the sitemap scraper
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchAafFeed, fetchViaScrape } from "../lib/aaf";
import type { ArticleFeed } from "../lib/types";

async function main() {
  const started = Date.now();
  const feed: ArticleFeed = process.argv.includes("--scrape")
    ? { articles: await fetchViaScrape(), fetchedAt: new Date().toISOString(), method: "scrape" }
    : await fetchAafFeed();

  mkdirSync("data", { recursive: true });
  writeFileSync("data/aaf-snapshot.json", JSON.stringify(feed, null, 2) + "\n");

  const primary = feed.articles.filter((a) => a.relevance === "primary");
  console.log(
    `${feed.method}: ${feed.articles.length} articles (${primary.length} primary) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  for (const a of primary.slice(0, 10)) {
    console.log(`  ${a.date.slice(0, 10)}  [${a.type}] ${a.title} (${a.mentions})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
