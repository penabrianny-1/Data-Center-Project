# Data Center Intel

A political and regulatory intelligence platform for U.S. data-center development. It tracks where building is getting easier or harder, why, who has the power to change that, and how the 2026 elections could shift the outlook. It covers every level from Washington down to individual counties.

Every consequential claim is traceable to a source. Facts, reported developments, analysis and scenarios are labeled separately throughout the app.

## Run it

Requires Node.js ≥ 22 (built with Node 26).

```bash
npm install
npm run ingest     # build data/intel.db from all sources (~1 min)
npm run dev        # http://localhost:3000
```

While the server runs, an in-process scheduler (`instrumentation.ts` → `lib/scheduler.ts`) checks every 10 minutes which sources are due and refreshes them in a separate process. Results are logged to `data/ingest.log`. Set `AUTO_REFRESH=0` to disable it.

| Command | Purpose |
|---|---|
| `npm run ingest` | Run every adapter |
| `npm run ingest -- news-feeds fec-bulk` | Run selected adapters |
| `npm run ingest -- --due` | Run only adapters whose refresh interval has elapsed (what the scheduler runs) |
| `npm run validate` | Validate curated seed files against `lib/schema.ts` |
| `npm test` | Unit tests (parsers, scoring, change tracking, source rules) |
| `npm run build` | Production build |

Optional keys go in `.env.local` (see `.env.example`):

- `FEC_API_KEY`: FEC-processed outside-spending totals. Free at https://api.data.gov/signup/.
- `OPENSTATES_API_KEY`: automated bill discovery and status for all 50 states. Free at https://open.pluralpolicy.com/accounts/signup/.

Keys take effect at the next scheduled refresh, with no restart needed, because each refresh process reads `.env.local`.
- `CONGRESS_GOV_API_KEY`: not required; federal bill status comes from GovInfo bulk data.

## Architecture

```
sources ──► adapters (lib/adapters/*) ──► scripts/ingest.ts ──► data/intel.db (SQLite) ──► lib/repo.ts ──► app/* pages
                                                  ▲
               lib/scheduler.ts (every 10 min) ───┘
```

- **Adapters**: one module per source. Each declares its source, source type, collection method, refresh interval, coverage statement and required env vars. Each returns normalized entities, relations and time-series observations.
- **Store** (`lib/db.ts`, built-in `node:sqlite`):
  - `entities`: stable ids, filter columns plus a JSON payload.
  - `sources` and `entity_sources`: deduplicated citations.
  - `relations`: typed edges such as candidate_in, member_of, incumbent_in, has_finance and official_record_of.
  - `history`: prior versions of changed records.
  - `changes`: append-only audit log.
  - `observations`: time series.
  - `adapters` and `runs`: source registry and freshness.
  - Full-text search over all of the above.
- **Change tracking**: content is hashed. Unchanged records aren't re-reported. Changed records archive their prior version. Records a source drops are removed and logged, except for append-only sources such as news feeds, which keep their archive.
- **Entity resolution** (`lib/adapters/resolve.ts`):
  - Members of Congress → FEC filings, via the FEC ids published in congress-legislators.
  - Curated candidates → FEC filings, by office, state, district and normalized name. Ambiguous matches are left unlinked.
  - Incumbents → their 2026 races.
- **Scoring** (`lib/scoring.ts`): a transparent, user-weightable composite of ten policy dimensions. Missing dimensions are never filled in. Completeness and confidence are always shown with the score.

## Sources

| Adapter | Source | Type | Method | Cadence |
|---|---|---|---|---|
| `curated` | Researched seed files in `data/seed/` | mixed, each record typed | curated | hourly re-ingest |
| `congress-legislators` | @unitedstates/congress-legislators | data | bulk JSON | daily |
| `congress-gov` | GovInfo BILLSTATUS (GPO / Library of Congress) | official | bulk XML | daily |
| `fec-bulk` | FEC bulk files (`webl26`, independent expenditures) | data | bulk | 12 h |
| `fec-ie` | FEC API processed Schedule E totals | data | API (key) | daily |
| `openstates` | Open States / Plural Policy API v3: every state bill mentioning data centers | data (links to official pages) | API (key) | daily |
| `news-feeds` | 77 feeds. National and business: CNBC, Politico, CNN (news sitemap), Financial Times, Washington Post, NYT, The Hill, NPR, PBS. Public media: WVIA and 17 other stations. Local papers in key markets: Richmond Times-Dispatch, InsideNoVa, Tucson, Omaha, St. Louis, Cleveland, PennLive, NJ.com, MLive, SF Standard and more. Nonprofit: CalMatters, Cardinal News, Georgia Recorder and more. Trade: Utility Dive, DCD | journalism | RSS / news sitemap | hourly |
| `aaf` | American Action Forum (site search index; sitemap scrape fallback) | research | search index | 3 h |
| `aaa-gas` | AAA daily national and state averages (robots.txt crawl-delay respected) | data | HTML | 6 h |
| `eia-gas` | EIA weekly retail gasoline (national, PADDs, 9 states) | data | HTML table | 12 h |

**Source rules**, enforced in `lib/schema.ts`:

- Every curated record needs at least one official, data, journalism or research source. Aggregators can only corroborate.
- Wikipedia, other wikis, Reddit, Quora and AI-generated content portals are rejected at validation.
- Feeds that block automated access (HTTP 403) are excluded, not worked around.

## Curated datasets (as of 2026-10-11/12)

| File | Records | Notes |
|---|---|---|
| `state-government.json` | 51 | Governors, chamber composition and executive powers. Leadership is listed only where an official site confirmed it. |
| `races-governor.json` | 36 | Nominees, ratings, polls and documented positions. 20 records are low confidence, and nominees are often unchecked against certified ballots. |
| `races-senate.json` | 35 | 33 Class 2 seats plus OH and FL specials. Many nominee names weren't checked against official state candidate lists (see caveats). |
| `races-house.json` | — | **Not completed.** The research run stopped on a usage limit. All 435 incumbents and FEC finance still come from automated sources. |
| `commissions.json` | 51 | Selection method, rosters, 2026 ballot seats, election → commission mechanism, large-load tariff status. |
| `dockets.json` | 54 | State PUC and FERC/RTO proceedings. NV, OR, CO, UT, OK and MS have none yet. |
| `state-policy.part1/2.json` | 51 | Incentives, preemption (TX and WV verified), water, environmental review, electricity, 10 scored dimensions. |
| `bills.json` (+ `bills.part2.json`) | 116 | 30 federal and 86 state. No records yet for AZ, NV, NM, MT, UT, WY, AK, LA, AL, MS, AR, ID, IA, MO, NE, RI, MA or NH. |
| `local-actions.json` | 161 | 48 states, as a sample. Ohio's 125+ local moratoriums are represented by only 6 records. |
| `developments.json` | 55 | Ranked by consequence (severity 1–5). |

Research gaps exist mainly because a shared web-search budget ran out during the initial build. Each record's `caveats` field states what wasn't verified.

## Known gaps & next steps

- **Reuters, Google News, Apple News, AP and the McClatchy Bee papers are excluded.** Their robots.txt, terms or servers prohibit automated access. The news page lists each exclusion and its reason. A licensed news API would be the legitimate route.
- **State campaign finance isn't integrated.** That covers governor, legislative and PUC races, each filed in a separate state system.
- **Lobbying (Senate LDA), utility territories, transmission and water stress** are planned layers. They're listed on the Sources page.
- **The watchlist is stored in the browser.** Email or push alerts need accounts and a mail provider.
- **Deployment:** the scheduler assumes a long-running Node server. Serverless hosting such as Vercel needs an external cron job that runs `npm run ingest -- --due` and a writable or hosted database.
