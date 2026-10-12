import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { aggregateIn, findInLinks, looksLikePerson, parseInCompensated, parseInEmployer, readXlsx } from "../lib/adapters/state/in-lobby";
import { aggregateKy, orgKey, parseKyBillsRtf, parseKyComp, parseKyExp } from "../lib/adapters/state/ky";
import { aggregateOh, parseOhEmployerDetails, parseOhIndustryHtml } from "../lib/adapters/state/oh";
import { aggregateOk, parseOkExpenditures } from "../lib/adapters/state/ok-lobby";
import { aggregateWy, parsePipe } from "../lib/adapters/state/wy";

describe("Kentucky KLEC", () => {
  const comp = [
    "Legislative Agent Compensation",
    "October 6, 2026",
    "Legislative Agent;Report Period;Employer;Compensation",
    "Abell Kelley ;01/01/2026 01/31/2026;WellCare Health Insurance Company of Ky., ;$4,000.00",
    "Legislative Agent;Report Period;Employer;Compensation",
    "Inc.",
    "Doe Jane ;01/01/2026 01/31/2026;Acme Data Centers LLC;$1,500.00",
    "Abell Kelley ;02/01/2026 02/28/2026;WellCare Health Insurance Company of Ky., Inc.;$500.00",
  ].join("\r\n");
  const exp = [
    "WellCare Health Insurance Company of Ky., Inc.;01/01/2026  -  01/31/2026;0.00;10.00;0.00;4,000.00;4,010.00",
    "WellCare Health Insurance Company of Ky., Inc.;02/01/2026  -  02/28/2026;0.00;0.00;0.00;500.00;500.00",
    "Acme Data Centers LLC;01/01/2026  -  01/31/2026;100.00;0.00;0.00;1,500.00;1,600.00",
  ].join("\r\n");
  const nob = "Health Care;WellCare Health Insurance Company of Ky., Inc.;01/01/2026  -  01/31/2026;0.00;10.00;0.00;4,000.00;4,010.00";
  const rtf = [
    "\\par\\pard\\ql\\pvpg\\posy2030\\phpg\\posx720\\wraparound\\dxfrtext0\\tx0",
    "{\\f2\\fs24\\b\\cf1",
    "Employer Name}",
    "\\par\\pard\\ql\\pvpg\\posy2548\\phpg\\posx720\\wraparound\\dxfrtext0\\tx0",
    "{\\f1\\fs20\\b\\cf1",
    "WellCare Health Insurance Company of Ky., Inc.}",
    "\\par\\pard\\ql\\pvpg\\posy2780\\phpg\\posx5459\\wraparound\\dxfrtext0\\tx0",
    "{\\f0\\fs20\\cf1",
    "Medicaid; HB 593, data}",
    "\\par\\pard\\ql\\pvpg\\posy2900\\phpg\\posx5459\\wraparound\\dxfrtext0\\tx0",
    "{\\f0\\fs20\\cf1",
    "center legislation}",
    "\\par\\pard\\ql\\pvpg\\posy2780\\phpg\\posx734\\wraparound\\dxfrtext0\\tx0",
    "{\\f0\\fs20\\cf1",
    "01/01/2026  to  01/31/2026}",
    "\\par\\pard\\ql\\pvpg\\posy3250\\phpg\\posx5459\\wraparound\\dxfrtext0\\tx0",
    "{\\f0\\fs20\\cf1",
    "Medicaid; HB 593, data center legislation}",
    "\\par\\pard\\ql\\pvpg\\posy3250\\phpg\\posx734\\wraparound\\dxfrtext0\\tx0",
    "{\\f0\\fs20\\cf1",
    "02/01/2026  to  02/28/2026}",
  ].join("\r\n");

  it("joins wrapped employer names and parses compensation", () => {
    const rows = parseKyComp(comp);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ agent: "Abell Kelley", employer: "WellCare Health Insurance Company of Ky., Inc.", compensation: 4000 });
    expect(orgKey(rows[0].employer)).toBe(orgKey(rows[2].employer));
  });

  it("parses employer statement categories A–D and TOTAL", () => {
    const rows = parseKyExp(exp);
    expect(rows[0]).toMatchObject({ advertising: 0, receptions: 10, otherExpenses: 0, agentCompensation: 4000, total: 4010 });
    expect(parseKyExp(nob)[0].industry).toBe("Health Care");
  });

  it("reads bills lobbied from the RTF, de-duplicating repeated periods", () => {
    const bills = parseKyBillsRtf(rtf);
    expect(bills.get("WellCare Health Insurance Company of Ky., Inc.")).toEqual(["Medicaid; HB 593, data center legislation"]);
  });

  it("aggregates clients and flags data-center mentions", () => {
    const { clients, registrations } = aggregateKy(parseKyComp(comp), parseKyExp(exp), parseKyExp(nob), parseKyBillsRtf(rtf));
    expect(registrations).toBe(2);
    const wc = clients.find((c) => c.name.startsWith("WellCare"))!;
    expect(wc.amount).toBe(4510);
    expect(wc.filings).toBe(2);
    expect(wc.issues[0]).toBe("Health Care");
    expect(wc.dataCenter).toBe(true);
    expect(clients.find((c) => c.name.startsWith("Acme"))!.dataCenter).toBe(true);
  });
});

describe("Ohio OLAC", () => {
  const csv = [
    '"Employer ID","Employer Name 1","Employer Name 2","Contact","Address 1","Address 2","City","State","Zipcode","Phone","Agent L Name","Agent F Name","Engagement Type"',
    '"1","CyrusOne","","X","1 St","","Dallas","TX","75201","1","Colvin","Brittney","Legislative"',
    '"1","CyrusOne","","X","1 St","","Dallas","TX","75201","1","Colvin","Brittney","Executive"',
    '"2","Ohio Hospital Association","","Y","2 St","","Columbus","OH","43215","2","Abrams","Mike","Legislative"',
  ].join("\r\n");
  const html = `<table><thead><tr><th>Agent Last Name</th></tr></thead><tbody>
    <tr><td>Colvin</td><td>Brittney</td><td>CyrusOne</td><td>2/10/2025</td><td>data centers</td></tr>
    <tr><td>Abrams</td><td>Mike</td><td>Ohio Hospital Association</td><td>1/1/2025</td><td>Healthcare &amp; hospitals</td></tr>
  </tbody></table>`;

  it("parses engagements and industries and aggregates", () => {
    const eng = parseOhEmployerDetails(csv);
    expect(eng[0]).toEqual({ employerId: "1", employer: "CyrusOne", agent: "Brittney Colvin", type: "Legislative" });
    const ind = parseOhIndustryHtml(html);
    expect(ind[1].industry).toBe("Healthcare & hospitals");
    const { clients, registrations } = aggregateOh([...eng, ...eng], ind);
    expect(registrations).toBe(3);
    const c1 = clients.find((c) => c.name === "CyrusOne")!;
    expect(c1).toMatchObject({ amount: null, filings: 2, lobbyists: ["Brittney Colvin"], issues: ["data centers"], dataCenter: true });
    expect(clients.find((c) => c.name === "Ohio Hospital Association")!.dataCenter).toBe(false);
  });
});

describe("Wyoming SOS export", () => {
  const lob = "LOBBYIST_ID|LOBBYIST_NUM|STATUS_ID|REGISTRATION_DATE|EXPIRATION_DATE|NAME_ON_BADGE|FIRST_NAME|MIDDLE_NAME|LAST_NAME|TERMINATED_DATE\r\n1|1|Active|01/07/2013|04/30/2027|Mary Throne|Mary||Throne|\r\n2|2|Terminated|01/07/2020|04/30/2024|Old Timer|Old||Timer|05/01/2024\r\n";
  const org = "LOBBYIST_ORGANIZATION_ID|LOBBYIST_ORGANIZATION_NUM|NAME|\r\n10|1|Prometheus Hyperscale|\r\n11|2|Prometheus Hyperscale|\r\n12|3|Wyoming Farm Bureau|\r\n";
  const xref = "LOBBYIST_ORGANIZATION_XREF_ID|LOBBYIST_ID|LOBBYIST_ORGANIZATION_ID|\r\n1|1|10|\r\n2|1|11|\r\n3|2|12|\r\n";

  it("dedupes repeated principal records and drops pre-2025 registrations", () => {
    const { clients, registrations } = aggregateWy(parsePipe(lob), parsePipe(org), parsePipe(xref));
    expect(registrations).toBe(1);
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ name: "Prometheus Hyperscale", filings: 1, lobbyists: ["Mary Throne"], dataCenter: true });
  });
});

describe("Indiana ILRC", () => {
  const sheet = (rows: string[][]) => {
    const strings: string[] = [];
    const cols = "ABCDEFGHIJ";
    const xmlRows = rows
      .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
        if (v === "") return "";
        const ref = `${cols[ci]}${ri + 1}`;
        if (/^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
        strings.push(v.replace(/&/g, "&amp;"));
        return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
      }).join("")}</row>`)
      .join("");
    return zipSync({
      "xl/sharedStrings.xml": strToU8(`<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xmlRows}</sheetData></worksheet>`),
    });
  };
  const emp = sheet([
    ["Year", "Lobbyist", "Terminated", "First Period Compensation", "First Period Net Expenditures", "Second Period Net Exps", "Grand Totals"],
    ["2025", "Vantage Data Center Management Company", "", "100", "100.5", "50", "150.5"],
    ["", "REPORTING TOTALS", "", "100", "100.5", "50", "150.5"],
  ]);
  const comp = sheet([
    ["Year", "Lobbyist", "Client", "Terminated", "First Period Compensation"],
    ["2025", "McAuley, Phillip", "McAuley, Phillip", "", "0"],
    ["", "", "Vantage Data Center Management Company", "", "900"],
    ["2025", "Smith Strategies LLC", "Hoosier Widgets & Co", "", "1200"],
  ]);

  it("reads xlsx and aggregates employers and compensated lobbyists", () => {
    const e = parseInEmployer(readXlsx(emp), "2025");
    expect(e).toEqual([{ year: "2025", employer: "Vantage Data Center Management Company", net: 150.5 }]);
    const c = parseInCompensated(readXlsx(comp), "2025");
    expect(c.map((r) => r.lobbyist)).toEqual(["McAuley, Phillip", "McAuley, Phillip", "Smith Strategies LLC"]);
    const { clients, registrations } = aggregateIn(e, c);
    expect(registrations).toBe(3);
    const v = clients.find((x) => x.name.startsWith("Vantage"))!;
    expect(v).toMatchObject({ amount: 150.5, lobbyists: ["McAuley, Phillip"], dataCenter: true });
    expect(clients.find((x) => x.name.startsWith("Hoosier"))).toMatchObject({ amount: null, firms: ["Smith Strategies LLC"] });
    expect(looksLikePerson("Zito, Catherine ")).toBe(true);
    expect(looksLikePerson("Barnes & Thornburg LLP")).toBe(false);
  });

  it("finds the year's total spreadsheets on the page", () => {
    const html = '<a href="/ilrc/files/2026-Employer-Lobbyist-Total.xlsx">x</a><a href="/ilrc/files/2024-Compensated-Lobbyist-Totals.xlsx">y</a><a href="/ilrc/files/2026-Compensated-Lobbyist-Total.xlsx">z</a>';
    expect(findInLinks(html, "2026")).toEqual({
      employer: "https://www.in.gov/ilrc/files/2026-Employer-Lobbyist-Total.xlsx",
      compensated: "https://www.in.gov/ilrc/files/2026-Compensated-Lobbyist-Total.xlsx",
    });
  });
});

describe("Oklahoma Guardian", () => {
  const csv = [
    '"Expenditure ID","LobbyistID","Lobbyist FirstName","Lobbyist MiddleName","Lobbyist LastName","Lobbyist Suffix","Expenditure Type","Expenditure Date","Expenditure Cost","Meal Type","Other Meal Description","Explanation","Principal Name","Principal\'s Percentage Cost","Event Location"',
    '"1","9","TANNER","","ROBERTS","","Meals and Other Food and Beverage","01/03/2026","21","Other","","","","",""',
    '"2","9","TANNER","","ROBERTS","","Events to which all Legislators are invited","02/03/2026","1000","","","Data center tour","OGE ENERGY CORP.","50","OKC"',
    '"3","8","ANN","","LEE","","Caucus Event","02/04/2026","300","","","","OGE ENERGY CORP.","",""',
  ].join("\r\n");

  it("counts principal shares and flags event text", () => {
    const rows = parseOkExpenditures(csv);
    expect(rows).toHaveLength(3);
    const { clients, registrations } = aggregateOk(rows);
    expect(registrations).toBe(2);
    expect(clients).toEqual([
      { name: "OGE ENERGY CORP.", amount: 800, filings: 2, lobbyists: ["TANNER ROBERTS", "ANN LEE"], firms: [], issues: [], dataCenter: true },
    ]);
  });
});
