import { strFromU8, unzipSync } from "fflate";
import type { Adapter } from "../../ingest/types";
import { buildLobbyEntity, DATA_CENTER_RE, type LobbyClient, type StateLobbyMeta } from "./contract";
import { cachedDownload, orgKey } from "./ky";

/**
 * Wyoming lobbyist registrations from the Secretary of State's lobbyist
 * system, https://lobbyist.wyo.gov/Lobbyist/Default.aspx
 *
 * https://lobbyist.wyo.gov/Lobbyist/Download.aspx returns a ZIP generated on
 * request ("{MM-DD-YYYY}LobbyistData.zip") with pipe-delimited files described
 * by the bundled schemaLobbyist.pdf ("Wyoming Lobbyist Data Export, Physical
 * Data Model, as of April 2018"):
 *   LOBBYIST.txt                    LOBBYIST_ID, LOBBYIST_NUM, STATUS_ID, REGISTRATION_DATE,
 *                                   EXPIRATION_DATE, NAME_ON_BADGE, FIRST/MIDDLE/LAST_NAME, address,
 *                                   PHONE, EMAIL, TERMINATED_DATE
 *   LOBBYIST_ORGANIZATION.txt       LOBBYIST_ORGANIZATION_ID, _NUM, NAME, address, PHONE
 *                                   (the organizations a lobbyist represents, i.e. the principals)
 *   LOBBYIST_ORGANIZATION_XREF.txt  LOBBYIST_ORGANIZATION_XREF_ID, LOBBYIST_ID, LOBBYIST_ORGANIZATION_ID
 * Organization records are not shared: each belongs to one lobbyist, and a
 * lobbyist often has several records for the same principal (observed
 * 2026-10-12: lobbyist 1372 has six "American Red Cross of Wyoming" records,
 * apparently one per renewal). The export has no date on organization records,
 * so principals carried over from a currently registered lobbyist's earlier
 * years can't be told apart from current ones. Records are de-duplicated to
 * distinct lobbyist × principal (normalized name) pairs.
 *
 * The export covers the current registration year only (registrations expire
 * April 30; on 2026-10-12 every active registration expired 2027-04-30). It
 * has no compensation, expenditure, or subject-matter fields. Wyoming
 * lobbyists' expenditure statements are not in the export.
 *
 * lobbyist.wyo.gov has no robots.txt (404, checked 2026-10-12); the download
 * is a public link on the site.
 */

const PAGE = "https://lobbyist.wyo.gov/Lobbyist/Default.aspx";
const DOWNLOAD = "https://lobbyist.wyo.gov/Lobbyist/Download.aspx";

/** Parse one pipe-delimited export file into objects keyed by header. */
export function parsePipe(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const h = lines[0].split("|").map((x) => x.trim());
  return lines.slice(1).map((l) => {
    const f = l.split("|");
    return Object.fromEntries(h.map((k, i) => [k, (f[i] ?? "").trim()]));
  });
}

/** MM/DD/YYYY → YYYY-MM-DD */
const iso = (s: string) => {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

/** Combine the three export files into client rows (exported for tests). */
export function aggregateWy(
  lobbyists: Record<string, string>[],
  orgs: Record<string, string>[],
  xref: Record<string, string>[],
  since = "2025-01-01",
): { clients: LobbyClient[]; registrations: number; latest: string | null } {
  const lob = new Map(lobbyists.map((l) => [l.LOBBYIST_ID, l]));
  const org = new Map(orgs.map((o) => [o.LOBBYIST_ORGANIZATION_ID, o]));
  const clients = new Map<string, LobbyClient>();
  const pairs = new Set<string>();
  let latest: string | null = null;
  for (const x of xref) {
    const l = lob.get(x.LOBBYIST_ID);
    const o = org.get(x.LOBBYIST_ORGANIZATION_ID);
    if (!l || !o || !o.NAME) continue;
    // Keep registrations still in force during 2025–26 (terminated ones only if terminated on/after `since`).
    const term = iso(l.TERMINATED_DATE ?? "");
    const exp = iso(l.EXPIRATION_DATE ?? "");
    if ((term && term < since) || (exp && exp < since)) continue;
    const k = orgKey(o.NAME);
    const pair = `${x.LOBBYIST_ID}|${k}`;
    if (pairs.has(pair)) continue; // same lobbyist re-listing the same principal (one org record per filing)
    pairs.add(pair);
    const reg = iso(l.REGISTRATION_DATE ?? "");
    if (reg && (!latest || reg > latest)) latest = reg;
    let c = clients.get(k);
    if (!c) {
      c = { name: o.NAME, amount: null, filings: 0, lobbyists: [], firms: [], issues: [], dataCenter: false };
      clients.set(k, c);
    }
    c.filings++; // one distinct lobbyist representing this principal
    const name = l.NAME_ON_BADGE || [l.FIRST_NAME, l.MIDDLE_NAME, l.LAST_NAME].filter(Boolean).join(" ");
    if (name && !c.lobbyists.includes(name)) c.lobbyists.push(name);
  }
  for (const c of clients.values()) c.dataCenter = DATA_CENTER_RE.test(c.name);
  return { clients: [...clients.values()], registrations: pairs.size, latest };
}

export const wyLobbyAdapter: Adapter = {
  id: "state-wy-lobby",
  name: "Wyoming Secretary of State: lobbyist registrations",
  url: PAGE,
  sourceKind: "data",
  method: "bulk",
  schedule: "Weekly",
  refreshMinutes: 10_080,
  coverage:
    "Wyoming lobbyists registered for the current registration year (May–April; includes 2026 session registrations still in force) and the organizations each has listed. The export doesn't date principal records, so a principal a current lobbyist represented in an earlier year may still be listed. No compensation, expenditure or issue fields are published, and lobbyists not registered this year are not included.",
  async run({ fetch, log }) {
    const r = await cachedDownload(fetch, DOWNLOAD, "wy-lobbyist-data.zip", { maxAgeMinutes: 720, head: false });
    log(`WY lobbyist export: ${r.bytes.length} bytes${r.fromCache ? " (cached)" : ""}`);
    const files = unzipSync(r.bytes, { filter: (f) => /\.txt$/i.test(f.name) });
    const pick = (n: string) => {
      const key = Object.keys(files).find((k) => k.split("/").pop()!.toUpperCase() === n);
      if (!key) throw new Error(`WY export missing ${n}`);
      return parsePipe(strFromU8(files[key]));
    };
    const { clients, registrations } = aggregateWy(pick("LOBBYIST.TXT"), pick("LOBBYIST_ORGANIZATION.TXT"), pick("LOBBYIST_ORGANIZATION_XREF.TXT"));
    log(`WY: ${registrations} lobbyist–principal registrations, ${clients.length} principals`);
    const meta: StateLobbyMeta = {
      state: "WY",
      agency: "Wyoming Secretary of State",
      sourceUrl: PAGE,
      dataAsOf: new Date().toISOString().slice(0, 10), // export is generated on request
      period: "Current registration year (registrations in force in 2026; expiring 2027-04-30)",
      amountMeaning: null,
    };
    return { entities: [buildLobbyEntity(meta, clients, registrations)] };
  },
};

export const adapters: Adapter[] = [wyLobbyAdapter];
