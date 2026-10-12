import { describe, expect, it } from "vitest";
import {
  applyAmount, calDate, classifyCommittee, committeeElectionYear, donorFrom, extractBills, headerIndex,
  LatestAmendments, normOrg, personKey, splitTsv,
} from "../lib/adapters/state/ca";
import type { Donor } from "../lib/adapters/state/contract";

describe("CAL-ACCESS parsing helpers", () => {
  it("parses CAL-ACCESS dates", () => {
    expect(calDate("1/27/2000 12:00:00 AM")).toBe("2000-01-27");
    expect(calDate("01/01/2025")).toBe("2025-01-01");
    expect(calDate("")).toBeNull();
    expect(calDate(undefined)).toBeNull();
  });

  it("splits CRLF tab rows and indexes headers", () => {
    const header = "FILING_ID\tAMEND_ID\tLINE_ITEM\tREC_TYPE\tFORM_TYPE\r";
    const ix = headerIndex(header);
    expect(ix.FORM_TYPE).toBe(4);
    const f = splitTsv("578357\t0\t96\tRCPT\tA\r");
    expect(f[ix.FORM_TYPE]).toBe("A");
    expect(f).toHaveLength(5);
  });

  it("keeps only the highest amendment of each filing", () => {
    const la = new LatestAmendments<string>();
    la.offer("100", "0", "original");
    la.offer("100", "2", "second");
    la.offer("100", "1", "first");
    la.offer("200", "0", "only");
    expect(la.get("100")).toBe("second");
    expect(la.isLatest("100", "2")).toBe(true);
    expect(la.isLatest("100", "0")).toBe(false);
    expect(la.isLatest("200", 0)).toBe(true);
    expect(la.isLatest("300", 0)).toBe(false);
    expect(la.size).toBe(2);
  });

  it("derives committee election year from the name, else the cover election date", () => {
    expect(committeeElectionYear("Rick Chavez Zbur for Attorney General 2030", "2026-11-03")).toBe(2030);
    expect(committeeElectionYear("Herms for Governor 2026", null)).toBe(2026);
    expect(committeeElectionYear("Betty Yee for Governor", "2026-11-03")).toBe(2026);
    expect(committeeElectionYear("Friends of Jane", null)).toBeNull();
  });

  it("classifies candidate committees", () => {
    const base = { entity: "CTL", candLast: "Porter", candFirst: "Katie", office: "GOV", electDate: null };
    expect(classifyCommittee({ ...base, filerName: "Katie Porter for Governor 2026" })).toEqual({ kind: "statewide", office: "Governor" });
    // future-cycle committee for the same office: a state candidate committee, but not a 2026 statewide campaign
    expect(classifyCommittee({ ...base, office: "CON", candLast: "Low", candFirst: "Evan", filerName: "Low for State Controller 2030" })).toEqual({ kind: "state" });
    // office code that contradicts the committee name is not treated as statewide
    expect(classifyCommittee({ ...base, entity: "RCP", candLast: "Dy", candFirst: "Eliza", filerName: "DY FOR ASSEMBLY DISTRICT 13 2026; ELIZA" })).toEqual({ kind: "state" });
    expect(classifyCommittee({ ...base, filerName: "Newsom Ballot Measure Committee" })).toBeNull();
    expect(classifyCommittee({ ...base, filerName: "Newsom for California Governor 2022 Officeholder Account" })).toBeNull();
    expect(classifyCommittee({ ...base, office: "CCM", filerName: "Porter for City Council 2026" })).toBeNull();
    expect(classifyCommittee({ ...base, candLast: "", filerName: "Katie Porter for Governor 2026" })).toBeNull();
    // recipient committees count only when they carry the candidate's name
    expect(classifyCommittee({ ...base, entity: "RCP", filerName: "Californians for Better Schools" })).toBeNull();
    expect(classifyCommittee({ ...base, entity: "RCP", candLast: "Howell", candFirst: "Robert", office: "INS", filerName: "HOWELL FOR INSURANCE COMMISSIONER 2026; ROBERT" })).toEqual({ kind: "statewide", office: "Insurance Commissioner" });
  });

  it("builds donors and person keys", () => {
    expect(donorFrom("IND", "Knox", "John H.", "San Francisco", "CA", "Orrick", "Attorney")).toEqual({
      name: "John H. Knox", type: "INDIVIDUAL", employer: "Orrick", occupation: "Attorney", city: "San Francisco", state: "CA",
    });
    expect(donorFrom("COM", "California Democratic Party", "", "Sacramento", "CA", "", "").type).toBe("ENTITY");
    expect(personKey("Chavez Zbur", "Rick")).toBe(personKey("Zbur", "Rick Chavez"));
    expect(personKey("Bonta", "Rob")).toBe("ROB|BONTA");
    expect(normOrg("Google LLC & Affiliates, Inc.")).toBe("GOOGLE AND AFFILIATES");
  });

  it("lets refunds reduce a donor total without counting as a gift", () => {
    const m = new Map<string, Donor>();
    const d = donorFrom("IND", "Doe", "Jane", "Fresno", "CA", "", "");
    applyAmount(m, d, 500);
    applyAmount(m, d, -200);
    applyAmount(m, donorFrom("IND", "Roe", "Sam", "Fresno", "CA", "", ""), -50); // refund with no prior gift is ignored
    expect([...m.values()]).toEqual([expect.objectContaining({ name: "Jane Doe", amount: 300, count: 1 })]);
  });

  it("extracts bill numbers from lobbying activity text", () => {
    expect(extractBills("AB 1751; SB2007, SBX1 2 and SCA 1. Gov office re pending legislation")).toEqual(["AB 1751", "SB 2007", "SBX1 2", "SCA 1"]);
    expect(extractBills("General energy issues")).toEqual([]);
  });
});
