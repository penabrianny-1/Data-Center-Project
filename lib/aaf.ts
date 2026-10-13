/**
 * Fetches data-center coverage from the American Action Forum
 * (americanactionforum.org).
 *
 * AAF disables its WordPress REST API and RSS feed, so we use two strategies:
 *   1. Algolia — the search index that powers AAF's own on-site search, queried
 *      with the public search-only key embedded in their search page.
 *   2. Scrape — fallback that walks AAF's XML sitemaps and reads article pages.
 *
 * This module is framework-agnostic so it can run from both Next.js and the
 * `npm run fetch:aaf` CLI script.
 */
import * as cheerio from "cheerio";
import type { Article, ArticleFeed } from "./types";

const BASE = "https://www.americanactionforum.org";
const HTTP_CLIENT_ID = "DataCenterTracker/0.1 (news aggregator)";

// Values from AAF's search page; refreshed at runtime when possible.
const ALGOLIA_DEFAULTS = {
  appId: "998F8RLS2D",
  apiKey: "5e8369fe9b2c587095aa7e89bc6b3c39",
  index: "wp_searchable_posts_post_date_desc",
};

const QUERIES = ['"data center"', '"data centers"', "hyperscale"];
const MENTION_RE = /\bdata[- ]?cent(?:er|re)s?\b|\bhyperscal(?:e|er|ers)\b/gi;

/** Below this many mentions (and none in the title) an article is a passing reference. */
const PRIMARY_MIN_MENTIONS = 4;

// ---------------------------------------------------------------------------
// Helpers

async function get(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": HTTP_CLIENT_ID, ...init?.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

function countMentions(text: string): number {
  return text.match(MENTION_RE)?.length ?? 0;
}

function decodeEntities(s: string): string {
  return cheerio.load(`<p>${s}</p>`)("p").text();
}

function makeExcerpt(text: string, max = 260): string {
  const clean = decodeEntities(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, clean.lastIndexOf(" ", max)) + "…";
}

function classify(title: string, mentions: number): Article["relevance"] {
  MENTION_RE.lastIndex = 0;
  return MENTION_RE.test(title) || mentions >= PRIMARY_MIN_MENTIONS
    ? "primary"
    : "mention";
}

/**
 * AAF often publishes the same piece as both an Insight and a Press Release.
 * Keep one entry per title, preferring non-press-release types.
 */
function dedupe(articles: Article[]): Article[] {
  const byTitle = new Map<string, Article>();
  for (const a of articles) {
    const key = a.title.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byTitle.get(key);
    if (!existing || (existing.type === "Press Release" && a.type !== "Press Release")) {
      byTitle.set(key, a);
    }
  }
  return [...byTitle.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// Strategy 1: Algolia

interface AlgoliaHit {
  post_id: number;
  post_type_label: string;
  post_title: string;
  post_date: number;
  permalink: string;
  content: string;
  record_index: number;
  acf_authors?: string[];
  post_author?: { display_name?: string };
}

/** Read the current public Algolia config from AAF's search page, if available. */
async function discoverAlgoliaConfig() {
  try {
    const html = await (await get(`${BASE}/?s=data+center`)).text();
    const appId = html.match(/"application_id":"([^"]+)"/)?.[1];
    const apiKey = html.match(/"search_api_key":"([^"]+)"/)?.[1];
    if (appId && apiKey) return { ...ALGOLIA_DEFAULTS, appId, apiKey };
  } catch {
    // fall through to defaults
  }
  return ALGOLIA_DEFAULTS;
}

export async function fetchViaAlgolia(): Promise<Article[]> {
  const { appId, apiKey, index } = await discoverAlgoliaConfig();
  const endpoint = `https://${appId}-dsn.algolia.net/1/indexes/*/queries`;

  const res = await get(endpoint, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": appId,
      "X-Algolia-API-Key": apiKey,
      "Content-Type": "application/json",
      Referer: `${BASE}/`,
    },
    body: JSON.stringify({
      requests: QUERIES.map((query) => ({
        indexName: index,
        params: new URLSearchParams({
          query,
          advancedSyntax: "true",
          // Articles are split into ~2k-char records; fetch every chunk so we
          // can count mentions across the whole article.
          distinct: "false",
          hitsPerPage: "1000",
          attributesToRetrieve: JSON.stringify([
            "post_id", "post_type_label", "post_title", "post_date",
            "permalink", "content", "record_index", "acf_authors", "post_author",
          ]),
          attributesToHighlight: "[]",
          attributesToSnippet: "[]",
        }).toString(),
      })),
    }),
  });

  const { results } = (await res.json()) as { results: { hits: AlgoliaHit[] }[] };

  // Group chunks by post; dedupe chunks that matched multiple queries.
  const posts = new Map<number, Map<number, AlgoliaHit>>();
  for (const hit of results.flatMap((r) => r.hits)) {
    if (!posts.has(hit.post_id)) posts.set(hit.post_id, new Map());
    posts.get(hit.post_id)!.set(hit.record_index, hit);
  }

  const articles: Article[] = [];
  for (const chunks of posts.values()) {
    const sorted = [...chunks.values()].sort((a, b) => a.record_index - b.record_index);
    const first = sorted[0];
    const title = decodeEntities(first.post_title);
    const mentions =
      countMentions(title) + sorted.reduce((n, c) => n + countMentions(c.content ?? ""), 0);
    if (mentions === 0) continue;

    articles.push({
      id: `aaf-${first.post_id}`,
      title,
      url: first.permalink,
      date: new Date(first.post_date * 1000).toISOString(),
      type: first.post_type_label,
      author: first.acf_authors?.join(", ") || first.post_author?.display_name || null,
      excerpt: makeExcerpt(first.record_index === 0 ? first.content : ""),
      mentions,
      relevance: classify(title, mentions),
    });
  }
  return dedupe(articles);
}

// ---------------------------------------------------------------------------
// Strategy 2: Sitemap scrape

/** Post types worth scanning, keyed by sitemap prefix. */
const SITEMAP_TYPES: Record<string, string> = {
  insight: "Insight",
  research: "Research",
  "daily-dish": "The Daily Dish",
  "weekly-checkup": "Weekly Checkup",
  testimony: "Testimony",
  oped: "Op-Ed",
  shipment: "The Shipment",
  "week-in-regulation": "Week in Regulation",
};

interface ScrapeOptions {
  /** Only consider URLs modified within this many days. */
  maxAgeDays?: number;
  /** Hard cap on article pages fetched. */
  maxPages?: number;
  concurrency?: number;
}

export async function fetchViaScrape({
  maxAgeDays = 180,
  maxPages = 200,
  concurrency = 4,
}: ScrapeOptions = {}): Promise<Article[]> {
  const indexXml = await (await get(`${BASE}/sitemap_index.xml`)).text();
  const sitemapUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  // For each post type, the highest-numbered sitemap holds the newest posts.
  const latestPerType = new Map<string, string>();
  for (const url of sitemapUrls) {
    const m = url.match(/\/([a-z-]+?)-sitemap(\d*)\.xml$/);
    if (!m || !(m[1] in SITEMAP_TYPES)) continue;
    const prev = latestPerType.get(m[1]);
    const num = (u: string) => Number(u.match(/sitemap(\d*)\.xml$/)?.[1] || 1);
    if (!prev || num(url) > num(prev)) latestPerType.set(m[1], url);
  }

  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const candidates: { url: string; type: string; lastmod: number }[] = [];
  for (const [prefix, sitemap] of latestPerType) {
    const xml = await (await get(sitemap)).text();
    for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      const lastmod = Date.parse(block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "");
      if (loc && lastmod >= cutoff) {
        candidates.push({ url: loc, type: SITEMAP_TYPES[prefix], lastmod });
      }
    }
  }
  candidates.sort((a, b) => b.lastmod - a.lastmod);
  const queue = candidates.slice(0, maxPages);

  const articles: Article[] = [];
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const article = await scrapeArticle(c.url, c.type);
        if (article) articles.push(article);
      } catch {
        // skip pages that fail; one bad page shouldn't sink the feed
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return dedupe(articles);
}

async function scrapeArticle(url: string, type: string): Promise<Article | null> {
  const $ = cheerio.load(await (await get(url)).text());
  const title = ($('meta[property="og:title"]').attr("content") ?? $("title").text())
    .replace(/\s*-\s*AAF\s*$/, "")
    .trim();
  const date =
    $('meta[property="article:published_time"]').attr("content") ??
    $('script[type="application/ld+json"]').text().match(/"datePublished":"([^"]+)"/)?.[1];

  $("script, style, nav, header, footer").remove();
  const body = $("main").text() || $("body").text();
  const mentions = countMentions(title) + countMentions(body);
  if (mentions === 0) return null;

  const authorSlug = $('a[href*="/experts/"]').first().attr("href")?.match(/experts\/([^/?#]+)/)?.[1];
  const author = authorSlug
    ? authorSlug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
    : null;

  return {
    id: `aaf-${url.replace(/\/$/, "").split("/").pop()}`,
    title,
    url,
    date: date ? new Date(date).toISOString() : new Date().toISOString(),
    type,
    author,
    excerpt: makeExcerpt($('meta[property="og:description"]').attr("content") ?? ""),
    mentions,
    relevance: classify(title, mentions),
  };
}

// ---------------------------------------------------------------------------

/** Algolia first, sitemap scrape as fallback. Throws only if both fail. */
export async function fetchAafFeed(): Promise<ArticleFeed> {
  try {
    const articles = await fetchViaAlgolia();
    if (articles.length > 0) {
      return { articles, fetchedAt: new Date().toISOString(), method: "algolia" };
    }
    console.warn("[aaf] Algolia returned no articles; falling back to scrape");
  } catch (err) {
    console.warn("[aaf] Algolia failed; falling back to scrape:", err);
  }
  const articles = await fetchViaScrape();
  return { articles, fetchedAt: new Date().toISOString(), method: "scrape" };
}
