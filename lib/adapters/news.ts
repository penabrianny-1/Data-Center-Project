import * as cheerio from "cheerio";
import { sha } from "../db";
import type { Adapter, Entity } from "../ingest/types";
import type { OutletType } from "../outlets";
import { STATES } from "../states";

/**
 * Credible newsroom feeds. Every feed here was verified reachable and is
 * permitted by the site's robots.txt, except where a publisher offers an RSS
 * feed explicitly for subscription (CNBC), which is the use RSS exists for.
 * Excluded, and documented on the Sources page: Reuters and Google News
 * (robots.txt disallows automated access), McClatchy "Bee" papers and
 * several States Newsroom sites (block automated requests).
 *
 *   tag     — the newsroom's own "data centers" topic feed (editorially curated)
 *   search  — the site's own search results as RSS for "data center"
 *   general — a section feed, keyword-filtered here
 *   sitemap — a Google News sitemap (headline + date), keyword-filtered here
 */
export interface Feed {
  id: string;
  outlet: string;
  url: string;
  home: string;
  /** Home state for regional outlets (used for state tagging) */
  state?: string;
  type: OutletType;
  mode: "tag" | "search" | "general" | "sitemap" | "official";
}

const tag = (id: string, outlet: string, host: string, state: string): Feed => ({
  id, outlet, url: `https://${host}/tags/data-centers.rss`, home: `https://${host}/`, state, type: "public_media", mode: "tag",
});
const wpSearch = (id: string, outlet: string, host: string, state?: string, type: Feed["type"] = "nonprofit_news"): Feed => ({
  id, outlet, url: `https://${host}/?s=data+center&feed=rss2`, home: `https://${host}/`, state, type, mode: "search",
});
/** BLOX CMS (Lee Enterprises and others) newest-first site search as RSS. */
const blox = (id: string, outlet: string, host: string, state: string): Feed => ({
  id, outlet, url: `https://${host}/search/?f=rss&q=data+center&s=start_time&sd=desc`, home: `https://${host}/`, state, type: "local_news", mode: "search",
});
/** Advance Local / Arc XP site-wide RSS. */
const arc = (id: string, outlet: string, host: string, state: string): Feed => ({
  id, outlet, url: `https://${host}/arc/outboundfeeds/rss/?outputType=xml`, home: `https://${host}/`, state, type: "local_news", mode: "general",
});
const section = (id: string, outlet: string, url: string, home: string, type: Feed["type"], state?: string): Feed => ({ id, outlet, url, home, type, state, mode: "general" });
/** Governor's office newsroom (official). Matched on data-center and energy/AI policy terms, not data centers alone. */
const governor = (code: string, name: string, url: string): Feed => ({
  id: `gov-${code.toLowerCase()}`, outlet: `${name} Office of the Governor`, url, home: new URL(url).origin + "/", state: code, type: "government", mode: "official",
});
const cnbc = (id: string, label: string, sectionId: string): Feed =>
  section(id, `CNBC (${label})`, `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=${sectionId}`, "https://www.cnbc.com/", "business_news");

export const FEEDS: Feed[] = [
  // --- National & business press (section feeds, keyword-filtered)
  cnbc("cnbc-top", "Top News", "100003114"),
  cnbc("cnbc-business", "Business", "10001147"),
  cnbc("cnbc-tech", "Technology", "19854910"),
  cnbc("cnbc-energy", "Energy", "19836768"),
  cnbc("cnbc-politics", "Politics", "10000113"),
  section("politico-energy", "Politico (Energy)", "https://rss.politico.com/energy.xml", "https://www.politico.com/", "national_news"),
  section("politico-politics", "Politico (Politics)", "https://rss.politico.com/politics-news.xml", "https://www.politico.com/", "national_news"),
  section("politico-congress", "Politico (Congress)", "https://rss.politico.com/congress.xml", "https://www.politico.com/", "national_news"),
  { id: "cnn", outlet: "CNN", url: "https://www.cnn.com/sitemap/news.xml", home: "https://www.cnn.com/", type: "national_news", mode: "sitemap" },
  section("ft-tech", "Financial Times (Technology)", "https://www.ft.com/technology?format=rss", "https://www.ft.com/", "business_news"),
  section("ft-energy", "Financial Times (Energy)", "https://www.ft.com/energy?format=rss", "https://www.ft.com/", "business_news"),
  section("ft-companies", "Financial Times (Companies)", "https://www.ft.com/companies?format=rss", "https://www.ft.com/", "business_news"),
  section("ft-us", "Financial Times (US)", "https://www.ft.com/us?format=rss", "https://www.ft.com/", "business_news"),
  section("wapo-business", "The Washington Post (Business)", "https://feeds.washingtonpost.com/rss/business", "https://www.washingtonpost.com/", "national_news"),
  section("wapo-tech", "The Washington Post (Technology)", "https://feeds.washingtonpost.com/rss/business/technology", "https://www.washingtonpost.com/", "national_news"),
  section("wapo-politics", "The Washington Post (Politics)", "https://feeds.washingtonpost.com/rss/politics", "https://www.washingtonpost.com/", "national_news"),
  section("nyt-tech", "The New York Times (Technology)", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "https://www.nytimes.com/", "national_news"),
  section("nyt-business", "The New York Times (Business)", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "https://www.nytimes.com/", "national_news"),
  section("nyt-climate", "The New York Times (Climate)", "https://rss.nytimes.com/services/xml/rss/nyt/Climate.xml", "https://www.nytimes.com/", "national_news"),
  section("hill-energy", "The Hill (Energy & Environment)", "https://thehill.com/policy/energy-environment/feed/", "https://thehill.com/", "national_news"),
  section("hill-tech", "The Hill (Technology)", "https://thehill.com/policy/technology/feed/", "https://thehill.com/", "national_news"),
  section("npr-energy", "NPR (Energy)", "https://feeds.npr.org/1131/rss.xml", "https://www.npr.org/sections/energy/", "public_media"),
  section("pbs-newshour", "PBS News", "https://www.pbs.org/newshour/feeds/rss/headlines", "https://www.pbs.org/newshour/", "public_media"),

  // --- Governors' offices (official communications)
  governor("AL", "Alabama", "https://governor.alabama.gov/feed/"),
  governor("CA", "California", "https://www.gov.ca.gov/feed/"),
  governor("GA", "Georgia", "https://gov.georgia.gov/rss.xml"),
  governor("HI", "Hawaii", "https://governor.hawaii.gov/feed/"),
  governor("MO", "Missouri", "https://governor.mo.gov/rss.xml"),
  governor("NC", "North Carolina", "https://governor.nc.gov/news/feed"),
  governor("ND", "North Dakota", "https://www.governor.nd.gov/rss.xml"),
  governor("NE", "Nebraska", "https://governor.nebraska.gov/rss.xml"),
  governor("RI", "Rhode Island", "https://governor.ri.gov/rss.xml"),
  governor("UT", "Utah", "https://governor.utah.gov/feed/"),
  governor("VT", "Vermont", "https://governor.vermont.gov/rss.xml"),
  governor("WA", "Washington", "https://governor.wa.gov/rss/news.xml"),
  governor("WV", "West Virginia", "https://governor.wv.gov/rss.xml"),

  // --- Public media (NPR/PBS member stations): newsroom-curated data-center tag feeds
  tag("wvia", "WVIA (NE Pennsylvania public media)", "www.wvia.org", "PA"),
  tag("wfae", "WFAE (Charlotte NPR)", "www.wfae.org", "NC"),
  tag("wunc", "WUNC (North Carolina Public Radio)", "www.wunc.org", "NC"),
  tag("lpm", "Louisville Public Media", "www.lpm.org", "KY"),
  tag("kunc", "KUNC (Northern Colorado NPR)", "www.kunc.org", "CO"),
  tag("kcur", "KCUR (Kansas City NPR)", "www.kcur.org", "MO"),
  tag("wfyi", "WFYI (Indianapolis public media)", "www.wfyi.org", "IN"),
  tag("ipm", "Indiana Public Media", "www.ipm.org", "IN"),
  tag("tpr", "Texas Public Radio", "www.tpr.org", "TX"),
  tag("wypr", "WYPR (Baltimore NPR)", "www.wypr.org", "MD"),
  tag("kosu", "KOSU (Oklahoma public media)", "www.kosu.org", "OK"),
  tag("kgou", "KGOU (Oklahoma NPR)", "www.kgou.org", "OK"),
  tag("nhpr", "New Hampshire Public Radio", "www.nhpr.org", "NH"),
  tag("wvxu", "WVXU (Cincinnati NPR)", "www.wvxu.org", "OH"),
  section("kpbs", "KPBS (San Diego public media)", "https://www.kpbs.org/index.rss", "https://www.kpbs.org/", "public_media", "CA"),
  section("laist", "LAist (Southern California Public Radio)", "https://laist.com/index.rss", "https://laist.com/", "public_media", "CA"),
  section("houston-public-media", "Houston Public Media", "https://www.houstonpublicmedia.org/feed/", "https://www.houstonpublicmedia.org/", "public_media", "TX"),
  section("wpr", "Wisconsin Public Radio", "https://www.wpr.org/feed", "https://www.wpr.org/", "public_media", "WI"),

  // --- Local newspapers in key data-center markets (newest-first site search)
  blox("richmond-td", "Richmond Times-Dispatch", "richmond.com", "VA"),
  blox("insidenova", "InsideNoVa (Northern Virginia)", "www.insidenova.com", "VA"),
  blox("daily-progress", "The Daily Progress (Charlottesville)", "dailyprogress.com", "VA"),
  blox("free-lance-star", "The Free Lance-Star (Fredericksburg)", "fredericksburg.com", "VA"),
  blox("roanoke-times", "The Roanoke Times", "roanoke.com", "VA"),
  blox("winston-salem-journal", "Winston-Salem Journal", "journalnow.com", "NC"),
  blox("arizona-daily-star", "Arizona Daily Star (Tucson)", "tucson.com", "AZ"),
  blox("omaha-wh", "Omaha World-Herald", "omaha.com", "NE"),
  blox("stl-post-dispatch", "St. Louis Post-Dispatch", "www.stltoday.com", "MO"),
  blox("buffalo-news", "The Buffalo News", "buffalonews.com", "NY"),
  blox("tulsa-world", "Tulsa World", "tulsaworld.com", "OK"),
  blox("wi-state-journal", "Wisconsin State Journal (Madison)", "madison.com", "WI"),
  blox("lnp", "LNP | LancasterOnline", "lancasteronline.com", "PA"),
  blox("qc-times", "Quad-City Times", "qctimes.com", "IA"),
  blox("wcf-courier", "Waterloo-Cedar Falls Courier", "www.wcfcourier.com", "IA"),
  blox("pantagraph", "The Pantagraph (Bloomington)", "www.pantagraph.com", "IL"),
  blox("nwi-times", "The Times of Northwest Indiana", "www.nwitimes.com", "IN"),
  arc("cleveland", "Cleveland.com / The Plain Dealer", "www.cleveland.com", "OH"),
  arc("pennlive", "PennLive / The Patriot-News", "www.pennlive.com", "PA"),
  arc("njcom", "NJ.com / The Star-Ledger", "www.nj.com", "NJ"),
  arc("mlive", "MLive (Michigan)", "www.mlive.com", "MI"),
  arc("oregonlive", "OregonLive / The Oregonian", "www.oregonlive.com", "OR"),
  arc("alcom", "AL.com", "www.al.com", "AL"),
  section("inquirer", "The Philadelphia Inquirer", "https://www.inquirer.com/arc/outboundfeeds/rss/?outputType=xml", "https://www.inquirer.com/", "local_news", "PA"),
  section("sf-standard", "The San Francisco Standard", "https://sfstandard.com/feed/", "https://sfstandard.com/", "local_news", "CA"),
  section("mission-local", "Mission Local (San Francisco)", "https://missionlocal.org/feed/", "https://missionlocal.org/", "local_news", "CA"),

  // --- Nonprofit newsrooms
  section("calmatters", "CalMatters", "https://calmatters.org/feed/", "https://calmatters.org/", "nonprofit_news", "CA"),
  section("cardinal-news", "Cardinal News (Southwest & Southside Virginia)", "https://cardinalnews.org/feed/", "https://cardinalnews.org/", "nonprofit_news", "VA"),
  wpSearch("georgia-recorder", "Georgia Recorder", "georgiarecorder.com", "GA"),
  wpSearch("indiana-capital-chronicle", "Indiana Capital Chronicle", "indianacapitalchronicle.com", "IN"),
  wpSearch("ohio-capital-journal", "Ohio Capital Journal", "ohiocapitaljournal.com", "OH"),
  wpSearch("grist", "Grist", "grist.org"),
  section("texas-tribune", "The Texas Tribune (Energy)", "https://www.texastribune.org/feeds/topics/energy/", "https://www.texastribune.org/", "nonprofit_news", "TX"),

  // --- Trade press
  section("utility-dive", "Utility Dive", "https://www.utilitydive.com/feeds/news/", "https://www.utilitydive.com/", "trade"),
  section("dcd", "Data Center Dynamics", "https://www.datacenterdynamics.com/en/rss/", "https://www.datacenterdynamics.com/", "trade"),
  section("dck", "Data Center Knowledge", "https://www.datacenterknowledge.com/rss.xml", "https://www.datacenterknowledge.com/", "trade"),
];

/** Sources requested or evaluated but excluded, with the reason (shown on the Sources page). */
export const EXCLUDED_OUTLETS: { outlet: string; reason: string }[] = [
  { outlet: "Reuters", reason: "No public RSS feed, and reuters.com robots.txt disallows all automated access. It would need a Reuters Connect license." },
  { outlet: "Google News", reason: "robots.txt disallows automated access to its RSS search. It's also an aggregator, not an original source." },
  { outlet: "Apple News", reason: "There's no public reading API. Apple News API is for publishers to post content, and scraping the app would violate its terms." },
  { outlet: "Sacramento Bee / Fresno Bee / Modesto Bee (McClatchy)", reason: "Servers refuse automated requests. California coverage comes from CalMatters, KPBS, LAist, SF Standard and Mission Local instead." },
  { outlet: "San Francisco Chronicle / SFGATE", reason: "No working public feed found." },
  { outlet: "Virginia Mercury, Wisconsin Examiner and other States Newsroom sites", reason: "Their feeds return HTTP 403 to automated requests." },
  { outlet: "CNN RSS feeds", reason: "Discontinued, with the last items from 2018–2024. CNN is included through its news sitemap instead." },
  { outlet: "Associated Press", reason: "No public RSS. AP's Media API is licensed." },
  { outlet: "The Wall Street Journal", reason: "Its public RSS has been stale since January 2025." },
];

const OFFICIAL_RELEVANT = /\b(data cent\w*|hyperscal\w*|AI (infrastructure|campus|data)|artificial intelligence|electric(ity)? (grid|rates?|bills?)|power grid|energy (policy|plan|costs?|affordability|independence|council)|utility (rates?|commission|bills?)|ratepayers?|nuclear|natural gas|power plants?|transmission|large[- ]load|microgrid)\b/i;
const RELEVANT = /\bdata[- ]?cent(?:er|re)s?\b|\bhyperscal\w*|\blarge[- ]load\b|\bAI campus\b|\bcolocation\b/i;
/** Policy-signal terms used to rank items (not to filter). */
const POLICY = /moratori|zoning|rezon|ordinance|tariff|commission|legislat|bill\b|veto|governor|permit|lawsuit|referendum|ballot|tax (break|exemption|incentive)|water|grid|interconnect|ratepayer|PJM|ERCOT|FERC|election|candidate/i;

export interface NewsItem {
  title: string;
  url: string;
  published: string | null;
  summary: string;
  outlet: string;
  feedId: string;
  outletType: Feed["type"];
  states: string[];
  policySignal: boolean;
}

const strip = (html: string) => cheerio.load(`<div>${html}</div>`)("div").text().replace(/\s+/g, " ").trim();

const STATE_PATTERNS = STATES.filter((s) => s.code !== "DC").map((s) => ({
  code: s.code,
  re: new RegExp(`\\b${s.name.replace(/ /g, "\\s+")}\\b`, "i"),
}));

/** States mentioned by name in the text, plus the outlet's home state. */
export function tagStates(text: string, home?: string): string[] {
  const found = new Set<string>(home ? [home] : []);
  for (const { code, re } of STATE_PATTERNS) {
    // "Virginia" also matches inside "West Virginia"; handle explicitly.
    if (code === "VA" && !/(?<!West\s)\bVirginia\b/i.test(text)) continue;
    if (re.test(text)) found.add(code);
  }
  return [...found];
}

/** Parse RSS 2.0 or Atom into items. */
export function parseFeed(xml: string, feed: Feed): NewsItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const sitemap = feed.mode === "sitemap";
  const nodes = sitemap ? $("url") : $("item").length ? $("item") : $("entry");
  const items: NewsItem[] = [];
  nodes.each((_, el) => {
    const n = $(el);
    const title = strip(sitemap ? n.find("news\\:title").first().text() : n.find("title").first().text());
    const link = sitemap ? n.find("loc").first().text().trim() : (n.find("link").first().attr("href") ?? n.find("link").first().text().trim());
    const date = sitemap
      ? n.find("news\\:publication_date").first().text()
      : n.find("pubDate").first().text() || n.find("published").first().text() || n.find("updated").first().text() || n.find("dc\\:date").first().text();
    const summary = sitemap ? "" : strip(n.find("description").first().text() || n.find("summary").first().text()).slice(0, 400);
    if (!title || !/^https?:\/\//.test(link)) return;
    if (/^sponsored\b|^\[?sponsored|paid post|partner content/i.test(title)) return; // advertising, not news
    const text = `${title} ${summary}`;
    // Even newsroom-curated tag feeds occasionally carry off-topic items. Official
    // releases also qualify on energy/AI-infrastructure policy terms.
    if (!RELEVANT.test(text) && !(feed.mode === "official" && OFFICIAL_RELEVANT.test(text))) return;
    const t = Date.parse(date);
    items.push({
      title,
      url: link,
      published: Number.isFinite(t) ? new Date(t).toISOString() : null,
      summary,
      outlet: feed.outlet,
      feedId: feed.id,
      outletType: feed.type,
      states: tagStates(text, feed.state),
      policySignal: POLICY.test(text),
    });
  });
  return items;
}

/** Normalize a URL for deduplication (drop tracking params, trailing slash, scheme). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|src$)/i.test(p)) u.searchParams.delete(p);
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}

export const newsAdapter: Adapter = {
  id: "news-feeds",
  name: "Public media & credible news feeds",
  url: "https://www.wvia.org/tags/data-centers",
  sourceKind: "journalism",
  method: "api",
  schedule: "Hourly",
  refreshMinutes: 60,
  // Feeds only list recent items; keep the archive as stories scroll off.
  appendOnly: true,
  coverage: `${FEEDS.length} feeds from national and business outlets (CNBC, Politico, CNN, FT, Washington Post, NYT, The Hill), public media stations, local newspapers in key markets, nonprofit newsrooms and trade press. Feeds that block automated access are excluded. State tags come from the outlet's home state plus any state named in the text, so treat them as approximate. This is a monitored sample of the press, not comprehensive coverage.`,
  async run({ fetch, log }) {
    const warnings: string[] = [];
    const items = new Map<string, NewsItem>();
    let ok = 0;
    await Promise.all(
      FEEDS.map(async (feed) => {
        try {
          const xml = await (await fetch(feed.url, { retries: 1, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9" } })).text();
          const parsed = parseFeed(xml, feed);
          ok++;
          for (const it of parsed) {
            const key = canonicalUrl(it.url);
            if (!items.has(key)) items.set(key, it);
          }
        } catch (err) {
          warnings.push(`${feed.outlet}: ${(err as Error).message}`);
        }
      }),
    );
    log(`${ok}/${FEEDS.length} feeds OK, ${items.size} relevant items`);
    if (ok === 0) throw new Error("All news feeds failed");

    const entities: Entity[] = [...items.entries()].map(([key, it]) => ({
      id: `news:${sha(key)}`,
      kind: "article",
      state: it.states.length === 1 ? it.states[0] : it.states.length ? it.states[0] : "US",
      title: it.title,
      date: it.published?.slice(0, 10) ?? null,
      status: it.policySignal ? "policy" : "general",
      searchText: `${it.summary} ${it.outlet} ${it.states.join(" ")}`,
      sources: [{ title: it.title, url: it.url, publisher: it.outlet, kind: "journalism", published: it.published?.slice(0, 10) }],
      confidence: null,
      data: { ...it, source: "news" },
    }));
    return { entities, warnings };
  },
};
