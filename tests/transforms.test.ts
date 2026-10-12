import { describe, expect, it } from "vitest";
import { parseFederalBillId } from "../lib/adapters/congress";
import { fecDate, fecName, parseCsv } from "../lib/adapters/fec";
import { aaaDate, parseAaaStates, parseEiaWeekly } from "../lib/adapters/gas";
import { nameKey } from "../lib/adapters/resolve";
import { Bill, isDisallowedSource } from "../lib/schema";

describe("source rules", () => {
  it("rejects Wikipedia, wikis, forums and AI portals", () => {
    expect(isDisallowedSource("https://en.wikipedia.org/wiki/Data_center")).toBe(true);
    expect(isDisallowedSource("https://www.reddit.com/r/x")).toBe(true);
    expect(isDisallowedSource("https://citizenportal.ai/articles/1")).toBe(true);
    expect(isDisallowedSource("not a url")).toBe(true);
    expect(isDisallowedSource("https://lis.virginia.gov/bill-details/20261/HB1")).toBe(false);
    expect(isDisallowedSource("https://notwikipedia.org.example.com/")).toBe(false);
  });

  const bill = {
    id: "VA-2026-HB1",
    jurisdiction: "VA",
    session: "2026",
    number: "HB 1",
    title: "Data centers; moratorium",
    url: "https://lis.virginia.gov/bill-details/20261/HB1",
    latestAction: { date: "2026-02-01", text: "Continued to 2027" },
    status: "carried_over",
    themes: ["moratorium"],
    explicitDataCenter: true,
    impact: "restrictive",
    summary: "s",
    significance: "s",
    verifiedAt: "2026-10-11",
    confidence: "high",
  };

  it("accepts a record with an official source", () => {
    const r = Bill.safeParse({ ...bill, sources: [{ title: "LIS", url: bill.url, publisher: "Virginia LIS", kind: "official" }] });
    expect(r.success).toBe(true);
  });

  it("rejects a record supported only by aggregators", () => {
    const r = Bill.safeParse({
      ...bill,
      sources: [{ title: "Tracker", url: "https://www.billtrack50.com/x", publisher: "BillTrack50", kind: "aggregator" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a Wikipedia citation even alongside a good one", () => {
    const r = Bill.safeParse({
      ...bill,
      sources: [
        { title: "LIS", url: bill.url, publisher: "Virginia LIS", kind: "official" },
        { title: "Wiki", url: "https://en.wikipedia.org/wiki/X", publisher: "Wikipedia", kind: "research" },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("FEC parsing", () => {
  it("parses quoted CSV fields with commas, quotes and newlines", () => {
    expect(parseCsv('a,"b, c","d ""q"""\n"x\ny",2\n')).toEqual([
      ["a", "b, c", 'd "q"'],
      ["x\ny", "2"],
    ]);
  });
  it("normalizes FEC dates", () => {
    expect(fecDate("16-MAY-26")).toBe("2026-05-16");
    expect(fecDate("02/13/2026")).toBe("2026-02-13");
    expect(fecDate("")).toBeNull();
  });
  it("normalizes FEC names", () => {
    expect(fecName("BEGICH, NICHOLAS III")).toBe("Nicholas Begich III");
    expect(fecName("O'ROURKE, BETO")).toBe("Beto O'Rourke");
  });
});

describe("gas price parsing", () => {
  it("reads the AAA observation date", () => {
    expect(aaaDate("<p>Price as of 10/11/26</p>")).toBe("2026-10-11");
    expect(aaaDate("<p>no date</p>")).toBeNull();
  });
  it("parses AAA state table rows", () => {
    const html = `<table id="sortable"><tbody>
      <tr><td><a>Alaska</a></td><td>$5.0223</td><td>$5.2515</td><td>$5.4696</td><td>$6.5691</td></tr>
      <tr><td>Atlantis</td><td>$1.00</td></tr></tbody></table>`;
    const obs = parseAaaStates(html, "2026-10-11");
    expect(obs).toHaveLength(4);
    expect(obs[0]).toEqual({ series: "aaa_regular", area: "AK", date: "2026-10-11", value: 5.0223, unit: "USD/gal" });
  });
  it("parses EIA weekly rows and skips blanks", () => {
    const html = `<table><tr><td>2026-Sep</td><td>09/07</td><td>4.157</td><td>09/14</td><td>4.319</td><td></td><td></td></tr>
      <tr><td>2026-Oct</td><td>10/05</td><td>4.354</td><td></td><td></td></tr></table>`;
    expect(parseEiaWeekly(html, "US").map((o) => [o.date, o.value])).toEqual([
      ["2026-09-07", 4.157],
      ["2026-09-14", 4.319],
      ["2026-10-05", 4.354],
    ]);
  });
});

describe("entity resolution", () => {
  it("normalizes names for matching", () => {
    expect(nameKey("T. Jonathan Ossoff")).toEqual({ first: "jonathan", last: "ossoff" });
    expect(nameKey('Robert "Bob" Casey Jr.')).toEqual({ first: "robert", last: "casey" });
    expect(nameKey("José Peña")).toEqual({ first: "jose", last: "pena" });
  });
  it("parses federal bill ids", () => {
    expect(parseFederalBillId("US-119-HR4776")).toEqual({ congress: 119, type: "hr", number: "4776" });
    expect(parseFederalBillId("US-119-S1")).toEqual({ congress: 119, type: "s", number: "1" });
    expect(parseFederalBillId("VA-2026-HB1")).toBeNull();
  });
});
