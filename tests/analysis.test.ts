import { describe, expect, it } from "vitest";
import { canonicalUrl, parseFeed, tagStates, type Feed } from "../lib/adapters/news";
import { parseBillStatus } from "../lib/adapters/congress";
import { deriveStatus, normalizeIdentifier, toEntity, type OsBill } from "../lib/adapters/openstates";
import { classifyNews, isInternational } from "../lib/news-classify";
import { countyActionIndex, localCategory } from "../lib/local";
import { band, composite, PRESETS, type Weights } from "../lib/scoring";

const equal = PRESETS[0].weights;

describe("composite policy score", () => {
  it("maps the [-2, 2] mean onto 0–100", () => {
    expect(composite({ water: { score: 2, confidence: "high" } }, equal).value).toBe(100);
    expect(composite({ water: { score: -2, confidence: "high" } }, equal).value).toBe(0);
    expect(composite({ water: { score: 0, confidence: "high" } }, equal).value).toBe(50);
  });

  it("never imputes missing dimensions; it reports completeness instead", () => {
    const s = composite({ water: { score: 2, confidence: "high" }, incentives: { score: null, confidence: "low" } }, equal);
    expect(s.value).toBe(100);
    expect(s.completeness).toBeCloseTo(0.1);
    expect(composite({}, equal)).toMatchObject({ value: null, completeness: 0 });
  });

  it("respects weights, including zero weights", () => {
    const w = { ...equal, water: 3, incentives: 1, electricity: 0 } as Weights;
    const s = composite(
      { water: { score: -2, confidence: "high" }, incentives: { score: 2, confidence: "medium" }, electricity: { score: 2, confidence: "high" } },
      w,
    );
    // (3*-2 + 1*2) / 4 = -1 → 25
    expect(s.value).toBe(25);
    expect(s.highConfidenceShare).toBeCloseTo(0.75);
  });

  it("bands values", () => {
    expect(band(null).tone).toBe("unknown");
    expect(band(70).tone).toBe("permissive");
    expect(band(50).tone).toBe("mixed");
    expect(band(20).tone).toBe("restrictive");
  });
});

describe("news feed parsing", () => {
  const general: Feed = { id: "t", outlet: "Test", url: "https://x.org/feed", home: "https://x.org/", type: "trade", mode: "general" };
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>County approves data center moratorium in Virginia</title><link>https://x.org/a?utm_source=rss</link><pubDate>Fri, 09 Oct 2026 20:29:47 GMT</pubDate><description>&lt;p&gt;Loudoun &amp;amp; more&lt;/p&gt;</description></item>
    <item><title>Hurricane update</title><link>https://x.org/b</link></item>
  </channel></rss>`;

  it("keeps only data-center items from general feeds and normalizes fields", () => {
    const items = parseFeed(rss, general);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "County approves data center moratorium in Virginia", published: "2026-10-09T20:29:47.000Z", states: ["VA"], policySignal: true });
  });

  it("drops off-topic and sponsored items even from curated tag feeds", () => {
    expect(parseFeed(rss, { ...general, mode: "tag", state: "PA" })).toHaveLength(1);
    const ad = `<rss><channel><item><title>Sponsored: Making every data center watt work</title><link>https://x.org/s</link></item></channel></rss>`;
    expect(parseFeed(ad, general)).toHaveLength(0);
  });

  it("parses Google News sitemaps (CNN)", () => {
    const sm = `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>https://www.cnn.com/2026/10/12/tech/data-center-power</loc><news:news><news:publication_date>2026-10-12T10:00:00Z</news:publication_date><news:title>Data center boom strains the Texas grid</news:title></news:news></url><url><loc>https://www.cnn.com/x</loc><news:news><news:title>Sports</news:title></news:news></url></urlset>`;
    const items = parseFeed(sm, { ...general, mode: "sitemap" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: "https://www.cnn.com/2026/10/12/tech/data-center-power", published: "2026-10-12T10:00:00.000Z" });
  });

  it("parses Atom", () => {
    const atom = `<feed><entry><title>Hyperscale campus proposed in Ohio</title><link href="https://y.org/1"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, general)[0].url).toBe("https://y.org/1");
  });

  it("does not tag Virginia for West Virginia stories", () => {
    expect(tagStates("West Virginia microgrid law")).toEqual(["WV"]);
    expect(tagStates("Virginia and West Virginia")).toEqual(expect.arrayContaining(["VA", "WV"]));
  });

  it("dedupes URLs across tracking params, scheme and trailing slash", () => {
    expect(canonicalUrl("https://www.x.org/a/?utm_source=rss")).toBe(canonicalUrl("http://x.org/a"));
  });
});

describe("GovInfo bill status", () => {
  it("reads only the bill's own top-level fields", () => {
    const xml = `<billStatus><bill><title>SPEED Act</title><introducedDate>2025-07-25</introducedDate>
      <latestAction><actionDate>2025-12-18</actionDate><text>Received in the Senate</text></latestAction>
      <relatedBills><item><latestAction><actionDate>1999-01-01</actionDate><text>wrong</text></latestAction></item></relatedBills>
      <sponsors><item><fullName>Rep. Westerman, Bruce [R-AR-4]</fullName><bioguideId>W000821</bioguideId></item></sponsors>
      <cosponsors><item/><item/></cosponsors></bill></billStatus>`;
    expect(parseBillStatus(xml)).toMatchObject({
      title: "SPEED Act",
      latestAction: { actionDate: "2025-12-18", text: "Received in the Senate" },
      sponsors: [{ bioguideId: "W000821" }],
      cosponsorCount: 2,
      laws: [],
    });
    expect(parseBillStatus("<html/>")).toBeNull();
  });
});

describe("local action categories", () => {
  it("ranks the strongest action per county", () => {
    expect(localCategory({ kind: "moratorium", status: "expired" })).toBe("decision");
    const idx = countyActionIndex([
      { kind: "zoning_ordinance", status: "in_effect", countyFips: "51107" },
      { kind: "ban", status: "in_effect", countyFips: "51107" },
      { kind: "moratorium", status: "in_effect", countyFips: "51153" },
    ]);
    expect(idx["51107"]).toMatchObject({ key: "ban", count: 2 });
    expect(idx["51153"].key).toBe("moratorium");
  });
});

describe("Open States bills", () => {
  const act = (classification: string[], chamber = "lower") => ({ description: "x", date: "2026-02-01", classification, organization: { classification: chamber } });
  it("derives the most advanced status from action classifications", () => {
    expect(deriveStatus([])).toBe("introduced");
    expect(deriveStatus([act(["introduction"]), act(["referral-committee"])])).toBe("in_committee");
    expect(deriveStatus([act(["passage"], "lower")])).toBe("passed_chamber");
    expect(deriveStatus([act(["passage"], "lower"), act(["passage"], "upper")])).toBe("passed_legislature");
    expect(deriveStatus([act(["passage"], "lower"), act(["passage"], "upper"), act(["executive-signature"], "executive")])).toBe("enacted");
    expect(deriveStatus([act(["executive-veto"], "executive")])).toBe("vetoed");
  });
  it("normalizes identifiers and prefers the official legislature URL", () => {
    expect(normalizeIdentifier("H.B. 1234")).toBe("HB1234");
    const bill: OsBill = {
      id: "ocd-bill/abc", session: "2026", jurisdiction: { id: "ocd-jurisdiction/country:us/state:va/government", name: "Virginia" },
      identifier: "HB 1234", title: "Data centers; moratorium", openstates_url: "https://openstates.org/va/bills/2026/HB1234/",
      latest_action_date: "2026-02-10T00:00:00", latest_action_description: "Continued to 2027",
      sources: [{ url: "https://openstates.org/x" }, { url: "https://lis.virginia.gov/bill-details/20261/HB1234" }],
      sponsorships: [{ name: "Jane Doe", primary: true, person: { party: "Democratic" } }], actions: [act(["referral-committee"])],
    };
    const e = toEntity(bill, "VA");
    expect(e.sources?.[0].url).toBe("https://lis.virginia.gov/bill-details/20261/HB1234");
    expect(e.data).toMatchObject({ status: "in_committee", sponsors: [{ name: "Jane Doe", party: "D" }], latestAction: { date: "2026-02-10" } });
  });
});

describe("news categorization", () => {
  const c = (t: string, s = "") => classifyNews(t, s);
  it("puts moratorium headlines first and reads their status", () => {
    expect(c("County commissioners approve one-year data center moratorium")).toMatchObject({ category: "moratorium", signal: "restriction_active" });
    expect(c("Lawmakers consider statewide pause on data centers")).toMatchObject({ category: "moratorium", signal: "under_discussion" });
  });
  it("flags rejections and approvals", () => {
    expect(c("Council rejects 80MW data center rezoning").signal).toBe("project_rejected");
    expect(c("Indiana approves AES plan to power Google data center").signal).toBe("favorable");
  });
  it("routes topics", () => {
    expect(c("Utility seeks new tariff for large-load data center customers").category).toBe("energy_grid");
    expect(c("Senate passes AI preemption bill").topics).toContain("ai_legislation");
    expect(c("Shapiro, Garrity spar on data centers in gubernatorial debate", "election").category).toBe("elections");
    expect(c("Hyperscaler buys chips").category).toBe("industry");
  });
  it("keeps only domestic happenings", async () => {
    const { isDomestic, statesFromPlaces } = await import("../lib/geo-text");
    expect(isInternational("Council rejects 80MW data center in northern Italy", 0)).toBe(true);
    expect(isDomestic("FiveNines Group partners on 20MW data center in Morocco", 0)).toBe(false);
    expect(isDomestic("Ohio lawmakers mull energy overhaul", 1, "Demand from China-linked chip plants")).toBe(true);
    expect(isDomestic("What a $30bn Aussie data centre IPO debacle means", 0)).toBe(false);
    expect(isDomestic("Haaland backs data center moratorium in New Mexico", 1)).toBe(true);
    expect(isDomestic("America’s data center backlash is bipartisan", 0)).toBe(true);
    expect(isDomestic("How to make data centers less thirsty", 0)).toBe(false); // no U.S. place: not a domestic happening
    expect(statesFromPlaces("Memphis council delays moratorium; Nebraskans weigh in")).toEqual(["NE", "TN"]);
  });
});

describe("money & lobbying parsing", async () => {
  const { extractBills, billLabels } = await import("../lib/adapters/lda");
  const { committeeCategory } = await import("../lib/adapters/fec-money");
  it("extracts bill numbers without mistaking 'Section 5' for a Senate bill", () => {
    expect(extractBills("Support H.R. 3616 and S. 1234; see Section 5 and HR5")).toEqual(["HR3616", "S1234", "HR5"]);
  });
  it("pairs bill numbers with their act names", () => {
    expect([...billLabels("H.R. 3616, the Reliable Power Act; GRID Power Act (H.R. 1047)")]).toEqual([["HR3616", "Reliable Power Act"], ["HR1047", "GRID Power Act"]]);
  });
  it("maps FEC committee codes to interest categories", () => {
    expect(committeeCategory("O", "U", "").category).toBe("Super PAC");
    expect(committeeCategory("Y", "U", "").group).toBe("party");
    expect(committeeCategory("Q", "B", "C").category).toBe("Corporate PAC");
    expect(committeeCategory("Q", "U", "L").group).toBe("labor");
    expect(committeeCategory("Q", "D", "").category).toBe("Leadership PAC");
  });
});

describe("Texas Ethics Commission parsing", async () => {
  const { splitCsvLine } = await import("../lib/adapters/tx-tec");
  it("splits quoted CSV lines and rejects unbalanced quotes", () => {
    expect(splitCsvLine('RCPT,COH,"Abbott, Greg (The Honorable)",25.00,"He said ""hi"""')).toEqual(["RCPT", "COH", "Abbott, Greg (The Honorable)", "25.00", 'He said "hi"']);
    expect(splitCsvLine('a,"unterminated')).toBeNull();
  });
});
