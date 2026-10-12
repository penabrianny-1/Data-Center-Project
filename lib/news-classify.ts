import { isDomestic as isDomesticImpl } from "./geo-text";
/**
 * Rule-based categorization of news stories, modeled on datacenterbans.com's
 * scheme: a topic (Moratoriums, Construction, AI Legislation, …) plus a status
 * signal matching its state categories (Active ban/moratorium, Legislation
 * advancing, Under discussion, Favorable/incentives).
 *
 * Deterministic keyword rules over headline + summary, with headline matches
 * weighted double. Transparent and testable, but labeled "auto-categorized"
 * in the UI because keyword rules can misread a story.
 */

export const NEWS_CATEGORIES = {
  moratorium: "Moratoriums & bans",
  legislation: "Legislation",
  ai_legislation: "AI legislation",
  local_zoning: "Zoning & local permits",
  construction: "Construction & projects",
  energy_grid: "Power & grid",
  water: "Water",
  incentives: "Tax incentives",
  elections: "Elections & politics",
  courts: "Lawsuits & courts",
  community: "Community opposition",
  industry: "Industry & markets",
} as const;
export type NewsCategory = keyof typeof NEWS_CATEGORIES;

export const NEWS_SIGNALS = {
  restriction_active: "Ban / moratorium enacted",
  project_rejected: "Project rejected",
  restriction_advancing: "Restriction advancing",
  under_discussion: "Under discussion",
  favorable: "Favorable / approval",
  none: "No status signal",
} as const;
export type NewsSignal = keyof typeof NEWS_SIGNALS;

const RULES: Record<Exclude<NewsCategory, "industry">, RegExp[]> = {
  moratorium: [/\bmoratori(um|a|ums)\b/i, /\bban(s|ned|ning)?\b.{0,40}data cent/i, /data cent\w*.{0,40}\bban(s|ned)?\b/i, /\bpause[sd]?\b.{0,30}(new )?data cent/i, /\bprohibit/i, /\bhalt(s|ed)?\b.{0,30}(data cent|permit)/i],
  legislation: [/\bregulat(e|es|ing|ions?|ors?|ory)\b/i, /\b(bill|legislation|lawmakers?|legislature|general assembly|statehouse|senate|house) (passes|passed|approves|approved|advances|votes?|introduce[sd]?|kill(s|ed)?)\b/i, /\b(signed into law|signs? (the )?bill|veto(es|ed)?|override)\b/i, /\b(HB|SB|AB|LD|H\.|S\.)\s?\d{2,5}\b/, /\blegislat(ion|ive|or|ors)\b/i, /\bstate law\b/i],
  ai_legislation: [/\bAI (bill|law|act|regulation|rules|safety|policy|preemption)\b/i, /\bartificial intelligence (act|bill|law|regulation)\b/i, /\bpreempt\w* state AI\b/i, /\bAI moratorium\b/i],
  local_zoning: [/\b(zoning|rezon\w*|planning commission|board of (supervisors|commissioners)|county commission(ers)?|city council|township|special[- ]use|conditional[- ]use|site plan|annex\w*|ordinances?|setbacks?|noise rules?)\b/i],
  construction: [/\b(breaks? ground|groundbreaking|construction (begins|starts|underway)|to build|plans? (a |for )?(new )?(\$[\d.]+ ?(b|m)illion )?(data cent|campus|facility))\b/i, /\b(campus|hyperscale|gigawatt|megawatt|\d+ ?(MW|GW))\b/i, /\$[\d.]+ ?(billion|bn)\b/i, /\b(acres?|square[- ]feet)\b/i, /\b(announce[sd]?|unveil\w*|propos\w*) .{0,40}data cent/i],
  energy_grid: [/\b(grid|utility|utilities|electric(ity)?|power (plant|line|demand|bills?|prices?|supply)|ratepayers?|rates?|tariff|transmission|interconnect\w*|PJM|ERCOT|MISO|FERC|nuclear|natural gas|gas plant|turbines?|capacity auction|load growth|large[- ]load)\b/i],
  water: [/\b(water|aquifer|drought|groundwater|wastewater|cooling)\b/i],
  incentives: [/\b(tax (break|credit|exemption|incentive|abatement)s?|sales tax|property tax|incentives?|abatements?|PILOT)\b/i],
  elections: [/\b(campaign|candidate|election|ballot|referendum|primary|governor'?s race|voters?|poll(s|ing)?|midterms?|endorse\w*)\b/i],
  courts: [/\b(lawsuit|sue[sd]?|suing|court|judge|appeal(s|ed)?|ruling|injunction|litigation)\b/i],
  community: [/\b(residents|neighbors|opposition|oppose[sd]?|opponents|protest\w*|petition\w*|pushback|backlash|outcry|concerns?)\b/i],
};

const SIGNAL_RULES: { signal: Exclude<NewsSignal, "none">; re: RegExp }[] = [
  { signal: "restriction_active", re: /\b(approv\w*|adopt\w*|pass\w*|enact\w*|impos\w*|extend\w*|sign\w*|vot\w* (to|for)) .{0,40}\b(moratori\w*|ban)\b|\b(moratori\w*|ban)\b.{0,30}\b(approved|adopted|passed|enacted|takes effect|in effect|extended)\b|\bhalts?\b.{0,30}(data cent|permits?)/i },
  { signal: "project_rejected", re: /\b(rejects?|rejected|denies|denied|votes? (down|against)|turns? down|withdraws?|withdrawn|scraps?|scrapped|blocks?|blocked)\b.{0,60}(data cent|campus|rezoning|project|MW)|\b(data cent\w*|campus|rezoning|project)\b.{0,40}\b(rejected|denied|withdrawn|scrapped|blocked)\b/i },
  { signal: "restriction_advancing", re: /\b(advances?|advancing|clears?|passes (the )?(house|senate|committee)|moves? forward|heads to (the )?(governor|senate|house))\b/i },
  { signal: "under_discussion", re: /\b(consider\w*|propos\w*|weigh\w*|debat\w*|hearing|public comment|could|discuss\w*|explor\w*|call(s|ed)? for)\b/i },
  { signal: "favorable", re: /\b(approv\w* .{0,60}(data cent|project|campus|rezoning|tax break|incentive|plan)|tax (break|incentive|exemption)s? (approved|extended|granted)|welcome\w*|lands? .{0,20}data cent|breaks? ground|groundbreaking)\b/i },
];

/** @deprecated use isDomestic from ./geo-text */
export function isInternational(text: string, statesTagged: number): boolean {
  return !isDomesticImpl(text, statesTagged);
}

export interface Classification {
  category: NewsCategory;
  /** All matched topics, strongest first (includes `category`) */
  topics: NewsCategory[];
  signal: NewsSignal;
}

function score(title: string, summary: string, patterns: RegExp[]): number {
  let s = 0;
  for (const re of patterns) {
    if (re.test(title)) s += 2;
    else if (re.test(summary)) s += 1;
  }
  return s;
}

export function classifyNews(title: string, summary = ""): Classification {
  const scored = (Object.keys(RULES) as (keyof typeof RULES)[])
    .map((c) => ({ c, s: score(title, summary, RULES[c]) }))
    .filter((x) => x.s > 0)
    // Ties break toward the more specific/consequential category (RULES order).
    .sort((a, b) => b.s - a.s);

  // A moratorium or AI-law headline outranks generic topic words.
  let topics: NewsCategory[] = scored.map((x) => x.c);
  for (const priority of ["moratorium", "ai_legislation"] as const) {
    const hit = scored.find((x) => x.c === priority);
    if (hit && RULES[priority].some((re) => re.test(title))) topics = [priority, ...topics.filter((t) => t !== priority)];
  }
  if (topics.length === 0) topics = ["industry"];

  const text = `${title} ${summary}`;
  const restrictionContext = topics.includes("moratorium") || /\b(restrict|limit|ban|moratori|regulat|rules?\b|guardrails?|ordinance)/i.test(text);
  let signal: NewsSignal = "none";
  for (const { signal: sig, re } of SIGNAL_RULES) {
    if (!re.test(text)) continue;
    // Advancing/discussion signals only count for restriction stories.
    if ((sig === "restriction_advancing" || sig === "under_discussion") && !restrictionContext && !topics.includes("legislation")) continue;
    signal = sig;
    break;
  }
  return { category: topics[0], topics: topics.slice(0, 4), signal };
}
