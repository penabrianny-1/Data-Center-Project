import { describe, expect, it } from "vitest";
import type { CandidateTotals } from "../lib/adapters/state/contract";
import { hiCandidates, hiDonor, hiWhere } from "../lib/adapters/state/hi";
import { ilClients } from "../lib/adapters/state/il";
import { maineClients, money, parseCsv } from "../lib/adapters/state/me";
import {
  nyAggregate, nyAssignCommittees, nyBillsIn, nyClientName, nyCommitteeMatches, nyDonor, nyLatestFilings, nyLobbyists, nySelfTransfer,
} from "../lib/adapters/state/ny";
import { ClientBook, dataCenterBills, dataCenterWhere, normBill, soda, sodaAll, soqlUrl, waDonors, waL2DataCenter, waWhere } from "../lib/adapters/state/wa";

const fakeCtx = (pages: unknown[][]) => {
  const urls: string[] = [];
  return {
    urls,
    ctx: {
      env: {} as unknown as NodeJS.ProcessEnv,
      log: () => {},
      fetch: async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(pages.shift() ?? []));
      },
    },
  };
};

describe("Socrata helpers", () => {
  it("builds SoQL URLs", () => {
    const u = new URL(soqlUrl("data.wa.gov", "kv7h-kjye", { $select: "sum(amount) as amt", $where: "a = 'b'", $limit: 10 }));
    expect(u.pathname).toBe("/resource/kv7h-kjye.json");
    expect(u.searchParams.get("$select")).toBe("sum(amount) as amt");
    expect(u.searchParams.get("$limit")).toBe("10");
  });

  it("pages with $offset until a short page", async () => {
    const { ctx, urls } = fakeCtx([[{ a: 1 }, { a: 2 }], [{ a: 3 }]]);
    const rows = await sodaAll(ctx, "data.example.gov", "abcd-1234", { $order: "a" }, 2);
    expect(rows).toHaveLength(3);
    expect(urls.map((x) => new URL(x).searchParams.get("$offset"))).toEqual(["0", "2"]);
    await expect(sodaAll(ctx, "data.example.gov", "abcd-1234", {})).rejects.toThrow(/\$order/);
  });

  it("sends the app token only when configured", async () => {
    const seen: Record<string, string>[] = [];
    const ctx = { env: { SOCRATA_APP_TOKEN: "tok" } as unknown as NodeJS.ProcessEnv, fetch: async (_u: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response("[]");
    } };
    await soda(ctx, "data.example.gov", "abcd-1234", {});
    expect(seen[0]["X-App-Token"]).toBe("tok");
  });

  it("normalizes bill numbers and finds data-center bills", () => {
    expect(normBill("LD 307")).toBe("LD307");
    expect(normBill("S6394B")).toBe("S6394");
    expect(normBill("A 09086")).toBe("A9086");
    const bills = dataCenterBills((k) => (k === "bill" ? [
      { id: "b1", kind: "bill", state: "ME", title: "LD 307: An Act to Establish the Maine Data Center Coordination Council", data: {} },
      { id: "b2", kind: "bill", state: "ME", title: "LD 1: An Act About Roads", data: {} },
      { id: "b3", kind: "bill", state: "NY", title: "S6394B: New York State Sustainable Data Centers Act", data: {} },
    ] : []), "ME");
    expect([...bills]).toEqual(["LD307"]);
    expect(dataCenterWhere(["x"])).toContain("upper(x) like '%DATA CENTER%'");
  });

  it("accumulates lobbying clients by normalized name", () => {
    const b = new ClientBook();
    b.addAmount("Acme, Inc.", 100);
    b.addAmount("ACME INC", 50);
    ClientBook.push(b.get("acme inc").firms, "Firm A");
    ClientBook.push(b.get("acme inc").firms, "FIRM A");
    expect(b.list()).toHaveLength(1);
    expect(b.get("Acme Inc").amount).toBe(150);
    expect(b.get("Acme Inc").firms).toEqual(["Firm A"]);
  });
});

describe("Washington PDC", () => {
  it("filters to state candidates and ballot committees, excluding self and unitemized lines", () => {
    const w = waWhere();
    expect(w).toContain("receipt_date >= '2025-01-01T00:00:00'");
    expect(w).toContain("for_or_against IS NOT NULL");
    expect(w).toContain("code != 'Self'");
    expect(w).toContain("contributor_name != filer_name");
    expect(w).toContain("'SMALL CONTRIBUTIONS'");
  });

  it("folds grouped contributions, netting corrections, typed by code", () => {
    const d = waDonors([
      { contributor_name: "SEIU 775", code: "Union", contributor_city: "Seattle", amt: "1000", n: "3" },
      { contributor_name: "SEIU 775", code: "Union", contributor_city: "Tukwila", amt: "-200", n: "1" }, // C.1 correction row
      { contributor_name: "Jane Doe", code: "Individual", contributor_city: "Spokane", emp: "ACME", amt: "500", n: "2" },
      { contributor_name: "Zero", code: "Business", amt: "0", n: "1" },
    ]);
    const seiu = [...d.values()].find((x) => x.name === "SEIU 775")!;
    expect(seiu).toMatchObject({ type: "ENTITY", amount: 800, count: 4 });
    expect([...d.values()].find((x) => x.name === "Jane Doe")).toMatchObject({ type: "INDIVIDUAL", employer: "ACME", count: 2 });
    expect(d.size).toBe(2);
  });

  it("flags only the L2 client whose lobbying entry mentions data centers", () => {
    const report = JSON.stringify({
      sources: [{ id: 1, name: "Firm" }, { id: 2, name: "CLIMATE SOLUTIONS" }, { id: 3, name: "ROADS INC" }],
      lobbying: [
        { source: 2, subject: ["Energy and utilities"], issue: ["Clean Energy, Data Centers"], bill_number: [] },
        { source: 3, subject: ["Transportation"], issue: ["Highways"], bill_number: ["HB 1000"] },
      ],
    });
    expect(waL2DataCenter(report, new Set())).toEqual([{ client: "CLIMATE SOLUTIONS", issue: "Clean Energy, Data Centers" }]);
    expect(waL2DataCenter(report, new Set(["HB1000"])).map((h) => h.client)).toEqual(["CLIMATE SOLUTIONS", "ROADS INC"]);
    expect(waL2DataCenter("not json", new Set())).toEqual([]);
  });
});

describe("Hawaii CSC", () => {
  it("excludes candidate self-funding and the test filer", () => {
    expect(hiWhere(["Governor"])).toContain("contributor_type != 'Candidate'");
    expect(hiWhere(["Governor"])).toContain("upper(candidate_name) != 'TEST'");
  });

  it("aggregates statewide candidates from grouped rows", () => {
    const rows = [
      { reg_no: "CC1", candidate_name: "Green, Josh", office: "Governor", contributor_name: "Doe, Jane", contributor_type: "Individual", city: "Honolulu", amt: "6000", n: "2", latest: "2026-09-01T10:00:00.000" },
      { reg_no: "CC1", candidate_name: "Green, Josh", office: "Governor", contributor_name: "Hawaii Realtors PAC", contributor_type: "Noncandidate Committee", city: "Honolulu", amt: "4000", n: "1", latest: "2026-09-20T10:00:00.000" },
      { reg_no: "CC2", candidate_name: "Anthony, Daniel*", office: "Lt. Governor", contributor_name: "Roe, Rick", contributor_type: "Immediate Family", amt: "100", n: "1" },
      { reg_no: "CC3", candidate_name: "Mayor, Some", office: "Mayor", contributor_name: "X", contributor_type: "Individual", amt: "100", n: "1" },
    ];
    const c = hiCandidates(rows);
    expect(c.map((x) => [x.name, x.office])).toEqual([["Josh Green", "Governor"], ["Daniel Anthony", "Lieutenant Governor"]]);
    expect(c[0]).toMatchObject({ total: 10000, count: 3, fromEntities: 4000, latest: "2026-09-20", committees: ["CC1"] });
    expect([...c[0].donors.values()].map((d) => d.name)).toContain("Jane Doe");
    expect(hiDonor(rows[2]).type).toBe("INDIVIDUAL");
  });
});

describe("Illinois registrations", () => {
  it("treats client-less rows as self-lobbying only for entities with no named clients", () => {
    const { book, registrations } = ilClients([
      { ent_reg_year: "2026", ent_id: "2", ent_name: "3M COMPANY", client_id: "0", lobbyist_fname: "TYLER", lobbyist_lname: "CLARK" },
      { ent_reg_year: "2026", ent_id: "9", ent_name: "FAEGRE DRINKER", client_id: "0", lobbyist_fname: "A", lobbyist_lname: "B" },
      { ent_reg_year: "2026", ent_id: "9", ent_name: "FAEGRE DRINKER", client_id: "5", client_name: "DATA CENTER COALITION", lobbyist_fname: "JOHN", lobbyist_lname: "TIETZ" },
      { ent_reg_year: "2026", ent_id: "9", ent_name: "FAEGRE DRINKER", client_id: "5", client_name: "DATA CENTER COALITION", lobbyist_fname: "JANE", lobbyist_lname: "PANTOJA" },
    ]);
    expect(book.list().map((c) => c.name).sort()).toEqual(["3M COMPANY", "DATA CENTER COALITION"]);
    const dcc = book.get("DATA CENTER COALITION");
    expect(dcc).toMatchObject({ dataCenter: true, filings: 1, firms: ["FAEGRE DRINKER"], lobbyists: ["John Tietz", "Jane Pantoja"], amount: null });
    expect(registrations).toBe(2);
  });
});

describe("Maine lobbying exports", () => {
  it("parses CSV with BOM, NULs, quotes and embedded newlines", () => {
    const rows = parseCsv('﻿Client,Interest\n"Acme, Inc.","Line one\nline ""two"""\0\nB,x\n');
    expect(rows).toEqual([{ Client: "Acme, Inc.", Interest: 'Line one\nline "two"' }, { Client: "B", Interest: "x" }]);
    expect(money("$1,234.50")).toBe(1234.5);
  });

  it("sums compensation for 2025–26 and flags data-center issues and bills", () => {
    const book = maineClients({
      clients: [{ Client: "AGC Maine", "Primary Lobbyist": "Matt Marks", "Lobbying Firm": "AGC Maine", "Legislative Interest": "Construction" }],
      comp: [
        { "Lobbying Year": "2026", Month: "March", "Primary Lobbyist": "Matt Marks", Client: "AGC Maine", "Comp. for Lobbying": "$1,000.00" },
        { "Lobbying Year": "2024", Month: "March", "Primary Lobbyist": "Matt Marks", Client: "AGC Maine", "Comp. for Lobbying": "$9,999.00" },
        { "Lobbying Year": "2025", Month: "May", "Primary Lobbyist": "Pat Lee", Client: "Central Maine Power Company", "Comp. for Lobbying": "$500.00" },
      ],
      bills: [
        { "Lobbying Year": "2026", Month: "March", "Primary Lobbyist": "Matt Marks", Client: "AGC Maine", "Bill or Issue": "Data Centers" },
        { "Lobbying Year": "2025", Month: "May", "Primary Lobbyist": "Pat Lee", Client: "Central Maine Power Company", "Bill or Issue": "LD 307" },
      ],
      expenditures: [{ "Lobbying Year": "2026", Month: "March", Client: "AGC Maine", Amount: "$25.00" }],
    }, new Set(["LD307"]));
    expect(book.get("AGC Maine")).toMatchObject({ amount: 1025, filings: 1, dataCenter: true, firms: [] });
    expect(book.get("Central Maine Power Company")).toMatchObject({ amount: 500, dataCenter: true, issues: ["LD 307"] });
  });
});

describe("New York BOE", () => {
  it("matches committees to candidates by name", () => {
    expect(nyCommitteeMatches("Friends for Kathy Hochul", "Kathy C. Hochul")).toBe(true);
    expect(nyCommitteeMatches("Blakeman for New York", "Bruce   Blakeman")).toBe(true);
    expect(nyCommitteeMatches("James for NY 2026", "Letitia  James")).toBe(true);
    expect(nyCommitteeMatches("Friends of Mariama James", "Letitia  James")).toBe(false);
    expect(nyCommitteeMatches("Friends Of James Gary Pretlow", "Letitia  James")).toBe(false);
    expect(nyCommitteeMatches("LaToya Benjamin for Assembly", "Brian A. Benjamin")).toBe(false);
    expect(nyCommitteeMatches("Raj Goyle for New York", "Rajeev  Kumar Goyle")).toBe(true);
    expect(nyCommitteeMatches("Saritha for New York", "Saritha  Komatireddy")).toBe(true);
    expect(nyCommitteeMatches("Brian for NY", "Brian A. Benjamin")).toBe(false);
  });

  it("prefers last-name matches and drops ties", () => {
    const cands = [{ filer_id: "1", filer_name: "Letitia James" }, { filer_id: "2", filer_name: "James M Kernan" }];
    const m = nyAssignCommittees(cands, [{ filer_id: "c1", filer_name: "James for NY 2026" }, { filer_id: "c2", filer_name: "Jim Kernan for Governor 2026" }]);
    expect(m.get("1")!.map((c) => c.filer_id)).toEqual(["c1"]);
    expect(m.get("2")!.map((c) => c.filer_id)).toEqual(["c2"]);
  });

  it("types donors by name fields", () => {
    expect(nyDonor({ flng_ent_first_name: "Alix", flng_ent_last_name: "Travis", flng_ent_city: "Rhinebeck" })).toMatchObject({ name: "Alix Travis", type: "INDIVIDUAL" });
    expect(nyDonor({ flng_ent_name: "Capital One Services LLC" })).toMatchObject({ type: "ENTITY" });
    expect(nyDonor({})).toBeNull();
  });

  it("subtracts refunds from the matching donor and skips own-committee transfers", () => {
    const cand: CandidateTotals = { filerId: "27937", name: "Letitia James", office: "Attorney General", total: 0, count: 0, fromEntities: 0, latest: null, donors: new Map(), committees: [] };
    const candidates = new Map([["27937", cand]]);
    const all = nyAggregate({
      rows: [
        { filer_id: "308810", filing_sched_abbrev: "A", flng_ent_first_name: "charles", flng_ent_last_name: "Tebele", flng_ent_city: "Brooklyn", amt: "18000", n: "1", latest: "2026-01-02T00:00:00.000" },
        { filer_id: "308810", filing_sched_abbrev: "A", flng_ent_first_name: "Ann", flng_ent_last_name: "Lee", flng_ent_city: "Albany", amt: "500", n: "2", latest: "2027-05-06T00:00:00.000" },
        { filer_id: "308810", filing_sched_abbrev: "M", flng_ent_name: "charles Tebele", amt: "18000", n: "1" },
        { filer_id: "308810", filing_sched_abbrev: "C", flng_ent_name: "James For NY", amt: "100000", n: "1" },
      ],
      committeeNames: new Map([["308810", "James for NY 2026"], ["1383", "James For NY"]]),
      committeeToCand: new Map([["308810", "27937"], ["1383", "27937"]]),
      candidates,
    }, "2026-10-12");
    expect(cand.total).toBe(500);
    expect([...cand.donors.values()].map((d) => d.name)).toEqual(["Ann Lee"]);
    expect(cand.latest).toBe("2026-01-02"); // the 2027 (mistyped) date is ignored
    expect([...all.values()].map((d) => d.name)).toEqual(["Ann Lee"]);
    expect(nySelfTransfer("Friends of Joe Griffo 2024", "Griffo for Senate 2026", new Set(["FRIENDS OF JOE GRIFFO 2024"]))).toBe(true);
    expect(nySelfTransfer("NYS Democratic Committee", "Griffo for Senate 2026", new Set(["FRIENDS OF JOE GRIFFO 2024"]))).toBe(false);
  });
});

describe("New York COELIG", () => {
  it("keeps the latest filing per lobbyist/client/period", () => {
    const base = { reporting_period: "Jan/Feb", principal_lobbyist_name: "SHEPPARD MULLIN", contractual_client_name: "AMAZON.COM SERVICES LLC", beneficial_client_name: "AMAZON.COM SERVICES LLC;", year: "2025" };
    const m = nyLatestFilings([
      { ...base, form_submission_id: "715250", filing_type: "Original", comp: "12179", reimb: "0" },
      { ...base, form_submission_id: "723261", filing_type: "Amendment", comp: "30000", reimb: "100" },
      { ...base, reporting_period: "Mar/Apr", form_submission_id: "730000", filing_type: "Original", comp: "5000", reimb: "0" },
    ]);
    expect(m.get("AMAZONCOM SERVICES LLC")).toMatchObject({ amount: 35100, filings: 2 });
  });

  it("parses client, lobbyist and bill fields", () => {
    expect(nyClientName({ beneficial_client_name: "BHE GT&amp;S;", contractual_client_name: "X" })).toBe("BHE GT&S");
    expect(nyClientName({ beneficial_client_name: "", contractual_client_name: "Y Corp" })).toBe("Y Corp");
    expect(nyLobbyists("Hoyt, Sam; Grynspan, Howard ;")).toEqual(["Sam Hoyt", "Howard Grynspan"]);
    expect(nyBillsIn("S6394B, A 9086 and stuff")).toEqual(["S6394", "A9086"]);
  });
});
