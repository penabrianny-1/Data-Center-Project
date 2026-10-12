import type { Adapter, Entity } from "../ingest/types";
import { STATE_BY_CODE } from "../states";

/**
 * Prediction-market prices for every 2026 Senate and governor race, from three
 * public market-data APIs (read-only, no account needed):
 *   Kalshi     (CFTC-regulated exchange)        api.elections.kalshi.com/trade-api/v2
 *   Polymarket (gamma API)                      gamma-api.polymarket.com
 *   PredictIt  (all-markets JSON)               www.predictit.org/api/marketdata/all/
 *
 * A price of $0.62 on a "Democrat wins" contract is read as a 62% implied
 * chance. Prices reflect traders' bets, not polls or forecasts, and thin
 * markets can be noisy, so volume is kept alongside each price.
 */

export interface MarketQuote {
  market: "Kalshi" | "Polymarket" | "PredictIt";
  url: string;
  /** Implied probability by party, 0–1, normalized so D + R (+ other) = 1 */
  byParty: Record<string, number>;
  /** Per-candidate quotes where the market lists candidates */
  candidates: { name: string; party: string | null; price: number }[];
  volume: number | null;
  updated: string | null;
}

const partyFrom = (s: string): string | null => {
  if (/\(D\)|democrat/i.test(s) || /-D$/.test(s)) return "D";
  if (/\(R\)|republican/i.test(s) || /-R$/.test(s)) return "R";
  if (/\(I\)|independent/i.test(s) || /-I$/.test(s)) return "I";
  return null;
};

function normalize(byParty: Record<string, number>): Record<string, number> {
  const sum = Object.values(byParty).reduce((a, b) => a + b, 0);
  if (sum <= 0) return byParty;
  return Object.fromEntries(Object.entries(byParty).map(([k, v]) => [k, v / sum]));
}

const mid = (bid?: string, ask?: string, last?: string) => {
  const b = Number(bid), a = Number(ask), l = Number(last);
  if (b > 0 && a > 0 && a >= b) return (a + b) / 2;
  return l > 0 ? l : NaN;
};

type Fetch = (u: string, init?: RequestInit & { retries?: number }) => Promise<Response>;

async function kalshi(fetch: Fetch, seriesTickers: string[], office: "sen" | "gov", st: string, special: boolean): Promise<MarketQuote | null> {
  const base = office === "sen" ? `SENATE` : `GOVPARTY`;
  const want = new RegExp(`^${base}(PARTY)?-?${st}${special ? "S" : ""}$`);
  const series = seriesTickers.find((t) => want.test(t));
  if (!series) return null;
  const j = (await (await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&status=open&limit=50`)).json()) as {
    markets: { ticker: string; yes_sub_title?: string; subtitle?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; last_price_dollars?: string; volume_fp?: string; event_ticker: string }[];
  };
  const markets = j.markets.filter((m) => /-26-/.test(m.ticker) || /-26$/.test(m.event_ticker));
  if (!markets.length) return null;
  const byParty: Record<string, number> = {};
  const candidates: MarketQuote["candidates"] = [];
  let volume = 0;
  for (const m of markets) {
    const p = mid(m.yes_bid_dollars, m.yes_ask_dollars, m.last_price_dollars);
    if (!Number.isFinite(p)) continue;
    const party = partyFrom(m.ticker) ?? partyFrom(m.subtitle ?? "");
    if (party) byParty[party] = (byParty[party] ?? 0) + p;
    if (m.yes_sub_title) candidates.push({ name: m.yes_sub_title, party, price: p });
    volume += Number(m.volume_fp) || 0;
  }
  if (!Object.keys(byParty).length) return null;
  return { market: "Kalshi", url: `https://kalshi.com/markets/${series.toLowerCase()}`, byParty: normalize(byParty), candidates, volume, updated: new Date().toISOString() };
}

async function polymarket(fetch: Fetch, office: "sen" | "gov", stateName: string, special: boolean): Promise<MarketQuote | null> {
  const q = `${stateName} ${office === "sen" ? "Senate" : "Governor"}${special ? " Special" : ""} Election Winner`;
  const j = (await (await fetch(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=10`)).json()) as {
    events?: { title: string; slug: string; volume?: number; closed?: boolean; markets?: { groupItemTitle?: string; question?: string; outcomePrices?: string; closed?: boolean }[] }[];
  };
  const titleRe = new RegExp(`^${stateName}\\s+(Senate|Governor|Gubernatorial)${special ? "\\s+Special" : ""}\\s+Election\\s+Winner$`, "i");
  const ev = (j.events ?? []).find((e) => !e.closed && titleRe.test(e.title.trim()) && (office === "sen" ? /Senate/i.test(e.title) : /Governor|Gubernatorial/i.test(e.title)) && (special || !/special/i.test(e.title)));
  if (!ev) return null;
  const byParty: Record<string, number> = {};
  const candidates: MarketQuote["candidates"] = [];
  for (const m of ev.markets ?? []) {
    if (m.closed || !m.outcomePrices) continue;
    const yes = Number(JSON.parse(m.outcomePrices)[0]);
    if (!Number.isFinite(yes) || yes <= 0) continue;
    const label = m.groupItemTitle ?? m.question ?? "";
    const party = partyFrom(label);
    if (party) byParty[party] = (byParty[party] ?? 0) + yes;
    candidates.push({ name: label.replace(/\s*\([A-Z]\)\s*$/, "").trim(), party, price: yes });
  }
  if (!Object.keys(byParty).length) return null;
  return { market: "Polymarket", url: `https://polymarket.com/event/${ev.slug}`, byParty: normalize(byParty), candidates, volume: ev.volume ?? null, updated: new Date().toISOString() };
}

interface PiMarket { name: string; url: string; timeStamp: string; contracts: { name: string; lastTradePrice: number | null; bestBuyYesCost: number | null; bestSellYesCost: number | null }[] }

function predictit(all: PiMarket[], office: "sen" | "gov", stateName: string, special: boolean): MarketQuote | null {
  const re =
    office === "sen"
      ? new RegExp(`2026 US Senate ${special ? "special " : ""}election in ${stateName}\\?$`, "i")
      : new RegExp(`2026 election for governor of ${stateName}\\?$`, "i");
  const m = all.find((x) => /^Which party will win/i.test(x.name) && re.test(x.name));
  if (!m) return null;
  const byParty: Record<string, number> = {};
  for (const c of m.contracts) {
    const p = mid(String(c.bestSellYesCost ?? ""), String(c.bestBuyYesCost ?? ""), String(c.lastTradePrice ?? "")); // sell = bid, buy = ask
    const party = partyFrom(c.name);
    if (party && Number.isFinite(p)) byParty[party] = (byParty[party] ?? 0) + p;
  }
  if (!Object.keys(byParty).length) return null;
  return { market: "PredictIt", url: m.url, byParty: normalize(byParty), candidates: [], volume: null, updated: m.timeStamp ? new Date(m.timeStamp + "Z").toISOString() : null };
}

export const marketsAdapter: Adapter = {
  id: "markets",
  name: "Prediction markets (Kalshi, Polymarket, PredictIt)",
  url: "https://kalshi.com/category/elections",
  sourceKind: "data",
  method: "api",
  schedule: "Hourly",
  refreshMinutes: 60,
  coverage:
    "Current prices for every 2026 Senate and governor race listed on Kalshi, Polymarket and PredictIt, plus Senate and House control markets. Each price is read as an implied probability. Each market and its volume are shown separately, and a simple average is labeled as such. Market prices are bets, not forecasts or polls.",
  dependsOn: ["curated"],
  async run({ fetch, lookup, log }) {
    const races = lookup("race").filter((r) => ["U.S. Senate", "Governor"].includes((r.data as { office: string }).office));
    const series = (
      (await (await fetch("https://api.elections.kalshi.com/trade-api/v2/series?category=Elections&limit=5000")).json()) as { series: { ticker: string }[] }
    ).series.map((s) => s.ticker);
    const pi = ((await (await fetch("https://www.predictit.org/api/marketdata/all/")).json()) as { markets: PiMarket[] }).markets;

    const entities: Entity[] = [];
    const warnings: string[] = [];
    for (const r of races) {
      const d = r.data as { id: string; office: string; state: string; special: boolean };
      const office = d.office === "U.S. Senate" ? "sen" : "gov";
      const stateName = STATE_BY_CODE.get(d.state)?.name ?? d.state;
      const quotes: MarketQuote[] = [];
      for (const [label, get] of [
        ["Kalshi", () => kalshi(fetch, series, office, d.state, d.special)],
        ["Polymarket", () => polymarket(fetch, office, stateName, d.special)],
        ["PredictIt", async () => predictit(pi, office, stateName, d.special)],
      ] as const) {
        try {
          const q = await get();
          if (q) quotes.push(q);
        } catch (err) {
          warnings.push(`${d.id} ${label}: ${(err as Error).message}`);
        }
      }
      if (!quotes.length) continue;
      const avgD = quotes.reduce((n, q) => n + (q.byParty.D ?? 0), 0) / quotes.length;
      const avgR = quotes.reduce((n, q) => n + (q.byParty.R ?? 0), 0) / quotes.length;
      entities.push({
        id: `market:${d.id}`,
        kind: "finance",
        state: d.state,
        title: `Prediction markets: ${r.title}`,
        status: "markets",
        sources: quotes.map((q) => ({ title: `${q.market}: ${r.title}`, url: q.url, publisher: q.market, kind: "data" as const })),
        confidence: "medium",
        data: { raceId: d.id, quotes, average: { D: avgD, R: avgR, n: quotes.length }, retrieved: new Date().toISOString() },
      });
    }

    // Chamber control
    for (const [chamber, piRe, pmQuery] of [
      ["senate", /control the Senate after the 2026/i, "Which party will win the Senate in 2026?"],
      ["house", /control the House after the 2026/i, "Which party will win the House in 2026?"],
    ] as const) {
      const quotes: MarketQuote[] = [];
      const piM = pi.find((m) => piRe.test(m.name));
      if (piM) {
        const byParty: Record<string, number> = {};
        for (const c of piM.contracts) {
          const party = partyFrom(c.name);
          const p = mid(String(c.bestSellYesCost ?? ""), String(c.bestBuyYesCost ?? ""), String(c.lastTradePrice ?? ""));
          if (party && Number.isFinite(p)) byParty[party] = p;
        }
        if (Object.keys(byParty).length) quotes.push({ market: "PredictIt", url: piM.url, byParty: normalize(byParty), candidates: [], volume: null, updated: null });
      }
      try {
        const j = (await (await fetch(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(pmQuery)}&limit_per_type=5`)).json()) as { events?: { title: string; slug: string; volume?: number; markets?: { groupItemTitle?: string; outcomePrices?: string }[] }[] };
        const ev = j.events?.find((e) => e.title === pmQuery);
        if (ev) {
          const byParty: Record<string, number> = {};
          for (const m of ev.markets ?? []) if (m.outcomePrices && partyFrom(m.groupItemTitle ?? "")) byParty[partyFrom(m.groupItemTitle!)!] = Number(JSON.parse(m.outcomePrices)[0]);
          quotes.push({ market: "Polymarket", url: `https://polymarket.com/event/${ev.slug}`, byParty: normalize(byParty), candidates: [], volume: ev.volume ?? null, updated: null });
        }
      } catch (err) {
        warnings.push(`${chamber} control Polymarket: ${(err as Error).message}`);
      }
      if (quotes.length) {
        entities.push({
          id: `market:control-${chamber}`,
          kind: "finance",
          state: "US",
          title: `Prediction markets: ${chamber === "senate" ? "Senate" : "House"} control`,
          status: "markets",
          sources: quotes.map((q) => ({ title: `${q.market}: ${chamber} control`, url: q.url, publisher: q.market, kind: "data" as const })),
          confidence: "medium",
          data: { chamber, quotes, average: { D: quotes.reduce((n, q) => n + (q.byParty.D ?? 0), 0) / quotes.length, R: quotes.reduce((n, q) => n + (q.byParty.R ?? 0), 0) / quotes.length, n: quotes.length } },
        });
      }
    }
    log(`Markets: priced ${entities.length} races/chambers`);
    return { entities, warnings };
  },
};
