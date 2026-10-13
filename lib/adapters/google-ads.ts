import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { strFromU8, unzipSync } from "fflate";
import type { Adapter, Entity, Observation } from "../ingest/types";
import { HTTP_CLIENT_ID } from "../ingest/http";
import { STATE_BY_CODE } from "../states";
import { parseCsv } from "./fec";

/**
 * Google's Political Advertising Transparency Report (official, public bulk
 * export). Covers verified election advertisers on Google, YouTube and partner
 * sites, including candidates, parties, super PACs and issue-advocacy groups
 * that Google classifies as election ads.
 *
 * Time-stamped spend is weekly by advertiser (used for 2025–26 totals). Google
 * publishes spending by advertiser × state only as lifetime totals, so state
 * views show lifetime state spend by advertisers active this cycle, labeled
 * as such and not presented as 2025–26 spending.
 */

const URL_ZIP = "https://storage.googleapis.com/political-csv/google-political-ads-transparency-bundle.zip";
const CACHE = join(process.cwd(), "data", "cache");
const ZIP = join(CACHE, "google-political-ads.zip");
const META = join(CACHE, "google-political-ads.meta.json");
const SINCE = "2025-01-01";

async function ensureZip(fetchFn: (u: string, init?: RequestInit) => Promise<Response>, log: (m: string) => void) {
  mkdirSync(CACHE, { recursive: true });
  const lm = (await fetchFn(URL_ZIP, { method: "HEAD" })).headers.get("last-modified");
  const meta = existsSync(META) ? (JSON.parse(readFileSync(META, "utf8")) as { lastModified: string | null }) : null;
  if (existsSync(ZIP) && statSync(ZIP).size > 1e8 && meta?.lastModified === lm) return lm;
  log("Downloading Google political ads bundle (~300 MB)…");
  const res = await fetch(URL_ZIP, { headers: { "User-Agent": HTTP_CLIENT_ID } });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(ZIP));
  writeFileSync(META, JSON.stringify({ lastModified: lm }));
  return lm;
}

const normName = (s: string) => s.toUpperCase().replace(/[.,'"()]/g, "").replace(/\b(INC|LLC|CORP|THE)\b/g, "").replace(/\s+/g, " ").trim();
const PREDICTION_MARKET_COS = /^(KALSHI|BLOCKRATIZE|POLYMARKET|PREDICTIT|ARISTOTLE)\b/;

const kind = (name: string) =>
  /\b(for (U\.?S\.? )?(senate|congress|governor|house|president|attorney general|lt\.? governor)|friends of|victory fund|campaign committee|for [A-Z][a-z]+ \d{4})\b/i.test(name)
    ? "Candidate campaign"
    : /\b(democratic|republican) (party|national|senatorial|congressional|governors)|\bDNC\b|\bRNC\b|\bDSCC\b|\bNRSC\b|\bDCCC\b|\bNRCC\b/i.test(name)
      ? "Party committee"
      : /\bPAC\b|action fund|super pac|majority|leadership fund/i.test(name)
        ? "PAC / super PAC"
        : "Issue group (not FEC-registered)";

export const googleAdsAdapter: Adapter = {
  id: "google-ads",
  name: "Google political ads (Transparency Report)",
  url: "https://adstransparency.google.com/political?region=US",
  sourceKind: "data",
  method: "bulk",
  schedule: "Daily (Google updates the bundle daily; re-downloaded only when changed)",
  refreshMinutes: 1440,
  coverage:
    "U.S. election advertising on Google Search, YouTube and Google's ad network by verified advertisers: candidates, parties, PACs and groups whose ads Google treats as election ads. Shows 2025–26 spending by advertiser (weekly data) and lifetime spending by state. Meta (Facebook and Instagram), TV, radio and streaming aren't covered here, and Google's spend figures are reported in ranges rounded to $100.",
  dependsOn: ["fec-money"],
  async run({ fetch, log, lookup }) {
    const lastModified = await ensureZip(fetch, log);
    // Advertisers whose names match an FEC committee take FEC's own category (e.g. WinSenate → Super PAC).
    const fecByName = new Map(
      lookup("finance")
        .filter((e) => e.id.startsWith("spender:"))
        .map((e) => { const d = e.data as { name: string; category: string; committeeId: string }; return [normName(d.name), d] as const; }),
    );
    const typeOf = (name: string) => {
      const n = normName(name);
      if (PREDICTION_MARKET_COS.test(n)) return { type: "Prediction-market company", fecId: null };
      const fec = fecByName.get(n);
      return fec ? { type: fec.category, fecId: fec.committeeId } : { type: kind(name), fecId: null };
    };
    const zip = new Uint8Array(readFileSync(ZIP));
    const read = (name: string) => strFromU8(unzipSync(zip, { filter: (f) => f.name === name })[name]);

    // Advertisers that run U.S. ads
    const [sh, ...sRows] = parseCsv(read("google-political-ads-advertiser-stats.csv"));
    const si = Object.fromEntries(sh.map((h, i) => [h, i]));
    const usAdvertisers = new Map<string, { name: string; lifetime: number }>();
    for (const r of sRows) {
      if (!r[si.Advertiser_ID] || !/\bUS\b/.test(r[si.Regions] ?? "")) continue;
      usAdvertisers.set(r[si.Advertiser_ID], { name: r[si.Advertiser_Name], lifetime: Number(r[si.Spend_USD]) || 0 });
    }

    // 2025–26 weekly spend
    const [wh, ...wRows] = parseCsv(read("google-political-ads-advertiser-weekly-spend.csv"));
    const wi = Object.fromEntries(wh.map((h, i) => [h, i]));
    const cycle = new Map<string, { total: number; weeks: Map<string, number> }>();
    const national = new Map<string, number>();
    for (const r of wRows) {
      const id = r[wi.Advertiser_ID];
      const week = r[wi.Week_Start_Date];
      const usd = Number(r[wi.Spend_USD]) || 0;
      if (!usAdvertisers.has(id) || !week || week < SINCE || usd <= 0) continue;
      const c = cycle.get(id) ?? { total: 0, weeks: new Map() };
      c.total += usd;
      c.weeks.set(week, (c.weeks.get(week) ?? 0) + usd);
      cycle.set(id, c);
      national.set(week, (national.get(week) ?? 0) + usd);
    }

    // Lifetime spend by advertiser × state
    const [gh, ...gRows] = parseCsv(read("google-political-ads-advertiser-geo-spend.csv"));
    const gi = Object.fromEntries(gh.map((h, i) => [h, i]));
    const byState = new Map<string, Map<string, number>>(); // state → advertiser → $
    const advStates = new Map<string, { state: string; amount: number }[]>();
    for (const r of gRows) {
      if (r[gi.Country] !== "US") continue;
      const st = (r[gi.Country_Subdivision_Primary] ?? "").replace(/^US-/, "");
      if (!STATE_BY_CODE.has(st)) continue;
      const id = r[gi.Advertiser_ID];
      const usd = Number(r[gi.Spend_USD]) || 0;
      if (usd <= 0) continue;
      const m = byState.get(st) ?? new Map();
      m.set(id, (m.get(id) ?? 0) + usd);
      byState.set(st, m);
      advStates.set(id, [...(advStates.get(id) ?? []), { state: st, amount: usd }]);
    }
    log(`Google ads: ${usAdvertisers.size} U.S. advertisers, ${cycle.size} active since ${SINCE}`);

    const src = { title: "Google Political Advertising Transparency Report", url: "https://adstransparency.google.com/political?region=US", publisher: "Google", kind: "data" as const };
    const entities: Entity[] = [];
    const ranked = [...cycle].sort((a, b) => b[1].total - a[1].total);
    for (const [id, c] of ranked.slice(0, 600)) {
      const a = usAdvertisers.get(id)!;
      entities.push({
        id: `gads:${id}`,
        kind: "finance",
        state: "US",
        title: a.name,
        status: "google_ads",
        sources: [{ ...src, title: `Google ads: ${a.name}`, url: `https://adstransparency.google.com/advertiser/${id}?region=US&political` }],
        confidence: "high",
        data: {
          advertiserId: id, name: a.name, ...typeOf(a.name), cycleSpend: c.total, lifetimeSpend: a.lifetime, since: SINCE,
          recentWeeks: [...c.weeks].sort((x, y) => x[0].localeCompare(y[0])).slice(-12).map(([week, amount]) => ({ week, amount })),
          topStates: (advStates.get(id) ?? []).sort((x, y) => y.amount - x.amount).slice(0, 8),
        },
      });
    }
    for (const [st, m] of byState) {
      const active = [...m].filter(([id]) => cycle.has(id)).sort((a, b) => b[1] - a[1]);
      entities.push({
        id: `gadsstate:${st}`,
        kind: "finance",
        state: st,
        title: `Google election ads in ${st}`,
        status: "google_ads_state",
        sources: [src],
        confidence: "high",
        data: {
          state: st,
          note: "Lifetime spend in this state by advertisers active since 2025-01-01 (Google publishes state spend only as lifetime totals).",
          top: active.slice(0, 20).map(([id, amount]) => ({ advertiserId: id, name: usAdvertisers.get(id)?.name ?? id, ...typeOf(usAdvertisers.get(id)?.name ?? ""), amount, cycleSpend: cycle.get(id)?.total ?? 0 })),
        },
      });
    }
    entities.push({
      id: "gads:summary",
      kind: "finance",
      state: "US",
      title: "Google election ads summary",
      status: "google_ads_summary",
      sources: [src],
      confidence: "high",
      data: { since: SINCE, total: ranked.reduce((n, [, c]) => n + c.total, 0), advertisers: cycle.size, lastModified },
    });
    const observations: Observation[] = [...national].map(([date, value]) => ({ series: "google_political_ads_weekly", area: "US", date, value, unit: "USD" }));
    return { entities, observations };
  },
};
