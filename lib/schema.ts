/**
 * Canonical schemas for every curated ("seed") dataset in data/seed/.
 *
 * Every consequential record carries provenance: sources (typed by the source
 * hierarchy), a last-verified date, a confidence level, and room to record
 * conflicting evidence. Seed files are validated against these schemas by
 * `npm run validate` and by the test suite before they are ingested.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const stateCode = z.string().regex(/^[A-Z]{2}$/);
const party = z.enum(["D", "R", "I", "L", "G", "NP", "Other"]);

// ---------------------------------------------------------------------------
// Provenance

/**
 * Source hierarchy (highest to lowest authority):
 *  official   — statutes, legislative records, orders, dockets, filings, local codes
 *  data       — official agency datasets and structured government feeds
 *  journalism — credible news reporting
 *  research   — established policy research / think tanks
 *  aggregator — third-party trackers used for discovery or corroboration
 */
export const SourceKind = z.enum(["official", "data", "journalism", "research", "aggregator"]);

/**
 * Domains that are never acceptable as evidence: user-editable wikis, forums,
 * Q&A sites and AI-generated content portals. Use them for discovery only and
 * cite the underlying official or credible source instead.
 */
export const DISALLOWED_SOURCE_DOMAINS = [
  "wikipedia.org", "wikimedia.org", "wikidata.org", "wikiwand.com", "fandom.com",
  "reddit.com", "quora.com", "answers.com", "citizenportal.ai",
];

export function isDisallowedSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DISALLOWED_SOURCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

/** Kinds that can serve as a record's primary evidence (aggregators corroborate only). */
export const PRIMARY_SOURCE_KINDS = ["official", "data", "journalism", "research"] as const;

export const Source = z.object({
  title: z.string().min(3),
  url: z.url().refine((u) => !isDisallowedSource(u), {
    message: "source not allowed (Wikipedia, wikis, forums and AI-generated portals can't be cited; cite the official or credible original)",
  }),
  publisher: z.string().min(2),
  kind: SourceKind,
  /** Publication / filing date of the source document, if known */
  published: isoDate.optional(),
  /** Document identifier (bill number, docket number, order number…) */
  docId: z.string().optional(),
  /** Short supporting excerpt or paraphrase (keep under ~300 chars) */
  excerpt: z.string().max(400).optional(),
});

export const Confidence = z.enum(["high", "medium", "low"]);

/** Fields every curated record carries. */
export const Provenance = z.object({
  sources: z
    .array(Source)
    .min(1)
    .refine((s) => s.some((x) => (PRIMARY_SOURCE_KINDS as readonly string[]).includes(x.kind)), {
      message: "needs at least one official, data, journalism or research source — aggregators alone are not sufficient",
    }),
  verifiedAt: isoDate,
  confidence: Confidence,
  /** Conflicting evidence, ambiguity, or known gaps */
  caveats: z.string().optional(),
});

/** Evidence type for a claim — facts vs analysis vs forecasts are never mixed. */
export const EvidenceType = z.enum(["fact", "reported", "analysis", "forecast"]);

// ---------------------------------------------------------------------------
// Taxonomy

export const Topic = z.enum([
  "moratorium", "permitting", "zoning", "preemption", "environmental_review",
  "water", "grid_capacity", "interconnection", "transmission", "cost_allocation",
  "large_load_tariff", "backup_generation", "clean_energy_procurement",
  "property_tax", "sales_tax", "corporate_tax", "incentive_clawback",
  "community_benefits", "noise_light", "ai_policy", "disclosure", "efficiency",
  "elections", "campaign_finance", "nuclear", "natural_gas",
]);
export type Topic = z.infer<typeof Topic>;

export const ImpactDirection = z.enum(["restrictive", "permissive", "mixed", "neutral", "unclear"]);

// ---------------------------------------------------------------------------
// State government composition

const Chamber = z.object({
  name: z.string(),
  seats: z.object({
    D: z.number().int().nonnegative(),
    R: z.number().int().nonnegative(),
    other: z.number().int().nonnegative().default(0),
    vacant: z.number().int().nonnegative().default(0),
  }),
  total: z.number().int().positive(),
  control: z.enum(["D", "R", "split", "nonpartisan", "coalition"]),
  /** Seats up for election on 2026-11-03 (if known) */
  seatsUp2026: z.number().int().nonnegative().optional(),
  leaders: z.array(z.object({ role: z.string(), name: z.string(), party })).default([]),
});

export const StateGovernment = Provenance.extend({
  state: stateCode,
  governor: z.object({
    name: z.string(),
    party,
    tookOffice: isoDate.optional(),
    termEnds: isoDate.optional(),
    up2026: z.boolean(),
    termLimited: z.boolean().optional(),
    runningIn2026: z.boolean().optional(),
  }),
  lieutenantGovernor: z.object({ name: z.string(), party }).optional(),
  upper: Chamber.nullable(), // null for DC
  lower: Chamber.nullable(), // null for Nebraska (unicameral) and DC
  trifecta: z.enum(["D", "R", "divided"]),
  vetoOverride: z.string().optional(),
  /** Executive powers relevant to data centers: appointments, agencies, line-item veto, emergency powers */
  executivePowers: z.string(),
});

// ---------------------------------------------------------------------------
// Elections

export const Position = z.object({
  topic: Topic.or(z.enum(["energy", "economic_development", "affordability", "environment"])),
  /** Neutral one-sentence description of the documented position */
  summary: z.string(),
  /** true = candidate explicitly discussed data centers; false = inferred from broader positions */
  explicitDataCenter: z.boolean(),
  /** "fact" for enacted actions/votes, "reported" for statements, "analysis" for inferences */
  evidence: EvidenceType,
  date: isoDate.optional(),
  source: Source,
});

export const Candidate = z.object({
  name: z.string(),
  party,
  incumbent: z.boolean().default(false),
  status: z.enum(["nominee", "declared", "withdrawn", "lost_primary", "runoff"]),
  website: z.url().optional(),
  fecId: z.string().optional(),
  positions: z.array(Position).default([]),
});

export const Rating = z.object({
  rater: z.string(),
  rating: z.enum(["Solid D", "Likely D", "Lean D", "Tilt D", "Toss-up", "Tilt R", "Lean R", "Likely R", "Solid R"]),
  date: isoDate,
  url: z.url(),
});

export const Poll = z.object({
  pollster: z.string(),
  endDate: isoDate,
  sampleSize: z.number().int().positive().optional(),
  population: z.enum(["LV", "RV", "A"]).optional(),
  results: z.record(z.string(), z.number()),
  url: z.url(),
});

export const Race = Provenance.extend({
  id: z.string().regex(/^2026-(gov|sen|house|puc|local)-[A-Za-z0-9-]+$/),
  office: z.enum(["Governor", "U.S. Senate", "U.S. House", "Utility Commission", "Local"]),
  state: stateCode,
  district: z.string().optional(),
  special: z.boolean().default(false),
  electionDate: isoDate,
  primaryDate: isoDate.optional(),
  runoffDate: isoDate.optional(),
  incumbent: z.object({ name: z.string(), party, running: z.boolean() }).nullable(),
  candidates: z.array(Candidate),
  ratings: z.array(Rating).default([]),
  polls: z.array(Poll).default([]),
  /** What the winner can actually do about data centers (powers, not rhetoric) */
  powers: z.string(),
  /** Analysis: what a change in control would plausibly mean. Labeled analysis in UI. */
  implications: z.string(),
});

// ---------------------------------------------------------------------------
// Public utility commissions

export const Docket = Provenance.extend({
  id: z.string(),
  state: stateCode,
  docketNumber: z.string().optional(),
  title: z.string(),
  utility: z.string().optional(),
  type: z.enum([
    "large_load_tariff", "rate_case", "irp", "interconnection", "generation_approval",
    "transmission", "cost_allocation", "demand_response", "rulemaking", "special_contract", "other",
  ]),
  status: z.enum(["open", "proposed_order", "final_order", "settled", "withdrawn", "appealed", "stayed"]),
  filed: isoDate.optional(),
  latestAction: z.object({ date: isoDate, text: z.string() }).optional(),
  summary: z.string(),
  /** Why it matters for data center development */
  significance: z.string(),
  url: z.url(),
});

export const Commission = Provenance.extend({
  state: stateCode,
  name: z.string(),
  url: z.url(),
  seats: z.number().int().positive(),
  selection: z.enum(["elected", "appointed", "legislature", "mixed"]),
  /** e.g. "Governor appoints; Senate confirms" */
  selectionDetail: z.string(),
  termYears: z.number().positive().optional(),
  commissioners: z
    .array(z.object({ name: z.string(), role: z.string().optional(), party: party.optional(), termEnds: isoDate.optional() }))
    .default([]),
  /** Seats on the ballot 2026-11-03 (elected commissions only) */
  seatsUp2026: z.number().int().nonnegative().default(0),
  /** Mechanism linking the 2026 election to commission composition */
  electionMechanism: z.string(),
  largeLoadTariff: z.enum(["approved", "pending", "none_known", "under_consideration"]),
});

// ---------------------------------------------------------------------------
// State policy framework

export const DIMENSIONS = [
  "land_use", "local_authority", "permitting", "environmental_review", "water",
  "electricity", "cost_allocation", "incentives", "restrictions", "political_stability",
] as const;
export const Dimension = z.enum(DIMENSIONS);

/** -2 = strongly constrains development … +2 = strongly favors development. null = insufficient evidence */
export const DimensionScore = z.object({
  score: z.number().int().min(-2).max(2).nullable(),
  rationale: z.string(),
  indicators: z.array(z.string()).default([]),
  sources: z.array(Source).default([]),
  confidence: Confidence,
});

export const Incentive = z.object({
  name: z.string(),
  type: z.enum(["sales_tax", "property_tax", "income_tax", "electricity_tax", "other"]),
  status: z.enum(["enacted", "suspended", "repealed", "expiring", "proposed"]),
  citation: z.string().optional(),
  sunset: isoDate.optional(),
  summary: z.string(),
  url: z.url(),
});

export const StatePolicy = Provenance.extend({
  state: stateCode,
  incentives: z.array(Incentive).default([]),
  preemption: z.object({
    summary: z.string(),
    statutes: z.array(z.object({ citation: z.string(), url: z.url(), summary: z.string() })).default([]),
    /** Approvals that remain necessary despite preemption */
    remainingApprovals: z.array(z.string()).default([]),
  }),
  water: z.object({
    doctrine: z.enum(["riparian", "prior_appropriation", "hybrid", "regulated_riparian", "other"]),
    agency: z.string(),
    summary: z.string(),
    recentChanges: z.string().optional(),
  }),
  environmentalReview: z.object({ stateLevelReview: z.boolean(), statute: z.string().optional(), summary: z.string() }),
  electricity: z.object({
    market: z.string(), // e.g. "PJM", "ERCOT", "MISO", "vertically integrated (SERC)"
    summary: z.string(),
  }),
  dimensions: z.record(Dimension, DimensionScore),
});

// ---------------------------------------------------------------------------
// Legislation

export const BillStatus = z.enum([
  "introduced", "in_committee", "passed_committee", "passed_chamber", "passed_legislature",
  "enacted", "vetoed", "failed", "carried_over", "inactive",
]);

export const Bill = Provenance.extend({
  id: z.string().regex(/^[A-Z]{2}-[A-Za-z0-9]+-[A-Z]+\d+[A-Z]?$/, "e.g. VA-2026-HB1234 or US-119-HR1234"),
  jurisdiction: stateCode, // "US" for federal
  session: z.string(),
  number: z.string(),
  title: z.string(),
  url: z.url(),
  sponsors: z.array(z.object({ name: z.string(), party: party.optional() })).default([]),
  introduced: isoDate.optional(),
  latestAction: z.object({ date: isoDate, text: z.string() }),
  status: BillStatus,
  enactedDate: isoDate.optional(),
  effectiveDate: isoDate.optional(),
  committees: z.array(z.string()).default([]),
  themes: z.array(Topic).min(1),
  explicitDataCenter: z.boolean(),
  impact: ImpactDirection,
  summary: z.string(),
  significance: z.string(),
  related: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Local jurisdictions and actions

export const LocalAction = Provenance.extend({
  id: z.string(),
  state: stateCode,
  jurisdiction: z.string(), // "Loudoun County", "City of Tucson"
  jurisdictionType: z.enum(["county", "municipality", "township", "parish", "borough", "tribal", "other"]),
  /** 5-digit county FIPS of the county containing the jurisdiction */
  countyFips: z.string().regex(/^\d{5}$/),
  authority: z.string(), // "Board of Supervisors", "City Council", "Planning Commission"
  kind: z.enum([
    "moratorium", "ban", "zoning_ordinance", "special_use_requirement", "rezoning_decision",
    "project_approval", "project_denial", "referendum", "lawsuit", "other",
  ]),
  status: z.enum(["in_effect", "expired", "proposed", "repealed", "struck_down", "approved", "denied", "pending"]),
  adopted: isoDate.optional(),
  expires: isoDate.optional(),
  summary: z.string(),
  url: z.url().optional(),
});

// ---------------------------------------------------------------------------
// Priority developments feed

export const Development = Provenance.extend({
  id: z.string(),
  date: isoDate,
  title: z.string(),
  level: z.enum(["federal", "state", "local", "utility", "regional"]),
  jurisdiction: z.string(), // "US", "TX", "TX:Hood County", "PJM"
  states: z.array(stateCode).default([]),
  topics: z.array(Topic).min(1),
  authority: z.string(),
  status: z.enum(["enacted", "in_effect", "final", "proposed", "pending", "under_discussion", "failed", "announced"]),
  /** 5 = changes development feasibility across a major market; 1 = minor/local signal */
  severity: z.number().int().min(1).max(5),
  impact: ImpactDirection,
  whatHappened: z.string(),
  whyItMatters: z.string(),
  affected: z.string(),
  watchNext: z.string(),
  evidence: EvidenceType,
  related: z.array(z.string()).default([]),
});

export type Source = z.infer<typeof Source>;
export type StateGovernment = z.infer<typeof StateGovernment>;
export type Race = z.infer<typeof Race>;
export type Candidate = z.infer<typeof Candidate>;
export type Commission = z.infer<typeof Commission>;
export type Docket = z.infer<typeof Docket>;
export type StatePolicy = z.infer<typeof StatePolicy>;
export type Bill = z.infer<typeof Bill>;
export type LocalAction = z.infer<typeof LocalAction>;
export type Development = z.infer<typeof Development>;
export type Dimension = z.infer<typeof Dimension>;

/** Seed files and the schema each must satisfy (each file is a JSON array). */
export const SEED_FILES = {
  "state-government.json": StateGovernment,
  "races-governor.json": Race,
  "races-senate.json": Race,
  "races-house.json": Race,
  "commissions.json": Commission,
  "dockets.json": Docket,
  "state-policy.json": StatePolicy,
  "bills.json": Bill,
  "local-actions.json": LocalAction,
  "developments.json": Development,
} as const;
