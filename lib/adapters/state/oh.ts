import type { Adapter } from "../../ingest/types";
import { parseCsv } from "../fec";
import { buildLobbyEntity, DATA_CENTER_RE, type LobbyClient, type StateLobbyMeta } from "./contract";
import { cachedDownload, orgKey } from "./ky";

/**
 * Ohio lobbying from the Joint Legislative Ethics Committee's Ohio Lobbying
 * Activity Center (OLAC), https://www2.jlec-olig.state.oh.us/OLAC/Reports/Home
 *
 * Sources:
 *  - "Active Agents and Employers By Date" → Active Employer Details
 *    (/OLAC/Reports/ActivityByDate/ActiveEmployerDetails?Date=YYYY-MM-DD), a CSV
 *    of every employer–agent engagement active on that date, with columns
 *    Employer ID, Employer Name 1, Employer Name 2, Contact, Address 1/2, City,
 *    State, Zipcode, Phone, Agent L Name, Agent F Name, Engagement Type
 *    (Legislative / Executive / Retirement). Several snapshot dates across
 *    2025–2026 are unioned so engagements that ended mid-period are kept.
 *  - "Legislative Industry Search" (/OLAC/Reports/RegistrationSearches/
 *    LegislativeIndustrySearch?Industry=…), an HTML table of legislative
 *    engagements (Agent Last/First Name, Employer, Engagement Date, Industry)
 *    for the current General Assembly. The industry is the employer's
 *    self-described line of business on the registration. It is a substring
 *    search with no "list all", so a few vowel queries are unioned to cover
 *    nearly every industry string.
 *
 * Dollar amounts: Ohio does not require reporting lobbyist compensation, and
 * the expenditure reports (meals/gifts to officials) are only available as
 * interactive HTML searches, so this adapter reports no amounts.
 *
 * This is NOT the Ohio Secretary of State campaign-finance site
 * (www6.ohiosos.gov), which sits behind a bot-protection challenge and is not
 * accessed. www2.jlec-olig.state.oh.us has no robots.txt (404, checked
 * 2026-10-12) and serves these CSV downloads to any client.
 */

const HOST = "https://www2.jlec-olig.state.oh.us";
const PAGE = `${HOST}/OLAC/Reports/AgentEmployerLists`;
const SNAPSHOTS = ["2025-03-31", "2025-09-30", "2026-03-31"]; // plus today
const INDUSTRY_QUERIES = ["a", "e", "i", "o", "u"];

const decodeHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export interface OhEngagement {
  employerId: string;
  employer: string;
  agent: string;
  type: string;
}

/** ActiveEmployerDetails CSV → engagements (exported for tests). */
export function parseOhEmployerDetails(text: string): OhEngagement[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const h = rows[0] ?? [];
  const ix = Object.fromEntries(h.map((x, i) => [x.trim(), i]));
  for (const col of ["Employer ID", "Employer Name 1", "Agent L Name", "Agent F Name", "Engagement Type"]) {
    if (ix[col] === undefined) throw new Error(`OLAC employer details: missing column "${col}"`);
  }
  const out: OhEngagement[] = [];
  for (const f of rows.slice(1)) {
    if (f.length < h.length || !f[ix["Employer ID"]]) continue;
    const employer = [f[ix["Employer Name 1"]], f[ix["Employer Name 2"]]].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
    const agent = `${f[ix["Agent F Name"]].trim()} ${f[ix["Agent L Name"]].trim()}`.trim();
    out.push({ employerId: f[ix["Employer ID"]].trim(), employer, agent, type: f[ix["Engagement Type"]].trim() });
  }
  return out;
}

export interface OhIndustryRow {
  agent: string;
  employer: string;
  date: string;
  industry: string;
}

/** Legislative Industry Search results table (exported for tests). */
export function parseOhIndustryHtml(html: string): OhIndustryRow[] {
  const out: OhIndustryRow[] = [];
  const body = html.slice(html.indexOf("<tbody"));
  const re = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const [, last, first, employer, date, industry] = m.map(decodeHtml);
    out.push({ agent: `${first} ${last}`.trim(), employer, date, industry });
  }
  return out;
}

/** Combine engagements and industry rows into client rows (exported for tests). */
export function aggregateOh(engagements: OhEngagement[], industries: OhIndustryRow[]): { clients: LobbyClient[]; registrations: number } {
  const byId = new Map<string, LobbyClient>();
  const keyToId = new Map<string, string>();
  const regs = new Set<string>();
  for (const e of engagements) {
    let c = byId.get(e.employerId);
    if (!c) {
      c = { name: e.employer, amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: false };
      byId.set(e.employerId, c);
      keyToId.set(orgKey(e.employer), e.employerId);
    }
    const reg = `${e.employerId}|${e.agent.toUpperCase()}|${e.type}`;
    if (!regs.has(reg)) {
      regs.add(reg);
      c.filings++; // one registered engagement (agent × branch) for this employer
    }
    if (!c.lobbyists.includes(e.agent)) c.lobbyists.push(e.agent);
  }
  for (const r of industries) {
    const id = keyToId.get(orgKey(r.employer));
    const c = id ? byId.get(id) : undefined;
    if (c && r.industry && !c.issues.includes(r.industry)) c.issues.push(r.industry);
  }
  for (const c of byId.values()) c.dataCenter = DATA_CENTER_RE.test(c.name) || c.issues.some((i) => DATA_CENTER_RE.test(i));
  return { clients: [...byId.values()], registrations: regs.size };
}

export const ohLobbyAdapter: Adapter = {
  id: "state-oh-lobby",
  name: "Ohio JLEC: lobbying registrations (OLAC)",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly (OLAC lists update daily)",
  refreshMinutes: 10_080,
  coverage:
    "Ohio lobbying registrations active at any of several snapshot dates in 2025–2026: employers, their registered agents and branch (legislative, executive, retirement system), and the employer's industry as stated on legislative registrations. No dollar amounts: Ohio does not require compensation reporting and expenditure reports are search-only. No lobbying-firm field is published.",
  async run({ fetch, log }) {
    const today = new Date().toISOString().slice(0, 10);
    const dates = [...SNAPSHOTS.filter((d) => d < today), today];
    const engagements: OhEngagement[] = [];
    for (const d of dates) {
      const url = `${HOST}/OLAC/Reports/ActivityByDate/ActiveEmployerDetails?Date=${d}`;
      // Past snapshots don't change much; refresh them monthly. Today's daily.
      const r = await cachedDownload(fetch, url, `oh-olac-employers-${d === today ? "current" : d}.csv`, { maxAgeMinutes: d === today ? 720 : 43_200 });
      const rows = parseOhEmployerDetails(new TextDecoder().decode(r.bytes));
      log(`OLAC active employer details ${d}: ${rows.length} engagements${r.fromCache ? " (cached)" : ""}`);
      engagements.push(...rows);
    }
    const industries: OhIndustryRow[] = [];
    const warnings: string[] = [];
    for (const q of INDUSTRY_QUERIES) {
      try {
        const url = `${HOST}/OLAC/Reports/RegistrationSearches/LegislativeIndustrySearch?Industry=${q}`;
        const r = await cachedDownload(fetch, url, `oh-olac-industry-${q}.html`, { maxAgeMinutes: 1_440 });
        const rows = parseOhIndustryHtml(new TextDecoder().decode(r.bytes));
        log(`OLAC industry search "${q}": ${rows.length} rows${r.fromCache ? " (cached)" : ""}`);
        industries.push(...rows);
      } catch (e) {
        warnings.push(`OLAC industry search "${q}": ${(e as Error).message}`);
      }
    }
    if (!engagements.length) throw new Error("OLAC returned no engagements");
    const { clients, registrations } = aggregateOh(engagements, industries);
    const meta: StateLobbyMeta = {
      state: "OH",
      agency: "Ohio Joint Legislative Ethics Committee (JLEC)",
      sourceUrl: PAGE,
      dataAsOf: today,
      period: `2025–2026 registrations active on ${dates.join(", ")}`,
      amountMeaning: null,
    };
    return { entities: [buildLobbyEntity(meta, clients, registrations)], warnings };
  },
};

export const adapters: Adapter[] = [ohLobbyAdapter];
