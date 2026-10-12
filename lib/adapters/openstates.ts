import type { Adapter, Entity, Relation } from "../ingest/types";
import { STATES } from "../states";

/**
 * 50-state bill discovery and status from the Open States (Plural Policy) API v3.
 * Docs: https://docs.openstates.org/api-v3/  Free key: https://open.pluralpolicy.com/accounts/signup/
 *
 * For every state + DC it searches bills mentioning "data center(s)", newest
 * activity first, and derives status from the official action classifications.
 * Each bill links to its official legislature page (Open States `sources`).
 */

const API = "https://v3.openstates.org";
const QUERIES = ['"data center"', '"data centers"'];
const MAX_PAGES_PER_QUERY = 2;
const PER_PAGE = 20;

export interface OsAction {
  description: string;
  date: string;
  classification: string[];
  organization?: { classification?: string; name?: string };
}
export interface OsBill {
  id: string;
  session: string;
  jurisdiction: { id: string; name: string };
  from_organization?: { name?: string; classification?: string };
  identifier: string;
  title: string;
  classification?: string[];
  subject?: string[];
  openstates_url: string;
  first_action_date?: string | null;
  latest_action_date?: string | null;
  latest_action_description?: string | null;
  sponsorships?: { name: string; primary?: boolean; classification?: string; person?: { party?: string } | null }[];
  actions?: OsAction[];
  sources?: { url: string; note?: string }[];
  abstracts?: { abstract: string }[];
}

type BillStatus = "introduced" | "in_committee" | "passed_committee" | "passed_chamber" | "passed_legislature" | "enacted" | "vetoed" | "failed";

/** Derive a normalized status from Open States action classifications (most advanced wins). */
export function deriveStatus(actions: OsAction[] = []): BillStatus {
  const has = (c: string) => actions.some((a) => a.classification?.includes(c));
  if (has("became-law") || has("executive-signature")) return "enacted";
  if (has("executive-veto") && !has("veto-override-passage")) return "vetoed";
  const passedChambers = new Set(actions.filter((a) => a.classification?.includes("passage")).map((a) => a.organization?.classification ?? "unknown"));
  if (passedChambers.size >= 2) return "passed_legislature";
  if (has("failure") || has("withdrawal")) return "failed";
  if (passedChambers.size === 1) return "passed_chamber";
  if (has("committee-passage") || has("committee-passage-favorable")) return "passed_committee";
  if (has("referral-committee")) return "in_committee";
  return "introduced";
}

/** "HB 1234" / "H.B. 1234" / "HB1234" → "HB1234" for matching against curated ids. */
export const normalizeIdentifier = (s: string) => s.toUpperCase().replace(/[.\s]/g, "");

const PARTY: Record<string, string> = { Democratic: "D", Republican: "R", Independent: "I" };

export function toEntity(b: OsBill, stateCode: string): Entity {
  const official = b.sources?.find((s) => !/openstates\.org/.test(s.url))?.url ?? b.openstates_url;
  const actions = [...(b.actions ?? [])].sort((x, y) => x.date.localeCompare(y.date));
  const latest = actions.at(-1);
  const status = deriveStatus(actions);
  return {
    id: `openstates:${b.id}`,
    kind: "bill",
    state: stateCode,
    title: `${b.identifier}: ${b.title}`,
    date: (b.latest_action_date ?? latest?.date ?? null)?.slice(0, 10) ?? null,
    status,
    searchText: `${b.identifier} ${b.title} ${(b.subject ?? []).join(" ")} ${(b.abstracts ?? []).map((a) => a.abstract).join(" ")}`,
    sources: [
      { title: `${stateCode} ${b.identifier} (official legislature page)`, url: official, publisher: `${b.jurisdiction.name} Legislature`, kind: "official", docId: b.identifier },
      { title: `Open States: ${b.identifier}`, url: b.openstates_url, publisher: "Open States / Plural Policy", kind: "data", docId: b.id },
    ],
    verifiedAt: new Date().toISOString().slice(0, 10),
    confidence: "high",
    data: {
      openstatesId: b.id,
      jurisdiction: stateCode,
      session: b.session,
      identifier: b.identifier,
      number: b.identifier,
      title: b.title,
      chamber: b.from_organization?.name ?? null,
      status,
      introduced: b.first_action_date?.slice(0, 10) ?? actions[0]?.date.slice(0, 10) ?? null,
      latestAction: {
        date: (b.latest_action_date ?? latest?.date ?? "").slice(0, 10),
        text: b.latest_action_description ?? latest?.description ?? "",
      },
      sponsors: (b.sponsorships ?? [])
        .filter((s) => s.primary || s.classification === "primary")
        .map((s) => ({ name: s.name, party: s.person?.party ? PARTY[s.person.party] : undefined })),
      subjects: b.subject ?? [],
      abstract: b.abstracts?.[0]?.abstract ?? null,
      url: official,
      openstatesUrl: b.openstates_url,
      actions: actions.slice(-12).map((a) => ({ date: a.date.slice(0, 10), text: a.description, classification: a.classification })),
    },
  };
}

export const openStatesAdapter: Adapter = {
  id: "openstates",
  name: "Open States: 50-state bill discovery & status",
  url: "https://open.pluralpolicy.com/",
  sourceKind: "data",
  method: "api",
  schedule: "Daily",
  refreshMinutes: 1440,
  coverage:
    "Bills in all 50 states, DC and Puerto Rico whose text or title mentions data centers, with status derived from official action records and links to each legislature's bill page. Open States normalizes official legislature data, which typically lags official sites by up to a day. Bills that affect data centers without naming them aren't discovered and stay in the curated list.",
  requiresEnv: "OPENSTATES_API_KEY",
  dependsOn: ["curated"],
  async run({ fetch, env, lookup, log }) {
    const key = env.OPENSTATES_API_KEY!;
    const entities = new Map<string, Entity>();
    const warnings: string[] = [];
    let requests = 0;

    for (const st of STATES) {
      for (const q of QUERIES) {
        for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
          const params = new URLSearchParams({ jurisdiction: st.name, q, sort: "latest_action_desc", per_page: String(PER_PAGE), page: String(page) });
          for (const inc of ["actions", "sponsorships", "sources", "abstracts"]) params.append("include", inc);
          try {
            requests++;
            const res = await fetch(`${API}/bills?${params}`, { headers: { "X-API-KEY": key }, retries: 2 });
            const j = (await res.json()) as { results: OsBill[]; pagination: { max_page: number } };
            for (const b of j.results) {
              // Keep the 2025–2026 cycle and anything with action since 2025.
              if ((b.latest_action_date ?? "") < "2025-01-01") continue;
              entities.set(b.id, toEntity(b, st.code));
            }
            if (page >= j.pagination.max_page) break;
          } catch (err) {
            warnings.push(`${st.code} ${q} p${page}: ${(err as Error).message}`);
            break;
          }
        }
      }
    }
    log(`Open States: ${requests} requests, ${entities.size} bills across ${new Set([...entities.values()].map((e) => e.state)).size} jurisdictions`);
    if (entities.size === 0) throw new Error(`No bills returned: ${warnings[0] ?? "unknown error"}`);

    // Link to curated bill records (same state + identifier) so curated analysis gets official status.
    const relations: Relation[] = [];
    const curated = new Map(
      lookup("bill")
        .filter((b) => b.id.startsWith("bill:") && b.state !== "US")
        .map((b) => {
          const d = b.data as { number: string; session: string };
          return [`${b.state}|${normalizeIdentifier(d.number)}|${d.session.match(/\d{4}/)?.[0] ?? ""}`, b.id];
        }),
    );
    for (const e of entities.values()) {
      const d = e.data as { identifier: string; session: string };
      const match = curated.get(`${e.state}|${normalizeIdentifier(d.identifier)}|${d.session.match(/\d{4}/)?.[0] ?? ""}`);
      if (match) relations.push({ src: e.id, dst: match, type: "official_record_of" });
    }
    return { entities: [...entities.values()], relations, warnings };
  },
};
