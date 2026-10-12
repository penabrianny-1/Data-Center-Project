import { slug } from "./seed";
import type { Adapter, Entity, Relation } from "../ingest/types";

/**
 * Federal lobbying on data-center issues from the official Lobbying Disclosure
 * Act database (lda.gov: Senate Office of Public Records and House Clerk).
 *
 * Every 2025–2026 filing whose specific lobbying-issue text mentions data
 * centers, aggregated by client, lobbying firm, issue area, agency lobbied and
 * bill mentioned, in the spirit of OpenSecrets' "top bills". Spending is what
 * each quarterly report discloses for ALL issues on that filing, so it shows
 * lobbying intensity, not dollars spent on data centers alone. OpenSecrets'
 * bill counts have the same limitation.
 */

const API = "https://lda.gov/api/v1/filings/";
const YEARS = [2025, 2026];
const RELEVANT = /\bdata[- ]?cent(?:er|re)s?\b|\bhyperscal\w*|\blarge[- ]load\b/i;

/** Pull bill references like "H.R. 4776", "S.1234", "H.Res. 12" from free text → "HR4776". */
export function extractBills(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(H\.?\s?R\.?|S\.|S|H\.?\s?Res\.?|S\.?\s?Res\.?|H\.?\s?J\.?\s?Res\.?|S\.?\s?J\.?\s?Res\.?)\s?(\d{1,5})\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1].toUpperCase().replace(/[.\s]/g, "");
    // A bare "S" followed by a number is ambiguous ("Section 5"); require "S." or "S " directly before digits.
    if (raw === "S" && !/^S[.\s]\s?\d/i.test(m[0])) continue;
    const type = { HR: "HR", S: "S", HRES: "HRES", SRES: "SRES", HJRES: "HJRES", SJRES: "SJRES" }[raw];
    if (type) out.add(`${type}${Number(m[2])}`);
  }
  return [...out];
}

/**
 * Pair bill numbers with the act name written next to them, e.g.
 * "H.R. 3616, the Reliable Power Act" or "Reliable Power Act (H.R. 3616)".
 */
export function billLabels(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const num = String.raw`(H\.?\s?R\.?|S\.)\s?(\d{1,5})`;
  const act = String.raw`((?:[A-Z][A-Za-z0-9'&-]*\s){0,8}[A-Z][A-Za-z0-9'&-]*\s+Act(?:\s+of\s+\d{4})?)`;
  for (const m of text.matchAll(new RegExp(String.raw`${num}[,:;\s-]+(?:the\s+)?${act}`, "g"))) out.set(`${m[1].toUpperCase().replace(/[.\s]/g, "")}${Number(m[2])}`, m[3].trim());
  for (const m of text.matchAll(new RegExp(String.raw`${act}\s*\(${num}\)`, "g"))) out.set(`${m[2].toUpperCase().replace(/[.\s]/g, "")}${Number(m[3])}`, m[1].trim());
  return out;
}

/** Named acts ("SPEED Act", "GRID Power Act") mentioned in the text. */
export function extractActs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b((?:[A-Z][A-Za-z0-9'&-]*\s){0,6}[A-Z][A-Za-z0-9'&-]*)\s+Act\b/g)) {
    const name = `${m[1].trim()} Act`.replace(/^(the|The|and|of|to|for)\s+/, "");
    if (name.length > 5 && !/^(Federal Power|Clean Air|Clean Water|Inflation Reduction|National Environmental Policy) Act$/.test(name)) out.add(name);
  }
  return [...out];
}

interface LdaActivity {
  general_issue_code: string;
  general_issue_code_display: string;
  description: string | null;
  government_entities: { name: string }[];
}
interface LdaFiling {
  filing_uuid: string;
  filing_type: string;
  filing_type_display: string;
  filing_year: number;
  filing_period: string;
  filing_period_display: string;
  filing_document_url: string;
  income: string | null;
  expenses: string | null;
  dt_posted: string;
  registrant: { id: number; name: string };
  client: { id: number; name: string; general_description: string | null; state: string | null };
  lobbying_activities: LdaActivity[];
}

export const ldaAdapter: Adapter = {
  id: "lda",
  name: "Federal lobbying on data centers (LDA)",
  url: "https://lda.gov/",
  sourceKind: "official",
  method: "api",
  schedule: "Daily (quarterly reports due Jan 20, Apr 20, Jul 20, Oct 20)",
  refreshMinutes: 1440,
  coverage:
    "All 2025–2026 federal lobbying filings (registrations and quarterly reports) whose specific issue text mentions data centers, hyperscale facilities or large loads. Includes clients, lobbying firms, issue areas, agencies lobbied, and bills or acts named in the filings. Dollar figures are each report's total disclosed lobbying income or expenses across all its issues, so they aren't data-center-only spending. State-level lobbying isn't covered, because each state has its own disclosure system.",
  async run({ fetch, log }) {
    const filings: LdaFiling[] = [];
    for (const year of YEARS) {
      let url: string | null = `${API}?filing_year=${year}&filing_specific_lobbying_issues=${encodeURIComponent("data center")}&page_size=25`;
      while (url) {
        const j = (await (await fetch(url, { retries: 2 })).json()) as { next: string | null; results: LdaFiling[] };
        filings.push(...j.results);
        url = j.next;
      }
    }

    const relevant = filings.filter((f) => f.lobbying_activities.some((a) => RELEVANT.test(a.description ?? "")));
    log(`LDA: ${filings.length} search hits → ${relevant.length} filings that actually mention data centers`);

    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const clients = new Map<string, { name: string; description: string | null; state: string | null; amount: number; filings: number; registrants: Set<string>; issues: Set<string>; bills: Set<string>; latest: string }>();
    const bills = new Map<string, { filings: number; clients: Map<string, number>; amount: number; acts: boolean }>();
    const labels = new Map<string, Map<string, number>>(); // bill number → act name → co-mention count
    const issues = new Map<string, number>();
    const agencies = new Map<string, number>();
    let totalAmount = 0;

    for (const f of relevant) {
      const acts = f.lobbying_activities.filter((a) => RELEVANT.test(a.description ?? ""));
      const text = acts.map((a) => a.description ?? "").join(" ");
      const billRefs = extractBills(text);
      const paired = billLabels(text);
      for (const [b, name] of paired) {
        const m = labels.get(b) ?? new Map();
        m.set(name, (m.get(name) ?? 0) + 1);
        labels.set(b, m);
      }
      // Act names already attached to a bill number are counted under the number only.
      const pairedNames = new Set(paired.values());
      const actRefs = extractActs(text).filter((a) => !pairedNames.has(a));
      const amount = Number(f.income ?? f.expenses ?? 0) || 0;
      totalAmount += amount;
      const ck = String(f.client.id);
      const cl = clients.get(ck) ?? { name: f.client.name, description: f.client.general_description, state: f.client.state, amount: 0, filings: 0, registrants: new Set(), issues: new Set(), bills: new Set(), latest: "" };
      cl.amount += amount;
      cl.filings++;
      cl.registrants.add(f.registrant.name);
      for (const a of acts) {
        cl.issues.add(a.general_issue_code_display);
        issues.set(a.general_issue_code_display, (issues.get(a.general_issue_code_display) ?? 0) + 1);
        for (const g of a.government_entities) agencies.set(g.name, (agencies.get(g.name) ?? 0) + 1);
      }
      for (const b of [...billRefs, ...actRefs]) {
        cl.bills.add(b);
        const agg = bills.get(b) ?? { filings: 0, clients: new Map(), amount: 0, acts: actRefs.includes(b) };
        agg.filings++;
        agg.amount += amount;
        agg.clients.set(f.client.name, (agg.clients.get(f.client.name) ?? 0) + amount);
        bills.set(b, agg);
      }
      if (f.dt_posted > cl.latest) cl.latest = f.dt_posted;
      clients.set(ck, cl);

      entities.push({
        id: `lobbyfiling:${f.filing_uuid}`,
        kind: "lobbying",
        state: "US",
        title: `${f.client.name} (via ${f.registrant.name})`,
        date: f.dt_posted.slice(0, 10),
        status: f.filing_type,
        searchText: `${f.client.name} ${f.registrant.name} ${text}`,
        sources: [{ title: `LDA ${f.filing_type_display} ${f.filing_year} ${f.filing_period_display}`, url: f.filing_document_url, publisher: "Lobbying Disclosure (Senate & House)", kind: "official", docId: f.filing_uuid }],
        confidence: "high",
        data: {
          client: f.client.name, clientDescription: f.client.general_description, clientState: f.client.state, registrant: f.registrant.name,
          type: f.filing_type_display, year: f.filing_year, period: f.filing_period_display, amount: amount || null,
          issues: acts.map((a) => a.general_issue_code_display), descriptions: acts.map((a) => a.description), agencies: [...new Set(acts.flatMap((a) => a.government_entities.map((g) => g.name)))],
          bills: billRefs, acts: actRefs, url: f.filing_document_url,
        },
      });
    }

    // Drop act-name aggregates that are really a numbered bill's name.
    const labelOf = (key: string) => [...(labels.get(key) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const namedNumbers = new Set([...labels.keys()].map((k) => labelOf(k)));
    for (const [key, b] of bills) {
      if (b.acts && namedNumbers.has(key)) continue;
      const isNumber = /^(HR|S|HRES|SRES|HJRES|SJRES)\d+$/.test(key);
      const billId = isNumber ? `bill:US-119-${key}` : null;
      entities.push({
        id: `lobbybill:${slug(key)}`,
        kind: "lobbying",
        state: "US",
        title: isNumber ? key.replace(/^(HR|S|HRES|SRES|HJRES|SJRES)/, (t) => ({ HR: "H.R. ", S: "S. ", HRES: "H.Res. ", SRES: "S.Res. ", HJRES: "H.J.Res. ", SJRES: "S.J.Res. " })[t]!) : key,
        status: "bill_aggregate",
        sources: [{ title: "LDA filings mentioning this bill", url: `https://lda.gov/filings/public/filing/search/?filing_specific_lobbying_issues=${encodeURIComponent(key)}`, publisher: "Lobbying Disclosure (Senate & House)", kind: "official" }],
        confidence: "high",
        data: {
          key, billId, isNumber, name: isNumber ? labelOf(key) : key, filings: b.filings, clientCount: b.clients.size, amount: b.amount,
          topClients: [...b.clients].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([name, amount]) => ({ name, amount })),
        },
      });
      if (billId) relations.push({ src: `lobbybill:${slug(key)}`, dst: billId, type: "lobbying_on" });
    }

    for (const [id, cl] of clients) {
      entities.push({
        id: `lobbyclient:${id}`,
        kind: "lobbying",
        state: cl.state && /^[A-Z]{2}$/.test(cl.state) ? cl.state : "US",
        title: cl.name,
        date: cl.latest.slice(0, 10),
        status: "client_aggregate",
        searchText: `${cl.description ?? ""} ${[...cl.registrants].join(" ")}`,
        sources: [{ title: `LDA filings for ${cl.name}`, url: `https://lda.gov/filings/public/filing/search/?client_name=${encodeURIComponent(cl.name)}`, publisher: "Lobbying Disclosure (Senate & House)", kind: "official" }],
        confidence: "high",
        data: { name: cl.name, description: cl.description, state: cl.state, amount: cl.amount, filings: cl.filings, registrants: [...cl.registrants], issues: [...cl.issues], bills: [...cl.bills] },
      });
    }

    entities.push({
      id: "lobbying:summary",
      kind: "lobbying",
      state: "US",
      title: "Federal data-center lobbying summary",
      status: "summary",
      sources: [{ title: "Lobbying Disclosure Act database", url: "https://lda.gov/", publisher: "Lobbying Disclosure (Senate & House)", kind: "official" }],
      confidence: "high",
      data: {
        filings: relevant.length, clients: clients.size, registrants: new Set(relevant.map((f) => f.registrant.name)).size, totalAmount,
        issues: [...issues].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        agencies: [...agencies].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count })),
        years: YEARS,
      },
    });
    return { entities, relations };
  },
};
