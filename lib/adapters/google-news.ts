import * as cheerio from "cheerio";
import { sha } from "../db";
import type { Adapter, Entity } from "../ingest/types";
import { outletTypeFor, type OutletType } from "../outlets";
import { STATES } from "../states";
import { tagStates } from "./news";

/**
 * Per-state Google News search feeds ("data center" + state, last 30 days),
 * the approach datacenterbans.com uses for its state news lists. Included at
 * the user's direction even though Google's robots.txt disallows automated
 * access to /rss. Links route through news.google.com to the publisher.
 *
 * Items are kept only from identifiable publishers: aggregators, user-generated
 * platforms, press-release wires (labeled separately) and AI content portals
 * are classified or dropped so the state lists stay reputable.
 */

const searchName = (name: string) => (name === "Washington" ? "Washington state" : name === "District of Columbia" ? "Washington, D.C." : name);

export function googleNewsUrl(stateName: string): string {
  const q = `("data center" OR "data centers") "${searchName(stateName)}" when:30d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

export interface GoogleNewsItem {
  title: string;
  url: string;
  published: string | null;
  outlet: string;
  publisherDomain: string;
  outletType: OutletType;
}

export function parseGoogleNews(xml: string): GoogleNewsItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const out: GoogleNewsItem[] = [];
  $("item").each((_, el) => {
    const n = $(el);
    const src = n.find("source").first();
    const outlet = src.text().trim();
    let domain = "";
    try {
      domain = new URL(src.attr("url") ?? "").hostname;
    } catch {
      return;
    }
    const type = outletTypeFor(domain);
    if (!type || !outlet) return;
    const rawTitle = n.find("title").first().text().trim();
    const title = rawTitle.endsWith(` - ${outlet}`) ? rawTitle.slice(0, -(outlet.length + 3)) : rawTitle;
    const link = n.find("link").first().text().trim();
    const t = Date.parse(n.find("pubDate").first().text());
    if (!title || !/^https?:\/\//.test(link)) return;
    out.push({ title, url: link, published: Number.isFinite(t) ? new Date(t).toISOString() : null, outlet, publisherDomain: domain.replace(/^www\./, ""), outletType: type });
  });
  return out;
}

const RELEVANT = /\bdata[- ]?cent(?:er|re)s?\b|\bhyperscal\w*/i;

export const googleNewsAdapter: Adapter = {
  id: "google-news",
  name: "Google News: per-state data-center search",
  url: "https://news.google.com/",
  sourceKind: "aggregator",
  method: "api",
  schedule: "Every 3 hours",
  refreshMinutes: 180,
  appendOnly: true,
  coverage:
    "For each state and DC, a Google News search for data-center stories naming the state in the last 30 days. It finds national, local, public-media and government (.gov) items, much as datacenterbans.com does. Publishers are identified from Google's source tag. Aggregators, social and user-generated platforms, finance content farms and AI portals are dropped; press-release wires are labeled. Links redirect through news.google.com. Google's robots.txt disallows automated /rss access, so this source can be blocked without notice.",
  async run({ fetch, log }) {
    const items = new Map<string, Entity>();
    const warnings: string[] = [];
    let ok = 0;
    for (const st of STATES) {
      try {
        const xml = await (await fetch(googleNewsUrl(st.name), { retries: 1 })).text();
        ok++;
        for (const it of parseGoogleNews(xml)) {
          if (!RELEVANT.test(it.title)) continue;
          const key = sha(`${it.title.toLowerCase()}|${it.outlet.toLowerCase()}`);
          const prev = items.get(key);
          const states = new Set([st.code, ...tagStates(it.title), ...((prev?.data as { states?: string[] })?.states ?? [])]);
          items.set(key, {
            id: `news:gn-${key}`,
            kind: "article",
            state: st.code,
            title: it.title,
            date: it.published?.slice(0, 10) ?? null,
            status: "general",
            searchText: `${it.outlet} ${it.publisherDomain} ${[...states].join(" ")}`,
            sources: [{ title: it.title, url: it.url, publisher: it.outlet, kind: it.outletType === "government" ? "official" : "journalism", published: it.published?.slice(0, 10) }],
            confidence: null,
            data: { ...it, summary: "", states: [...states], policySignal: false, via: "Google News", feedId: "google-news", source: "news" },
          });
        }
      } catch (err) {
        warnings.push(`${st.code}: ${(err as Error).message}`);
      }
    }
    log(`Google News: ${ok}/${STATES.length} state searches OK, ${items.size} stories`);
    if (ok === 0) throw new Error(`All Google News requests failed: ${warnings[0]}`);
    return { entities: [...items.values()], warnings };
  },
};
