import { describe, expect, it } from "vitest";
import type { Entity, EntityKind } from "../lib/ingest/types";
import { aggregateCoLobby, coReceipt, CO_CANDIDATES } from "../lib/adapters/state/co";
import {
  aggregate, forEachCsvRecord, forEachCsvRow, isoDate, officeFromCommitteeName, officeResolver, samePerson, type Receipt,
} from "../lib/adapters/state/co-in-ok-ne";
import { inReceipt } from "../lib/adapters/state/in";
import { neReceipt, NE_CANDIDATES } from "../lib/adapters/state/ne";
import { okReceipt } from "../lib/adapters/state/ok";

const rows = (csv: string) => { const out: Record<string, string>[] = []; forEachCsvRecord(csv, (r) => out.push(r)); return out; };
const noLookup = (() => []) as (k: EntityKind) => Entity[];

describe("lenient CSV reader", () => {
  it("handles escapes, embedded newlines and Indiana's unescaped inner quotes", () => {
    const out: string[][] = [];
    forEachCsvRow('a,b,c\r\n"x ""y""","line1\nline2",3\n"BIG "I" PAC","",\n', (f) => out.push(f));
    expect(out).toEqual([["a", "b", "c"], ['x "y"', "line1\nline2", "3"], ['BIG "I" PAC', "", ""]]);
  });
  it("normalizes both date styles", () => {
    expect(isoDate("2026-03-19 00:00:00")).toBe("2026-03-19");
    expect(isoDate("3/9/2026")).toBe("2026-03-09");
  });
});

describe("office classification", () => {
  it("reads offices from committee names but not local ones", () => {
    const ballot = ["Governor", "Attorney General", "Treasurer"] as const;
    expect(officeFromCommitteeName("VICTOR MARX FOR GOVERNOR", [...ballot])).toBe("Governor");
    expect(officeFromCommitteeName("BRASHER FOR NE AG", [...ballot])).toBe("Attorney General");
    expect(officeFromCommitteeName("MARION COUNTY TREASURER", [...ballot])).toBeNull();
    expect(officeFromCommitteeName("FRIENDS OF X FOR LT GOVERNOR", [...ballot])).toBeNull(); // LG not on this ballot
  });
  it("matches names with nicknames and middle names", () => {
    expect(samePerson("Mike Hilgers", "MICHAEL HILGERS")).toBe(true);
    expect(samePerson("Diego Morales", "Cesar Diego Morales")).toBe(true);
    expect(samePerson("Phil Weiser", "PHILIP WEISER")).toBe(true);
    expect(samePerson("Mike Hall", "CHUCK HALL")).toBe(false);
  });
  it("uses the candidate table unless the committee names another office", () => {
    const resolve = officeResolver("NE", ["Governor", "Treasurer"], NE_CANDIDATES, noLookup);
    expect(resolve("SPELLERBERG FOR NEBRASKA", "JOEY SPELLERBERG")).toEqual({ office: "Treasurer", via: "candidate" });
    expect(resolve("JOEY SPELLERBERG FOR MAYOR", "JOEY SPELLERBERG")).toBeNull();
    const co = officeResolver("CO", ["Governor", "Attorney General"], CO_CANDIDATES, noLookup);
    expect(co("JENA FOR COLORADO", "JENA GRISWOLD")?.office).toBe("Attorney General");
    expect(co("VICTOR MARX FOR GOVERNOR", "VICTOR MARX")).toEqual({ office: "Governor", via: "committee" });
  });
  it("adds governor candidates from the database", () => {
    const lookup = ((k: EntityKind) => (k === "candidate" ? [{ id: "candidate:2026-gov-OK:x", kind: "candidate", title: "Pat Example", data: { name: "Pat Example" } }] : [])) as (k: EntityKind) => Entity[];
    expect(officeResolver("OK", ["Governor"], [], lookup)("", "PATRICIA EXAMPLE")?.office).toBe("Governor");
  });
});

describe("state row mappers", () => {
  it("Colorado: keeps itemized monetary statewide candidate rows, drops superseded originals", () => {
    const csv = [
      '"CO_ID","ContributionAmount","ContributionDate","LastName","FirstName","City","State","RecordID","ContributionType","ContributorType","CommitteeType","CommitteeName","CandidateName","Employer","Occupation","Amended","Jurisdiction"',
      '"1","500","2025-06-01 00:00:00","DOE","JANE","DENVER","CO","10","Monetary (Itemized)","Individual","Candidate Committee","X FOR GOVERNOR","X Y","ACME","Lawyer","N","STATEWIDE"',
      '"1","400","2025-06-01 00:00:00","DOE","JANE","DENVER","CO","11","Monetary (Itemized)","Individual","Candidate Committee","X FOR GOVERNOR","X Y","ACME","Lawyer","Y","STATEWIDE"',
      '"1","25","2025-06-01 00:00:00","","","","","12","Monetary (Non-Itemized)","","Candidate Committee","X FOR GOVERNOR","X Y","","","N","STATEWIDE"',
      '"2","900","2025-06-01 00:00:00","ACME INC","","DENVER","CO","13","Monetary (Itemized)","Corporation","Candidate Committee","Z FOR COMMISSIONER","Z","","","N","DENVER"',
    ].join("\n");
    const got = rows(csv).map(coReceipt).filter(Boolean) as Receipt[];
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: "10", amount: 500, date: "2025-06-01", donor: { name: "Jane Doe", type: "INDIVIDUAL", employer: "ACME" } });
  });
  it("Indiana: Direct only, Amended=1 dropped", () => {
    const csv = [
      '"FileNumber","CommitteeType","Committee","CandidateName","ContributorType","Name","City","State","Occupation","Type","Amount","ContributionDate","Amended"',
      '"8088","Candidate","Beau Bayh for Indiana","Beau Bayh","Corporation","Acme Inc","Indianapolis","IN","","Direct","1000.0000","2026-03-19 00:00:00","0"',
      '"8088","Candidate","Beau Bayh for Indiana","Beau Bayh","","","","","","Unitemized","300.0000","2026-03-19 00:00:00","0"',
      '"8088","Candidate","Beau Bayh for Indiana","Beau Bayh","Individual","Ann Lee","Carmel","IN","","Direct","50.0000","2026-03-19 00:00:00","1"',
    ].join("\n");
    const got = rows(csv).map(inReceipt).filter(Boolean) as Receipt[];
    expect(got.map((r) => r.amount)).toEqual([1000]);
    expect(got[0].donor.type).toBe("ENTITY");
  });
  it("Oklahoma: Monetary only; transfers, non-itemized and amended rows dropped", () => {
    const csv = [
      '"Receipt ID","Org ID","Receipt Type","Receipt Date","Receipt Amount","Receipt Source Type","Last Name","First Name","City","State","Committee Type","Committee Name","Candidate Name","Amended","Employer","Occupation"',
      '"1","11794","Monetary","03/01/2026","3300","Individual","SMITH","AMY","TULSA","OK","Candidate Committee","","MIKE MAZZEI","N","","CPA"',
      '"2","11794","Transfer-In of Funds from Prior Candidate Committee Registered","03/01/2026","50000","Candidate Committee (Registered)","MAZZEI FOR SENATE","","TULSA","OK","Candidate Committee","","MIKE MAZZEI","N","",""',
      '"3","11794","Monetary","03/01/2026","25","","NON-ITEMIZED CONTRIBUTOR","","","","Candidate Committee","","MIKE MAZZEI","N","",""',
      '"4","11794","Monetary","03/01/2026","100","Individual","DOE","JO","OKC","OK","Candidate Committee","","MIKE MAZZEI","Y","",""',
    ].join("\n");
    const got = rows(csv).map(okReceipt).filter(Boolean) as Receipt[];
    expect(got.map((r) => r.id)).toEqual(["1"]);
    expect(got[0].donor.name).toBe("Amy Smith");
  });
  it("Nebraska: drops small-contribution lump sums", () => {
    const head = '"Receipt ID","Org ID","Filer Type","Filer Name","Candidate Name","Receipt Transaction/Contribution Type","Receipt Date","Receipt Amount","Contributor or Transaction Source Type","Contributor or Source Name (Individual Last Name)","First Name","City","State","Amended","Employer","Occupation"';
    const csv = [head,
      '"9","7688","Candidate Committee","JIM PILLEN FOR GOVERNOR","JIM PILLEN","Monetary","04/26/2026","10000","Business (For-Profit and Non-Profit entities)","ACME AG LLC","","OMAHA","NE","N","",""',
      '"10","7688","Candidate Committee","JIM PILLEN FOR GOVERNOR","JIM PILLEN","Monetary","04/26/2026","900","Individual","FOR THE CALENDAR YEAR < 250.01","INDIVIDUALS WHO HAVE CONTRIBUTED","","NE","N","",""',
    ].join("\n");
    const got = rows(csv).map(neReceipt).filter(Boolean) as Receipt[];
    expect(got.map((r) => r.amount)).toEqual([10000]);
  });
});

describe("aggregation", () => {
  const base = { committeeName: "X FOR GOVERNOR", candidateName: "PAT X", date: "2025-05-01", fromCandidateCommittee: false };
  const d = (name: string, type: "ENTITY" | "INDIVIDUAL" = "INDIVIDUAL") => ({ name, type, employer: "", occupation: "", city: "DENVER", state: "CO" });
  it("merges a candidate's committees, de-duplicates IDs, excludes own-committee transfers and pre-2025 money", () => {
    const receipts: Receipt[] = [
      { ...base, id: "1", committeeId: "A", amount: 1000, donor: d("Ann Lee") },
      { ...base, id: "1", committeeId: "A", amount: 1000, donor: d("Ann Lee") }, // duplicate across yearly files
      { ...base, id: "2", committeeId: "B", committeeName: "PAT X FOR COLORADO", amount: 600, donor: d("Ann Lee") },
      { ...base, id: "3", committeeId: "A", amount: 5000, donor: d("Pat X For Colorado", "ENTITY") }, // own committee
      { ...base, id: "4", committeeId: "A", amount: 700, date: "2024-12-31", donor: d("Old Donor") },
      { ...base, id: "5", committeeId: "C", committeeName: "Q FOR HOUSE", candidateName: "Q R", amount: 300, donor: d("Bo Bee") },
    ];
    const agg = aggregate(receipts, (cn) => (/GOVERNOR|COLORADO/.test(cn) ? { office: "Governor", via: "committee" } : null));
    expect(agg.selfTransfers).toBe(1);
    expect(agg.candidates).toHaveLength(1);
    const c = agg.candidates[0];
    expect(c).toMatchObject({ name: "Pat X", total: 1600, count: 2, filerId: "A", committees: ["A", "B"] });
    expect([...c.donors.values()][0]).toMatchObject({ name: "Ann Lee", amount: 1600, count: 2 });
    expect([...agg.allDonors.values()].reduce((n, x) => n + x.amount, 0)).toBe(1900); // includes the legislative candidate
  });
});

describe("committee combining", () => {
  it("uses only the largest committee when the office came from the candidate table", () => {
    const d = { name: "Ann Lee", type: "INDIVIDUAL" as const, employer: "", occupation: "", city: "TULSA", state: "OK" };
    const r = (id: string, committeeId: string, amount: number): Receipt => ({ id, committeeId, committeeName: "", candidateName: "CYNDI MUNSON", date: "2026-02-01", amount, donor: d, fromCandidateCommittee: false });
    const agg = aggregate([r("1", "NEW", 5000), r("2", "OLD-HOUSE", 300)], () => ({ office: "Governor", via: "candidate" }));
    expect(agg.candidates).toHaveLength(1);
    expect(agg.candidates[0]).toMatchObject({ filerId: "NEW", committees: ["NEW"], total: 5000 });
    expect([...agg.allDonors.values()][0].amount).toBe(5300);
  });
  it("keeps the main name-matched committee alongside an office-named one", () => {
    const d = { name: "Ann Lee", type: "INDIVIDUAL" as const, employer: "", occupation: "", city: "DENVER", state: "CO" };
    const r = (id: string, committeeId: string, committeeName: string, amount: number): Receipt => ({ id, committeeId, committeeName, candidateName: "GREG LOPEZ", date: "2026-02-01", amount, donor: d, fromCandidateCommittee: false });
    const resolve = (cn: string) => ({ office: "Governor" as const, via: /GOVERNOR/.test(cn) ? "committee" as const : "candidate" as const });
    const agg = aggregate([r("1", "NEW", "GREG LOPEZ FOR COLORADO", 5000), r("2", "OLD", "LOPEZ FOR GOVERNOR", 200)], resolve);
    expect(agg.candidates[0]).toMatchObject({ filerId: "NEW", committees: ["NEW", "OLD"], total: 5200 });
  });
});

describe("Colorado lobbying", () => {
  it("combines income, registrations and bills; flags data-center bills", () => {
    const { clients, registrations } = aggregateCoLobby(
      [{ clientname: "Acme Power", lobbyistfirmname: "Capitol Group", lobbyistname: "Doe, Jane (Capitol Group)", amt: "12000.50", n: "6" }],
      [
        { clientname: "Acme Power", lobbyistfirmname: "Capitol Group", lobbyistname: "Doe, Jane (Capitol Group)", annuallobbyistregistrationid: "1" },
        { clientname: "ACME POWER", lobbyistfirmname: "Capitol Group", lobbyistname: "Roe, Rob (Capitol Group)", annuallobbyistregistrationid: "2" },
        { clientname: "Small Co", lobbyistfirmname: "", lobbyistname: "Solo Lobbyist", annuallobbyistregistrationid: "3" },
      ],
      [{ clientname: "Acme Power", billnumber: "SB26-001", billinformation: "Large-Load Customers and Data Centers" },
        { clientname: "Capitol Group", billnumber: "SB26-001", billinformation: "Large-Load Customers and Data Centers" }],
    );
    expect(registrations).toBe(3);
    expect(clients.find((c) => c.name === "Capitol Group")).toBeUndefined(); // firm reported as a subcontractor's client
    const acme = clients.find((c) => c.name === "Acme Power")!;
    expect(acme).toMatchObject({ amount: 12000.5, filings: 6, firms: ["Capitol Group"], dataCenter: true });
    expect(acme.lobbyists).toHaveLength(2);
    expect(acme.issues[0]).toContain("SB26-001");
    expect(clients.find((c) => c.name === "Small Co")).toMatchObject({ amount: null, dataCenter: false });
  });
});
