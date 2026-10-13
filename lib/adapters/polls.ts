import * as cheerio from "cheerio";
import type { Adapter, Entity } from "../ingest/types";
import { STATE_BY_NAME } from "../states";

/**
 * General-election polls for 2026 Senate and governor races, as listed by
 * 270toWin (an aggregator). Each poll links to the pollster's own release,
 * which is cited as the primary source. 270toWin's robots.txt permits these
 * paths; requests are low-volume (two per refresh).
 *
 * Not included: Silver Bulletin (paywalled; robots.txt disallows automated collection)
 * and FiveThirtyEight (shut down by ABC News in 2025; its data URLs now
 * redirect).
 *
 * The "average" here is our own simple calculation (latest poll per
 * pollster within 30 days of the newest poll), not a weighted model.
 */

const ENDPOINT = "https://www.270towin.com/polls/php/get-polls-list-v2.php";
const PAGES = { S: "https://www.270towin.com/polls/latest-2026-senate-election-polls/", G: "https://www.270towin.com/polls/latest-2026-governor-election-polls/" };

export interface PollRow {
  date: string; // YYYY-MM-DD (release date as listed)
  type: string;
  pollster: string;
  url: string | null; // pollster's release
  state: string; // USPS
  statePage: string | null;
  results: { name: string; party: string | null; incumbent: boolean; pct: number }[];
}

export function parsePolls(html: string): PollRow[] {
  const $ = cheerio.load(html);
  const out: PollRow[] = [];
  $("#polls-list > tbody > tr").each((_, tr) => {
    const cells = $(tr).children("td");
    if (cells.length < 5) return;
    const [m, d, y] = $(cells[0]).text().trim().split("/");
    if (!y) return;
    const src = $(cells[2]).find("a").first();
    const loc = $(cells[3]).find("a").first();
    const state = STATE_BY_NAME.get(loc.text().trim().toLowerCase());
    if (!state) return;
    const results: PollRow["results"] = [];
    $(cells[4]).find("tr").each((__, r) => {
      const tds = $(r).children("td");
      const raw = $(tds[0]).text().trim();
      const pct = Number($(tds[1]).text().replace(/[%\s]/g, ""));
      const party = ($(r).attr("class") ?? "").match(/fill-([A-Z])/)?.[1] ?? null;
      if (raw && Number.isFinite(pct)) results.push({ name: raw.replace(/\s*\*\s*$/, ""), party, incumbent: /\*\s*$/.test(raw), pct });
    });
    if (!results.length) return;
    out.push({
      date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
      type: $(cells[1]).text().trim(),
      pollster: src.text().trim() || $(cells[2]).text().trim(),
      url: src.attr("href") ?? null,
      state: state.code,
      statePage: loc.attr("href") ? `https://www.270towin.com${loc.attr("href")}` : null,
      results,
    });
  });
  return out;
}

const PARTY_BY_COLOR: Record<string, string> = { "#3e5a96": "D", "#c23237": "R" };

export interface Matchup {
  candidates: { name: string; party: string | null }[];
  /** 270toWin's own average (their methodology), if shown */
  average: { polls: number; values: (number | null)[] } | null;
  polls: { pollster: string; url: string | null; date: string; sample: string; values: (number | null)[]; inAverage: boolean }[];
}

/** Parse every matchup table on a 270toWin state polls page. */
export function parseStatePollPage(html: string): Matchup[] {
  const $ = cheerio.load(html);
  const pct = (t: string) => { const n = Number(t.replace(/[%\s]/g, "")); return t.trim() && Number.isFinite(n) ? n : null; };
  const out: Matchup[] = [];
  $("div.polls-wrapper").each((_, w) => {
    const table = $(w).find("table").first();
    const candidates = table.find("thead th.can_name").map((__, th) => {
      const color = ($(th).attr("style") ?? "").match(/#[0-9a-f]{6}/i)?.[0]?.toLowerCase() ?? "";
      return { name: $(th).text().trim(), party: PARTY_BY_COLOR[color] ?? null };
    }).get();
    if (candidates.length < 2) return;
    const avgRow = table.find("tr#poll_avg_row");
    const avgN = Number(avgRow.find("td.poll_avg").text().match(/Average of (\d+)/)?.[1] ?? NaN);
    const average = avgRow.length && Number.isFinite(avgN)
      ? { polls: avgN, values: avgRow.children("td").slice(1, 1 + candidates.length).map((__, td) => pct($(td).text())).get() }
      : null;
    const polls: Matchup["polls"] = [];
    table.find("tr.poll_row").each((__, tr) => {
      const a = $(tr).find("td.poll_src a").first();
      const [m, d, y] = $(tr).find("td.poll_date").text().trim().split("/");
      if (!y) return;
      polls.push({
        pollster: (a.text() || $(tr).find("td.poll_src").text()).trim(),
        url: a.attr("href") ?? null,
        date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
        sample: $(tr).find("td.poll_sample").text().replace(/\s+/g, " ").replace("&plusmn", "±").trim(),
        values: $(tr).find("td.poll_data").map((___, td) => pct($(td).text())).get(),
        inAverage: $(tr).hasClass("in_average_calculation"),
      });
    });
    out.push({ candidates, average, polls });
  });
  return out;
}

/** Latest poll per pollster within `days` of the newest poll; mean share by party. */
export function simpleAverage(polls: PollRow[], days = 30) {
  if (!polls.length) return null;
  const sorted = [...polls].sort((a, b) => b.date.localeCompare(a.date));
  const cutoff = new Date(Date.parse(sorted[0].date) - days * 86_400_000).toISOString().slice(0, 10);
  const latestByPollster = new Map<string, PollRow>();
  for (const p of sorted) if (p.date >= cutoff && !latestByPollster.has(p.pollster)) latestByPollster.set(p.pollster, p);
  const used = [...latestByPollster.values()];
  const share = (party: string) => used.reduce((n, p) => n + (p.results.find((r) => r.party === party)?.pct ?? 0), 0) / used.length;
  const D = share("D"), R = share("R"), I = share("I");
  return { D, R, I, margin: D - R, polls: used.length, from: cutoff, to: sorted[0].date };
}

export const pollsAdapter: Adapter = {
  id: "polls",
  name: "Polls (via 270toWin)",
  url: PAGES.S,
  sourceKind: "aggregator",
  method: "html",
  schedule: "Every 6 hours",
  refreshMinutes: 360,
  coverage:
    "Public general-election polls for 2026 Senate and governor races as listed by 270toWin, each linked to the pollster's release. Our average is a simple mean of each pollster's latest poll within 30 days, not a weighted model. Silver Bulletin (paywalled, and its robots.txt blocks automated collection) and FiveThirtyEight (shut down in 2025) aren't included.",
  dependsOn: ["curated"],
  async run({ fetch, lookup, log }) {
    const races = lookup("race");
    const entities: Entity[] = [];
    let total = 0;
    for (const [type, office] of [["S", "U.S. Senate"], ["G", "Governor"]] as const) {
      // The endpoint serves pre-built cached responses keyed on the exact query its own page sends,
      // so parameter order and the full subtype list must match; primaries are filtered out below.
      const qs = new URLSearchParams();
      qs.append("election_year", "2026");
      qs.append("election_types[]", type);
      for (const st of ["PE", "PR", "GE", "GR"]) qs.append("election_subtypes[]", st);
      qs.append("limit", "0");
      const html = await (await fetch(`${ENDPOINT}?${qs}`, { headers: { "X-Requested-With": "XMLHttpRequest", Referer: PAGES[type] } })).text();
      const polls = parsePolls(html).filter((p) => /general/i.test(p.type));
      total += polls.length;
      const byState = new Map<string, PollRow[]>();
      for (const p of polls) byState.set(p.state, [...(byState.get(p.state) ?? []), p]);
      for (const [st, list] of byState) {
        // Two Senate races in one state (OH, FL specials): attach by matching a nominee's last name.
        const candidatesFor = races.filter((r) => r.state === st && (r.data as { office: string }).office === office);
        for (const race of candidatesFor) {
          const rd = race.data as { id: string; candidates: { name: string }[] };
          const lasts = rd.candidates.map((c) => c.name.split(" ").at(-1)!.toLowerCase());
          const mine = candidatesFor.length > 1 ? list.filter((p) => p.results.some((r) => lasts.some((l) => r.name.toLowerCase().includes(l)))) : list;
          if (!mine.length) continue;
          // Full poll history and 270toWin's average from the race's own page, matched on both nominees' names.
          let matchup: Matchup | null = null;
          if (mine[0].statePage) {
            try {
              const page = await (await fetch(mine[0].statePage)).text();
              const nomLasts = rd.candidates.filter((c) => (c as { status?: string }).status === "nominee").map((c) => c.name.split(" ").at(-1)!.toLowerCase());
              matchup = parseStatePollPage(page).find((mu) => nomLasts.filter((l) => mu.candidates.some((c) => c.name.toLowerCase().includes(l))).length >= 2) ?? null;
            } catch (err) {
              log(`  ${rd.id}: state page failed (${(err as Error).message}); using latest poll only`);
            }
          }
          entities.push({
            id: `polls:${rd.id}`,
            kind: "finance",
            state: st,
            title: `Polls: ${race.title}`,
            date: mine.map((p) => p.date).sort().at(-1) ?? null,
            status: "polls",
            sources: [
              ...mine.slice(0, 5).filter((p) => p.url).map((p) => ({ title: `${p.pollster} poll (${p.date})`, url: p.url!, publisher: p.pollster, kind: "research" as const, published: p.date })),
              { title: `270toWin: ${race.title} polls`, url: mine[0].statePage ?? PAGES[type], publisher: "270toWin", kind: "aggregator" as const },
            ],
            confidence: "medium",
            data: {
              raceId: rd.id,
              polls: mine.sort((a, b) => b.date.localeCompare(a.date)),
              average: simpleAverage(mine),
              matchup,
              matchupAverage: matchup?.average
                ? Object.fromEntries(matchup.candidates.map((c, i) => [c.party ?? c.name, matchup!.average!.values[i]]))
                : null,
              statePage: mine[0].statePage,
            },
          });
        }
      }
    }
    log(`Polls: ${total} general-election polls → ${entities.length} races`);
    return { entities };
  },
};
