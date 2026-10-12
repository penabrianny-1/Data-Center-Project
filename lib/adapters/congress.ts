import * as cheerio from "cheerio";
import type { Adapter, Entity, Relation } from "../ingest/types";

/** "US-119-HR1234" → { congress: 119, type: "hr", number: "1234" } */
export function parseFederalBillId(id: string): { congress: number; type: string; number: string } | null {
  const m = id.match(/^US-(\d{3})-(HR|S|HJRES|SJRES|HCONRES|SCONRES|HRES|SRES)(\d+)$/);
  return m ? { congress: Number(m[1]), type: m[2].toLowerCase(), number: m[3] } : null;
}

const CONGRESS_GOV_PATH: Record<string, string> = {
  hr: "house-bill", s: "senate-bill", hres: "house-resolution", sres: "senate-resolution",
  hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution",
};

export function congressGovUrl(p: { congress: number; type: string; number: string }) {
  return `https://www.congress.gov/bill/${p.congress}th-congress/${CONGRESS_GOV_PATH[p.type]}/${p.number}`;
}

export interface OfficialBillStatus {
  title: string;
  introduced: string | null;
  latestAction: { actionDate: string; text: string } | null;
  sponsors: { fullName: string; bioguideId: string }[];
  cosponsorCount: number;
  laws: { type: string; number: string }[];
  updated: string | null;
}

/** Parse a GovInfo BILLSTATUS XML document (only the bill's own top-level fields). */
export function parseBillStatus(xml: string): OfficialBillStatus | null {
  const $ = cheerio.load(xml, { xml: true });
  const b = $("billStatus > bill").first();
  if (!b.length) return null;
  const la = b.children("latestAction");
  return {
    title: b.children("title").first().text().trim(),
    introduced: b.children("introducedDate").text().trim() || null,
    latestAction: la.length ? { actionDate: la.children("actionDate").text().trim(), text: la.children("text").text().trim() } : null,
    sponsors: b.children("sponsors").children("item").map((_, el) => ({
      fullName: $(el).children("fullName").text().trim(),
      bioguideId: $(el).children("bioguideId").text().trim(),
    })).get(),
    cosponsorCount: b.children("cosponsors").children("item").length,
    laws: b.children("laws").children("item").map((_, el) => ({
      type: $(el).children("type").text().trim(),
      number: $(el).children("number").text().trim(),
    })).get(),
    updated: b.children("updateDateIncludingText").text().trim() || null,
  };
}

/**
 * Official status for every tracked federal bill from GovInfo's BILLSTATUS
 * bulk data (Government Publishing Office / Library of Congress). No API key
 * required. Incremental: only tracked bills are requested.
 */
export const congressAdapter: Adapter = {
  id: "congress-gov",
  name: "Federal bill status (GovInfo BILLSTATUS)",
  url: "https://www.govinfo.gov/bulkdata/BILLSTATUS",
  sourceKind: "official",
  method: "bulk",
  schedule: "Daily",
  refreshMinutes: 1440,
  coverage:
    "Official title, sponsor, cosponsor count, latest action and enactment for each federal bill in the tracked list, from GPO/Library of Congress bulk bill-status XML. New bills come from curated research, since the bulk data has no topic search.",
  dependsOn: ["curated"],
  async run({ fetch, lookup, log }) {
    const federal = lookup("bill").filter((b) => b.state === "US" && b.id.startsWith("bill:"));
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const warnings: string[] = [];

    for (const b of federal) {
      const seedId = b.id.replace(/^bill:/, "");
      const p = parseFederalBillId(seedId);
      if (!p) {
        warnings.push(`${seedId}: id not in US-<congress>-<TYPE><number> form; skipped`);
        continue;
      }
      const xmlUrl = `https://www.govinfo.gov/bulkdata/BILLSTATUS/${p.congress}/${p.type}/BILLSTATUS-${p.congress}${p.type}${p.number}.xml`;
      try {
        const status = parseBillStatus(await (await fetch(xmlUrl, { headers: { Accept: "application/xml" } })).text());
        if (!status) throw new Error("unrecognized BILLSTATUS document");
        const url = congressGovUrl(p);
        entities.push({
          id: `congress:${seedId}`,
          kind: "bill",
          state: "US",
          title: status.title,
          date: status.latestAction?.actionDate ?? null,
          status: status.laws.length ? "enacted" : "official",
          sources: [
            { title: `BILLSTATUS ${seedId}`, url: xmlUrl, publisher: "GovInfo (GPO / Library of Congress)", kind: "official", docId: seedId },
            { title: `Congress.gov: ${seedId}`, url, publisher: "Library of Congress", kind: "official", docId: seedId },
          ],
          verifiedAt: new Date().toISOString().slice(0, 10),
          confidence: "high",
          data: { official: true, seedId, url, ...status },
        });
        relations.push({ src: `congress:${seedId}`, dst: b.id, type: "official_record_of" });
        for (const s of status.sponsors) if (s.bioguideId) relations.push({ src: `legislator:${s.bioguideId}`, dst: b.id, type: "sponsor_of" });
      } catch (err) {
        warnings.push(`${seedId}: ${(err as Error).message}`);
      }
    }
    log(`GovInfo: refreshed ${entities.length}/${federal.length} federal bills`);
    if (federal.length > 0 && entities.length === 0) throw new Error(`All ${federal.length} requests failed: ${warnings[0]}`);
    return { entities, relations, warnings };
  },
};
