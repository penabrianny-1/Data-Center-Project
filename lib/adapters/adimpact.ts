import * as cheerio from "cheerio";
import type { Adapter, Entity } from "../ingest/types";
import { stateNamesIn } from "../geo-text";

/**
 * AdImpact's PUBLIC analyses (blog posts and press notes, allowed by its
 * robots.txt). AdImpact's ad-reservation database is a paid product and is
 * not accessed. This adapter only links to and briefly quotes the figures
 * AdImpact itself publishes (e.g. "Senate battlegrounds saw $935M in aired
 * advertising through 9/30").
 */

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const POLITICAL = /\b(senate|house|governor|gubernatorial|congress|midterm|political|campaign|super pac|ballot|primary|election|republican|democrat)/i;

export function parsePost(html: string, url: string) {
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr("content") ?? $("h1").first().text()).trim();
  $("script, style, nav, footer, header").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  // "Written by: Josh Getz blog-post Oct 01, 2026 · 2 minute read"
  const m = text.match(/Written by:\s*([^·]+?)\s+[a-z-]*\s*([A-Z][a-z]{2})\.?\s+(\d{1,2}),\s+(20\d{2})/);
  const date = m && MONTHS[m[2]] ? `${m[4]}-${MONTHS[m[2]]}-${m[3].padStart(2, "0")}` : null;
  const author = m?.[1]?.trim() ?? null;
  // Article body starts after the byline ("… · 2 minute read"); related-post lists come later and are excluded.
  const by = text.search(/Written by:/);
  const read = by >= 0 ? text.indexOf("minute read", by) : -1;
  let body = read >= 0 ? text.slice(read + "minute read".length) : text;
  const related = body.search(/\b(Related (Posts|Articles)|More from AdImpact|In The News •|Blog •)/);
  if (related > 200) body = body.slice(0, related);
  const figures = [...new Set((body.match(/[^.]{0,180}\$[\d.,]+\s?(?:million|billion|M|B|K)\b[^.]{0,160}\./g) ?? []).map((s) => s.trim()))]
    .filter((s) => !/In The News|Blog •|Subscribe|cookie/i.test(s))
    .slice(0, 8);
  return { title, date, author, url, figures, states: stateNamesIn(`${title} ${figures.join(" ")}`) };
}

export const adImpactAdapter: Adapter = {
  id: "adimpact",
  name: "AdImpact published analyses (public posts)",
  url: "https://adimpact.com/blogs",
  sourceKind: "research",
  method: "html",
  schedule: "Daily",
  refreshMinutes: 1440,
  coverage:
    "Spending figures that AdImpact publishes in its public 2025–26 political posts: aired and reserved ad totals by race, party and battleground, with short quotes linked to the source. AdImpact's full reservation database (by station, flight and advertiser) is a paid subscription and isn't included.",
  async run({ fetch, log }) {
    const sitemap = await (await fetch("https://adimpact.com/sitemap.xml")).text();
    const urls = [...sitemap.matchAll(/<loc>(https:\/\/adimpact\.com\/blogs\/(?!blog\/)[^<]+)<\/loc>/g)].map((m) => m[1]);
    const entities: Entity[] = [];
    for (const url of urls) {
      try {
        const p = parsePost(await (await fetch(url)).text(), url);
        if (!p.date || p.date < "2025-01-01" || !POLITICAL.test(`${p.title} ${p.figures.join(" ")}`)) continue;
        entities.push({
          id: `adimpact:${url.split("/").pop()}`,
          kind: "article",
          state: p.states.length === 1 ? p.states[0] : "US",
          title: p.title,
          date: p.date,
          status: "adimpact",
          searchText: p.figures.join(" "),
          sources: [{ title: p.title, url, publisher: "AdImpact", kind: "research", published: p.date, excerpt: p.figures[0]?.slice(0, 380) }],
          confidence: "medium",
          data: p,
        });
      } catch {
        // skip unreadable posts
      }
    }
    log(`AdImpact: ${urls.length} posts checked, ${entities.length} political posts from 2025–26`);
    return { entities };
  },
};
