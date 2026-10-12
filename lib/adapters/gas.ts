import * as cheerio from "cheerio";
import type { Adapter, Observation } from "../ingest/types";
import { STATE_BY_NAME } from "../states";

const GRADES = ["regular", "midgrade", "premium", "diesel"] as const;

const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "Price as of 10/11/26" → "2026-10-11" */
export function aaaDate(html: string): string | null {
  const m = html.match(/Price as of\s+(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  return m ? `20${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export function parseAaaStates(html: string, date: string): Observation[] {
  const $ = cheerio.load(html);
  const out: Observation[] = [];
  $("#sortable tbody tr").each((_, tr) => {
    const cells = $(tr).find("td").map((__, td) => $(td).text().trim()).get();
    const state = STATE_BY_NAME.get(cells[0]?.toLowerCase());
    if (!state) return;
    GRADES.forEach((g, i) => {
      const value = money(cells[i + 1] ?? "");
      if (value) out.push({ series: `aaa_${g}`, area: state.code, date, value, unit: "USD/gal" });
    });
  });
  return out;
}

/** National table: current, yesterday, week, month, year-ago averages. */
export function parseAaaNational(html: string, date: string): Observation[] {
  const $ = cheerio.load(html);
  const offsets: Record<string, number> = {
    "Current Avg.": 0, "Yesterday Avg.": 1, "Week Ago Avg.": 7, "Month Ago Avg.": 30, "Year Ago Avg.": 365,
  };
  const out: Observation[] = [];
  $("table.table-mob tr").each((_, tr) => {
    const cells = $(tr).find("td").map((__, td) => $(td).text().trim()).get();
    const offset = offsets[cells[0]];
    if (offset === undefined) return;
    // AAA labels these relative to the observation date; we store them as the
    // approximate calendar date and flag them as derived in the series name.
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    const day = d.toISOString().slice(0, 10);
    GRADES.forEach((g, i) => {
      const value = money(cells[i + 1] ?? "");
      if (value) out.push({ series: offset === 0 ? `aaa_${g}` : `aaa_${g}_lookback`, area: "US", date: day, value, unit: "USD/gal" });
    });
  });
  return out;
}

export const aaaAdapter: Adapter = {
  id: "aaa-gas",
  name: "AAA Gas Prices (daily averages)",
  url: "https://gasprices.aaa.com/",
  sourceKind: "data",
  method: "html",
  schedule: "Daily (AAA updates averages once per day)",
  refreshMinutes: 360,
  coverage:
    "National averages (current, plus yesterday, week, month and year-ago lookbacks) and statewide averages for regular, mid-grade, premium and diesel. AAA doesn't publish history in a structured form, so history here only builds up as the adapter runs daily. Crawl-delay from robots.txt is respected.",
  async run({ fetch }) {
    const national = await (await fetch("https://gasprices.aaa.com/")).text();
    const states = await (await fetch("https://gasprices.aaa.com/state-gas-price-averages/")).text();
    const date = aaaDate(national) ?? aaaDate(states);
    if (!date) throw new Error('Could not find "Price as of" date on AAA page; layout may have changed');
    const observations = [...parseAaaNational(national, date), ...parseAaaStates(states, date)];
    const stateCount = new Set(observations.filter((o) => o.area !== "US").map((o) => o.area)).size;
    if (stateCount < 45) throw new Error(`Parsed only ${stateCount} states from AAA; layout may have changed`);
    return { entities: [], observations };
  },
};

/** EIA weekly retail gasoline (regular, all formulations) series. */
export const EIA_AREAS: { code: string; area: string; label: string }[] = [
  { code: "nus", area: "US", label: "U.S." },
  { code: "r10", area: "PADD1", label: "East Coast (PADD 1)" },
  { code: "r20", area: "PADD2", label: "Midwest (PADD 2)" },
  { code: "r30", area: "PADD3", label: "Gulf Coast (PADD 3)" },
  { code: "r40", area: "PADD4", label: "Rocky Mountain (PADD 4)" },
  { code: "r50", area: "PADD5", label: "West Coast (PADD 5)" },
  { code: "sca", area: "CA", label: "California" },
  { code: "sco", area: "CO", label: "Colorado" },
  { code: "sfl", area: "FL", label: "Florida" },
  { code: "sma", area: "MA", label: "Massachusetts" },
  { code: "smn", area: "MN", label: "Minnesota" },
  { code: "sny", area: "NY", label: "New York" },
  { code: "soh", area: "OH", label: "Ohio" },
  { code: "stx", area: "TX", label: "Texas" },
  { code: "swa", area: "WA", label: "Washington" },
];

const MON: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** Parse EIA's "LeafHandler" weekly history table: rows are "YYYY-Mon" with (MM/DD, value) pairs. */
export function parseEiaWeekly(html: string, area: string): Observation[] {
  const $ = cheerio.load(html);
  const out: Observation[] = [];
  $("tr").each((_, tr) => {
    const cells = $(tr).children().map((__, td) => $(td).text().trim()).get();
    const m = cells[0]?.match(/^(\d{4})-([A-Z][a-z]{2})$/);
    if (!m || !MON[m[2]]) return;
    for (let i = 1; i + 1 < cells.length; i += 2) {
      const md = cells[i].match(/^(\d{2})\/(\d{2})$/);
      const value = Number(cells[i + 1]);
      if (!md || !cells[i + 1] || !Number.isFinite(value)) continue;
      // Weeks spanning a year boundary are listed under the month of their end date.
      const year = md[1] === "12" && m[2] === "Jan" ? Number(m[1]) - 1 : Number(m[1]);
      out.push({ series: "eia_regular_weekly", area, date: `${year}-${md[1]}-${md[2]}`, value, unit: "USD/gal" });
    }
  });
  return out;
}

export const eiaAdapter: Adapter = {
  id: "eia-gas",
  name: "EIA weekly retail gasoline prices",
  url: "https://www.eia.gov/petroleum/gasdiesel/",
  sourceKind: "data",
  method: "html",
  schedule: "Weekly (EIA publishes on Mondays, survey date Monday 8 a.m.)",
  refreshMinutes: 720,
  coverage:
    "The official U.S. Energy Information Administration weekly survey for regular gasoline: national, five PADD regions and nine states (CA, CO, FL, MA, MN, NY, OH, TX, WA), with history back to the 1990s. EIA doesn't publish weekly series for other states.",
  async run({ fetch, log }) {
    const observations: Observation[] = [];
    const warnings: string[] = [];
    for (const a of EIA_AREAS) {
      try {
        const html = await (
          await fetch(`https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=pet&s=emm_epmr_pte_${a.code}_dpg&f=w`)
        ).text();
        const obs = parseEiaWeekly(html, a.area);
        if (obs.length === 0) warnings.push(`No rows parsed for ${a.label}`);
        observations.push(...obs);
      } catch (err) {
        warnings.push(`${a.label}: ${(err as Error).message}`);
      }
    }
    log(`EIA: ${observations.length} weekly observations`);
    if (observations.length === 0) throw new Error("EIA returned no data");
    return { entities: [], observations, warnings };
  },
};
