import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  alDonor, alRows, credit, CrossFilingDedupe, csvRecords, isSelf, mdy, newCandidate, pdfTextRuns, splitCsv, zipLines,
} from "../lib/adapters/state/al";
import { laRow } from "../lib/adapters/state/la";
import { MA_CONTRIB_TYPES, splitOcpf } from "../lib/adapters/state/ma";
import { miRow } from "../lib/adapters/state/mi";
import { nmRow, sameFirst } from "../lib/adapters/state/nm";
import { paCandidates, paDonorType, supersededReports } from "../lib/adapters/state/pa";

async function* from(lines: string[]) {
  yield* lines;
}
async function collect<T>(g: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of g) out.push(x);
  return out;
}
const ix = (h: string) => Object.fromEntries(h.split(/\t|,/).map((x, i) => [x, i]));

describe("shared helpers", () => {
  it("splits quoted CSV and rejoins records broken across lines", async () => {
    expect(splitCsv('1,"Smith, Jo","say ""hi"""')).toEqual(["1", "Smith, Jo", 'say "hi"']);
    expect(splitCsv('1,"open')).toBeNull();
    const recs = await collect(csvRecords(from(['a,b', '1,"line one', 'line two"', "2,x"])));
    expect(recs).toEqual([["a", "b"], ["1", "line one\nline two"], ["2", "x"]]);
  });

  it("streams lines out of zip members", async () => {
    const dir = mkdtempSync(join(tmpdir(), "st-zip-"));
    const p = join(dir, "t.zip");
    writeFileSync(p, zipSync({ "a.txt": strToU8("h1\r\nx\r\ny"), "b.csv": strToU8("skip\n") }));
    const lines = await collect(zipLines(p, (n) => n.endsWith(".txt")));
    expect(lines.map((l) => l.line)).toEqual(["h1", "x", "y"]);
  });

  it("counts a contribution repeated on another filing once, but keeps repeats within one filing", () => {
    const d = new CrossFilingDedupe();
    expect(d.accept("C1", "Jane Doe", "2025-03-01", 100, "R1")).toBe(true);
    expect(d.accept("C1", "Jane Doe", "2025-03-01", 100, "R1")).toBe(true);
    expect(d.accept("C1", "JANE  DOE", "2025-03-01", 100, "R2")).toBe(false);
    expect(d.accept("C2", "Jane Doe", "2025-03-01", 100, "R2")).toBe(true);
    expect(d.dropped).toBe(1);
  });

  it("recognizes the candidate's own money and own committees", () => {
    expect(isSelf("Minogue, Michael", "Michael Minogue")).toBe(true);
    expect(isSelf("ARIC NESBITT FOR STATE SENATE", "Aric Nesbitt")).toBe(true);
    expect(isSelf("Shapiro for Pennsylvania", "Joshua D Shapiro", ["Shapiro for Pennsylvania"])).toBe(true);
    expect(isSelf("CHARLES G MARTIN", "Chad Chig Martin")).toBe(false);
    expect(isSelf("Catherine Shortsleeve", "Brian Shortsleeve")).toBe(false);
  });

  it("parses dates and aggregates candidate totals", () => {
    expect(mdy("9/26/2026 12:00:00 AM")).toBe("2026-09-26");
    expect(mdy("")).toBeNull();
    const c = newCandidate("1", "A B", "Governor");
    credit(c, { name: "X PAC", type: "ENTITY", employer: "", occupation: "", city: "", state: "" }, 500, "2025-02-01");
    credit(c, { name: "Y", type: "INDIVIDUAL", employer: "", occupation: "", city: "Z", state: "" }, 250, "2026-01-01");
    expect([c.total, c.count, c.fromEntities, c.latest, c.donors.size]).toEqual([750, 2, 500, "2026-01-01", 2]);
  });
});

describe("Alabama", () => {
  const H = "CommitteeId,ContributionAmount,ContributionDate,LastName,FirstName,MI,Suffix,Address1,City,State,Zip,ContributionID,FiledDate,ContributionType,ContributorType,CommitteeType,CommitteeName,CandidateName,Amended";
  it("rejoins rows split by a line break in the address and skips rows with stray commas", async () => {
    const rows = await collect(alRows(from([
      H,
      "33623,250.00,02/10/2026,Smith,Patrick,, ,402 N. Commons St. E.",
      "#4,Tuscumbia,AL,35674,1584609,03/09/2026,Cash (Itemized),Individual,Principal Campaign Committee,,Michelle French,N",
      "1,5,01/01/2026,A,B,,,1 Main, Apt 2,City,AL,1,2,01/02/2026,Cash (Itemized),Individual,Principal Campaign Committee,,X Y,N",
      "26405,15000.00,07/06/2026,ALABAMA REALTORS PAC,,, ,PO Box 1,Montgomery,AL,36101,1401186,08/03/2026,Cash (Itemized),PAC,Principal Campaign Committee,,TOMMY T,N",
    ])));
    expect(rows).toHaveLength(3);
    const [a, bad, c] = rows as [string[], string, string[]];
    expect(a[7]).toBe("402 N. Commons St. E. #4");
    expect(a[8]).toBe("Tuscumbia");
    expect(bad).toBe("bad");
    expect(alDonor(a)).toMatchObject({ name: "Patrick Smith", type: "INDIVIDUAL", city: "Tuscumbia" });
    expect(alDonor(c)).toMatchObject({ name: "ALABAMA REALTORS PAC", type: "ENTITY" });
  });

  it("reads lobbyist and principal runs from the Ethics PDF content stream", () => {
    const content = "BT /F4 9.999 Tf 0 0 0 rg 633.805 TL 74.016 459.792 Td (James  Able) Tj T* ET\nBT /F5 7.999 Tf 0 0 0 rg 362.174 TL 229.968 398.592 Td (Alabama Association for Justice \\(AAJ\\)) Tj T* ET";
    expect(pdfTextRuns(content)).toEqual([
      { font: "F4", size: 9.999, x: 74.016, text: "James Able" },
      { font: "F5", size: 7.999, x: 229.968, text: "Alabama Association for Justice (AAJ)" },
    ]);
  });
});

describe("Louisiana", () => {
  const h = ix("FilerNumber,FilerLastName,FilerFirstName,ReportCode,ReportType,ReportNumber,ContributorTypeCode,ContributorName,ContributorAddr1,ContributorAddr2,ContributorCity,ContributorrState,ContributorZip,ContributionType,ContributionDescription,ContributionDate,ContributionAmt,ContributionDesignatedElectionAdditionInfo");
  const row = (o: Partial<Record<string, string>>) => {
    const base: Record<string, string> = { FilerNumber: "6360", FilerLastName: "Smith", FilerFirstName: "Jerry", ReportCode: "F102", ReportType: "10G", ReportNumber: "LA-1", ContributorTypeCode: "BUS", ContributorName: "ACME LLC", ContributorCity: "Monroe", ContributorrState: "LA", ContributionType: "CONTRIB", ContributionDate: "3/5/2025 12:00:00 AM", ContributionAmt: "2500.00" };
    const m = { ...base, ...o };
    return Object.keys(h).map((k) => m[k] ?? "");
  };
  it("keeps candidate-report contributions and skips special reports, PAC reports, interest and pre-2025 items", () => {
    expect(laRow(row({}), h)).toMatchObject({ recipient: "6360", candidate: "Jerry Smith", date: "2025-03-05", amount: 2500, donor: { type: "ENTITY", name: "ACME LLC" } });
    expect(laRow(row({ ReportCode: "F103", ReportType: "SPCL" }), h)).toBeNull();
    expect(laRow(row({ ReportCode: "F202" }), h)).toBeNull();
    expect(laRow(row({ ContributionType: "OTHER" }), h)).toBeNull();
    expect(laRow(row({ ContributionDate: "12/31/2024 12:00:00 AM" }), h)).toBeNull();
    expect(laRow(row({ ContributorTypeCode: "IND", ContributorName: "LONNIE WILLIAMSON" }), h)?.donor.type).toBe("INDIVIDUAL");
  });
});

describe("Massachusetts", () => {
  it("splits OCPF quoted tab rows and maps record types", () => {
    const f = splitOcpf('17891299\t1004671\t201\t1/1/2026\t200.0000\t"Philbin"\t"Christopher"\t""\t\t"Vice President"');
    expect(f.slice(0, 7)).toEqual(["17891299", "1004671", "201", "1/1/2026", "200.0000", "Philbin", "Christopher"]);
    expect(f[7]).toBe("");
    expect(MA_CONTRIB_TYPES["201"]).toBe("INDIVIDUAL");
    expect(MA_CONTRIB_TYPES["211"]).toBe("ENTITY");
    expect(MA_CONTRIB_TYPES["207"]).toBeUndefined(); // transfer from savings
    expect(MA_CONTRIB_TYPES["220"]).toBeUndefined(); // un-itemized aggregate
  });
});

describe("Michigan", () => {
  const H = "doc_seq_no\tcontribution_id\tcont_detail_id\tdoc_stmnt_year\tdoc_type_desc\tcom_legal_name\tcommon_name_acronym\tcfr_com_id\tcom_type\tcan_first_name\tcan_last_name\tcontribtype\tcontributor_f_name\tcontributor_l_name_or_org\tcontributor_address\tcontributor_city\tcontributor_state\tcontributor_zip\tcontributor_occupation\tcontributor_employer\treceived_date\tamount\taggregate\textra_desc\tfundraiser\tcan_political_party\tcan_office_sought\tcan_district_sought";
  const h = ix(H);
  const line = (o: Record<string, string>) => {
    const base: Record<string, string> = { doc_seq_no: "26-1", cont_detail_id: "0", cfr_com_id: "0521875", com_type: "Candidate", can_first_name: "JOCELYN", can_last_name: "BENSON", contribtype: "Direct Contributions", contributor_f_name: " RONALD  E", contributor_l_name_or_org: "CHILNER", contributor_city: "LINDEN", contributor_state: "MI", received_date: "05/19/2026", amount: "5.00", can_office_sought: "Governor" };
    const m = { ...base, ...o };
    return Object.keys(h).map((k) => m[k] ?? "");
  };
  it("reads candidate contributions and skips loans, detail lines and non-candidate committees", () => {
    expect(miRow(line({}), h)).toMatchObject({ committee: "0521875", office: "Governor", candidate: "JOCELYN BENSON", donor: { name: "RONALD E CHILNER", type: "INDIVIDUAL" }, amount: 5, date: "2026-05-19" });
    expect(miRow(line({ contributor_f_name: "", contributor_l_name_or_org: "UAW V-PAC" }), h)?.donor.type).toBe("ENTITY");
    expect(miRow(line({ contribtype: "Direct Contributions - Loan" }), h)).toBeNull();
    expect(miRow(line({ cont_detail_id: "26-842814" }), h)).toBeNull();
    expect(miRow(line({ com_type: "Independent" }), h)).toBeNull();
  });
});

describe("New Mexico", () => {
  const H = "OrgID,Transaction Amount,Transaction Date,Last Name,First Name,Middle Name,Prefix,Suffix,Contributor Address Line 1,Contributor Address Line 2,Contributor City,Contributor State,Contributor Zip Code,Description,Check Number,Transaction ID,Filed Date,Election,Report Name,Start of Period,End of Period,Contributor Code,Contribution Type,Report Entity Type,Committee Name,Candidate Last Name,Candidate First Name,Candidate Middle Name,Candidate Prefix,Candidate Suffix,Amended,Contributor Employer,Contributor Occupation,Occupation Comment,Employment Information Requested";
  const h = ix(H);
  const line = (o: Record<string, string>) => {
    const base: Record<string, string> = { OrgID: "562817", "Transaction Amount": "20.0000", "Transaction Date": "2/1/2026 12:00:00 AM", "Last Name": "Doty", "First Name": "Terrie", "Contributor City": "Tome", "Filed Date": "4/13/2026 10:23:11 PM", "Report Name": "First Primary Report", "Start of Period": "Oct  7 2025 12:00AM", "Contributor Code": "Individual", "Contribution Type": "Contributions - Monetary", "Report Entity Type": "Candidate", "Candidate Last Name": "Haaland", "Candidate First Name": "Deb" };
    const m = { ...base, ...o };
    return Object.keys(h).map((k) => m[k] ?? "");
  };
  it("keeps gifts to candidates and drops loans, transfers, PAC rows and test accounts", () => {
    expect(nmRow(line({}), h)).toMatchObject({ orgId: "562817", candidate: "Deb Haaland", donor: { name: "Terrie Doty", type: "INDIVIDUAL" }, amount: 20, date: "2026-02-01" });
    expect(nmRow(line({ "Contributor Code": "Other (e.g. business entity)", "First Name": "", "Last Name": "Chevron USA Inc" }), h)?.donor).toMatchObject({ name: "Chevron USA Inc", type: "ENTITY" });
    expect(nmRow(line({ "Contribution Type": "Loans Received" }), h)).toBeNull();
    expect(nmRow(line({ "Contribution Type": "Contributions - Intra-Candidate Transfer" }), h)).toBeNull();
    expect(nmRow(line({ "Report Entity Type": "PAC" }), h)).toBeNull();
    expect(nmRow(line({ "Candidate First Name": "TestUs", "Candidate Last Name": "Test" }), h)).toBeNull();
  });
  it("matches first names exactly or by short form only", () => {
    expect(sameFirst("Deb", "Debra")).toBe(true);
    expect(sameFirst("Juan", "Joseph")).toBe(false);
    expect(sameFirst("Jo", "Joseph")).toBe(false);
  });
});

describe("Pennsylvania", () => {
  const rep = (id: string, filer: string, o: Partial<{ eyear: string; cycle: string; submitted: string; amend: boolean; type: string; name: string; office: string }> = {}) => ({
    id, filer, eyear: "2026", cycle: "2", submitted: "2026-05-08", amend: false, type: "2", name: "", office: "", ...o,
  });
  it("supersedes earlier reports when a later amended report exists for the same cycle", () => {
    const s = supersededReports([
      rep("1", "A", { submitted: "2026-05-01" }),
      rep("2", "A", { submitted: "2026-06-01", amend: true }),
      rep("3", "B", { submitted: "2026-05-01" }),
      rep("4", "B", { submitted: "2026-06-01" }), // later original without amendment flag: both kept
      rep("5", "A", { cycle: "3" }),
    ]);
    expect([...s]).toEqual(["1"]);
  });
  it("links committees to the Governor candidate named in them", () => {
    const m = paCandidates([
      rep("10", "2026C0403", { type: "1", name: "SHAPIRO, JOSHUA D", office: "GOV" }),
      rep("11", "20160016", { name: "Shapiro for Pennsylvania", office: "GOV" }),
      rep("12", "2026C0735", { type: "1", name: "GARRITY,STACY LORRAINE", office: "GOV" }),
      rep("13", "20200025", { name: "Garrity for PA", office: "GOV" }),
      rep("14", "20180538", { name: "JNESO - DISTRICT COUNCIL 1 IUOE", office: "GOV" }),
    ]);
    expect(m.get("20160016")).toMatchObject({ candidate: "2026C0403", name: "Joshua D Shapiro", office: "Governor" });
    expect(m.get("20200025")).toMatchObject({ candidate: "2026C0735", name: "Stacy Lorraine Garrity" });
    expect(m.has("20180538")).toBe(false);
  });
  it("recognizes organizations by name", () => {
    expect(paDonorType("AFT COPE - Contributions from FEC report")).toBe("ENTITY");
    expect(paDonorType("Greater PA Carpenters PAC")).toBe("ENTITY");
    expect(paDonorType("Michael R. Bloomberg")).toBe("INDIVIDUAL");
  });
});
