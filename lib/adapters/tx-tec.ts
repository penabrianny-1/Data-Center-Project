import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { strFromU8, unzipSync } from "fflate";
import type { Adapter, Entity, Relation } from "../ingest/types";
import { nameKey } from "./resolve";
import { USER_AGENT } from "../ingest/http";

/**
 * Texas state campaign finance from the Texas Ethics Commission's bulk CSV
 * export (official). Covers 2025–2026 itemized contributions to candidates
 * for the seven statewide offices on the 2026 ballot, plus the largest donors
 * across all Texas state candidates (legislature included).
 *
 * The 1 GB archive is cached locally and re-downloaded only when TEC
 * publishes a new one. Reports TEC marks as superseded (infoOnlyFlag = Y)
 * are excluded.
 */

const URL_ZIP = "https://prd.tecprd.ethicsefile.com/public/cf/public/TEC_CF_CSV.zip";
const CACHE_DIR = join(process.cwd(), "data", "cache");
const ZIP_PATH = join(CACHE_DIR, "TEC_CF_CSV.zip");
const META_PATH = join(CACHE_DIR, "TEC_CF_CSV.meta.json");
const SINCE = "20250101";

export const STATEWIDE: Record<string, string> = {
  GOVERNOR: "Governor",
  LTGOVERNOR: "Lieutenant Governor",
  ATTYGEN: "Attorney General",
  COMPTROLLER: "Comptroller",
  LANDCOMM: "Land Commissioner",
  AGRICULTUR: "Agriculture Commissioner",
  RRCOMM: "Railroad Commissioner",
};

/** Quote-aware split of one CSV line (TEC rows are single-line). Returns null if quotes are unbalanced. */
export function splitCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  if (quoted) return null;
  out.push(field.replace(/\r$/, ""));
  return out;
}

const ymd = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);
const cleanName = (s: string) => s.replace(/\s*\((The Honorable|Hon\.?)\)\s*/gi, "").trim();

interface Donor {
  name: string;
  type: "ENTITY" | "INDIVIDUAL";
  employer: string;
  occupation: string;
  city: string;
  state: string;
  amount: number;
  count: number;
}
interface CandAgg {
  filerIdent: string;
  name: string;
  office: string;
  total: number;
  count: number;
  fromEntities: number;
  latest: string;
  donors: Map<string, Donor>;
}

function donorKey(f: string[], ix: Record<string, number>): { key: string; donor: Omit<Donor, "amount" | "count"> } {
  const type = f[ix.contributorPersentTypeCd] === "ENTITY" ? "ENTITY" : "INDIVIDUAL";
  const name =
    type === "ENTITY"
      ? f[ix.contributorNameOrganization].trim()
      : [f[ix.contributorNameFirst], f[ix.contributorNameLast]].filter(Boolean).join(" ").trim();
  const key = `${type}|${name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ")}|${type === "INDIVIDUAL" ? f[ix.contributorStreetCity]?.toUpperCase() : ""}`;
  return {
    key,
    donor: {
      name, type,
      employer: f[ix.contributorEmployer] ?? "",
      occupation: f[ix.contributorOccupation] ?? "",
      city: f[ix.contributorStreetCity] ?? "",
      state: f[ix.contributorStreetStateCd] ?? "",
    },
  };
}

async function ensureZip(fetchFn: (u: string, init?: RequestInit) => Promise<Response>, log: (m: string) => void): Promise<{ fresh: boolean; lastModified: string | null }> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const head = await fetchFn(URL_ZIP, { method: "HEAD" });
  const lastModified = head.headers.get("last-modified");
  const meta = existsSync(META_PATH) ? (JSON.parse(readFileSync(META_PATH, "utf8")) as { lastModified: string | null }) : null;
  if (existsSync(ZIP_PATH) && meta?.lastModified && meta.lastModified === lastModified && statSync(ZIP_PATH).size > 1e8) {
    log(`TEC archive unchanged (${lastModified}); using cache`);
    return { fresh: false, lastModified };
  }
  log("Downloading TEC archive (~1 GB)…");
  const res = await fetch(URL_ZIP, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`TEC download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(ZIP_PATH));
  writeFileSync(META_PATH, JSON.stringify({ lastModified, downloadedAt: new Date().toISOString() }));
  return { fresh: true, lastModified };
}

export const txTecAdapter: Adapter = {
  id: "tx-tec",
  name: "Texas Ethics Commission: state campaign finance",
  url: "https://www.ethics.state.tx.us/search/cf/",
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly (TEC regenerates the export regularly; re-downloaded only when it changes)",
  refreshMinutes: 10_080,
  coverage:
    "Texas state races only. Itemized 2025–2026 contributions to candidates for Governor, Lieutenant Governor, Attorney General, Comptroller, Land, Agriculture and Railroad Commissioner, plus the largest donors to all Texas state candidates, legislature included. Superseded reports are excluded. Unitemized small contributions, spending by Texas PACs and in-kind valuations aren't broken out.",
  async run({ fetch, log, lookup }) {
    const { lastModified } = await ensureZip(fetch, log);
    const zip = new Uint8Array(readFileSync(ZIP_PATH));
    // Filers: who is seeking which office
    const filersTxt = strFromU8(unzipSync(zip, { filter: (f) => f.name === "filers.csv" })["filers.csv"]);
    const fLines = filersTxt.split("\n");
    const fh = splitCsvLine(fLines[0])!;
    const fi = Object.fromEntries(fh.map((h, i) => [h, i]));
    const targets = new Map<string, { name: string; office: string }>();
    for (const l of fLines.slice(1)) {
      const f = splitCsvLine(l);
      if (!f || f[fi.filerTypeCd] !== "COH") continue;
      const office = STATEWIDE[f[fi.ctaSeekOfficeCd]];
      if (office) targets.set(f[fi.filerIdent], { name: cleanName(f[fi.filerName]), office });
    }

    // Specific-purpose committees that support a candidate (e.g. "Texans for Greg Abbott" → Abbott).
    // Their receipts count toward the candidate; transfers between a candidate's own committees are excluded.
    const spacTxt = strFromU8(unzipSync(zip, { filter: (f) => f.name === "spacs.csv" })["spacs.csv"]);
    const sLines = spacTxt.split("\n");
    const sh = splitCsvLine(sLines[0])!;
    const si = Object.fromEntries(sh.map((h, i) => [h, i]));
    const spacToCand = new Map<string, string>();
    const ownCommitteeNames = new Map<string, Set<string>>(); // candidate filerIdent → normalized own-committee names
    const norm = (x: string) => x.toUpperCase().replace(/\(DISSOLVED\)/, "").replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    for (const l of sLines.slice(1)) {
      const f = splitCsvLine(l);
      if (!f || f[si.spacPositionCd] !== "SUPPORT") continue;
      const cand = f[si.candidateFilerIdent];
      const set = ownCommitteeNames.get(cand) ?? new Set();
      set.add(norm(f[si.spacFilerName]));
      ownCommitteeNames.set(cand, set);
      if (f[si.spacCommitteeStatusCd] === "ACTIVE" && f[si.candidateFilerTypeCd] === "COH") spacToCand.set(f[si.spacFilerIdent], cand);
    }
    for (const [cand, t] of targets) (ownCommitteeNames.get(cand) ?? ownCommitteeNames.set(cand, new Set()).get(cand)!).add(norm(t.name));
    const spacIdents = [...spacToCand.keys()];

    // Contributions, one archive member at a time
    const members: string[] = [];
    unzipSync(zip, { filter: (f) => { if (/^contribs_\d+\.csv$/.test(f.name)) members.push(f.name); return false; } });
    const cands = new Map<string, CandAgg>();
    const allDonors = new Map<string, Donor>();
    let rows = 0;
    let kept = 0;
    for (const m of members.sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))) {
      const text = strFromU8(unzipSync(zip, { filter: (f) => f.name === m })[m]);
      const lines = text.split("\n");
      const h = splitCsvLine(lines[0])!;
      const ix = Object.fromEntries(h.map((x, i) => [x, i]));
      let recentInFile = 0;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const isCoh = line.indexOf(",COH,") !== -1;
        if (!isCoh && (line.indexOf(",SPAC,") === -1 || !spacIdents.some((id) => line.includes(`,${id},`)))) continue;
        rows++;
        const f = splitCsvLine(line);
        if (!f || f[ix.infoOnlyFlag] === "Y") continue;
        // Recipient candidate: the COH account itself, or the candidate a supporting SPAC is linked to.
        const recipient = f[ix.filerTypeCd] === "COH" ? f[ix.filerIdent] : f[ix.filerTypeCd] === "SPAC" ? spacToCand.get(f[ix.filerIdent]) : undefined;
        if (!recipient) continue;
        const dt = f[ix.contributionDt];
        if (!dt || dt < SINCE) continue;
        const amt = Number(f[ix.contributionAmount]);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const { key, donor } = donorKey(f, ix);
        // Skip transfers among the candidate's own committees (would double count).
        if (donor.type === "ENTITY" && ownCommitteeNames.get(recipient)?.has(norm(donor.name))) continue;
        recentInFile++;
        kept++;
        const d = allDonors.get(key) ?? { ...donor, amount: 0, count: 0 };
        d.amount += amt;
        d.count++;
        allDonors.set(key, d);
        const t = targets.get(recipient);
        if (!t) continue;
        const ca = cands.get(recipient) ?? { filerIdent: recipient, name: t.name, office: t.office, total: 0, count: 0, fromEntities: 0, latest: "", donors: new Map() };
        ca.total += amt;
        ca.count++;
        if (donor.type === "ENTITY") ca.fromEntities += amt;
        if (dt > ca.latest) ca.latest = dt;
        const cd = ca.donors.get(key) ?? { ...donor, amount: 0, count: 0 };
        cd.amount += amt;
        cd.count++;
        ca.donors.set(key, cd);
        cands.set(recipient, ca);
      }
      log(`  ${m}: ${recentInFile} contributions since 2025`);
    }
    log(`TEC: scanned ${rows} candidate contribution rows, kept ${kept} from 2025–26; ${cands.size} statewide candidates with money`);

    const src = (title: string, url: string) => ({ title, url, publisher: "Texas Ethics Commission", kind: "data" as const });
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const races = lookup("race").filter((r) => r.state === "TX");
    const candidates = lookup("candidate").filter((c) => c.state === "TX");

    for (const ca of cands.values()) {
      if (ca.total < 1000) continue;
      const top = [...ca.donors.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);
      entities.push({
        id: `statecand:TX:${ca.filerIdent}`,
        kind: "finance",
        state: "TX",
        title: ca.name,
        date: ymd(ca.latest),
        status: "state_candidate_money",
        searchText: `${ca.office} ${top.map((d) => d.name).join(" ")}`,
        sources: [src(`TEC filer ${ca.filerIdent}`, `https://www.ethics.state.tx.us/search/cf/`)],
        confidence: "high",
        data: {
          filerIdent: ca.filerIdent, name: ca.name, office: ca.office, total: ca.total, count: ca.count,
          fromEntities: ca.fromEntities, fromIndividuals: ca.total - ca.fromEntities, latest: ymd(ca.latest), since: ymd(SINCE), topDonors: top, archiveLastModified: lastModified,
          committees: [...spacToCand].filter(([, c]) => c === ca.filerIdent).map(([id]) => id),
        },
      });
      // Link to the curated governor race candidate by last name.
      if (ca.office === "Governor") {
        const race = races.find((r) => (r.data as { office: string }).office === "Governor");
        // TEC names are "Last, First (Title)"; reorder before matching on last name.
        const tecLast = nameKey(ca.name.replace(/\s*\(.*?\)/g, "").replace(/^(.+?),\s*(.+)$/, "$2 $1")).last;
        const cand = candidates.find((c) => c.id.startsWith("candidate:2026-gov-TX:") && nameKey((c.data as { name: string }).name).last === tecLast);
        if (cand) {
          relations.push({ src: cand.id, dst: `statecand:TX:${ca.filerIdent}`, type: "has_state_finance" });
          if (race) relations.push({ src: `statecand:TX:${ca.filerIdent}`, dst: race.id, type: "money_in" });
        }
      }
    }

    const ranked = [...allDonors.values()].sort((a, b) => b.amount - a.amount);
    entities.push({
      id: "statedonors:TX",
      kind: "finance",
      state: "TX",
      title: "Top donors to Texas state candidates (2025–26)",
      status: "state_donors",
      sources: [src("TEC campaign finance CSV export", URL_ZIP)],
      confidence: "high",
      data: {
        since: ymd(SINCE),
        total: ranked.reduce((n, d) => n + d.amount, 0),
        topEntities: ranked.filter((d) => d.type === "ENTITY").slice(0, 30),
        topIndividuals: ranked.filter((d) => d.type === "INDIVIDUAL").slice(0, 30),
        statewide: [...cands.values()].filter((c) => c.total >= 1000).sort((a, b) => b.total - a.total).map((c) => ({ filerIdent: c.filerIdent, name: c.name, office: c.office, total: c.total })),
        archiveLastModified: lastModified,
      },
    });
    return { entities, relations };
  },
};
