/**
 * Congressional committees with meaningful jurisdiction over data-center
 * relevant policy. `relevance` is editorial analysis (labeled as such in the
 * UI); official jurisdiction text comes from the congress-legislators dataset.
 */
export interface CommitteeRelevance {
  id: string;
  topics: string[];
  relevance: string;
  /** Subcommittees most directly involved */
  keySubcommittees: string[];
}

export const RELEVANT_COMMITTEES: CommitteeRelevance[] = [
  {
    id: "HSIF",
    topics: ["grid_capacity", "interconnection", "transmission", "permitting", "ai_policy"],
    relevance:
      "Primary House committee for the Federal Power Act and FERC oversight, so it shapes interconnection, transmission and large-load policy. It also handles federal AI and data privacy legislation.",
    keySubcommittees: ["HSIF03", "HSIF18", "HSIF17"],
  },
  {
    id: "SSEG",
    topics: ["grid_capacity", "transmission", "permitting", "nuclear", "water"],
    relevance:
      "Senate counterpart for FERC, DOE, the national labs and federal lands. It is central to permitting reform, DOE data-center siting on federal land and transmission.",
    keySubcommittees: ["SSEG01", "SSEG07"],
  },
  {
    id: "SSEV",
    topics: ["environmental_review", "permitting", "backup_generation", "water"],
    relevance:
      "Handles NEPA, the Clean Air Act (backup generator permits) and the Clean Water Act. It is the main venue for environmental-review reform affecting large projects.",
    keySubcommittees: ["SSEV10", "SSEV15"],
  },
  {
    id: "HSII",
    topics: ["permitting", "environmental_review", "water"],
    relevance:
      "Handles NEPA reform on the House side (e.g. the SPEED Act), federal lands, and Bureau of Reclamation water in the West.",
    keySubcommittees: ["HSII06", "HSII10", "HSII13"],
  },
  {
    id: "SSFI",
    topics: ["corporate_tax", "clean_energy_procurement"],
    relevance:
      "Handles federal tax treatment: energy tax credits that affect data-center power procurement, depreciation and other incentives.",
    keySubcommittees: ["SSFI12", "SSFI11"],
  },
  {
    id: "HSWM",
    topics: ["corporate_tax", "clean_energy_procurement"],
    relevance: "Originates revenue legislation, including energy credits and expensing rules that shape data-center economics.",
    keySubcommittees: ["HSWM05"],
  },
  {
    id: "SSCM",
    topics: ["ai_policy", "disclosure"],
    relevance:
      "Senate jurisdiction over AI, technology and communications policy, including federal preemption of state AI laws, which affects demand-side AI regulation.",
    keySubcommittees: ["SSCM35", "SSCM37"],
  },
  {
    id: "HSSY",
    topics: ["ai_policy", "efficiency", "nuclear"],
    relevance: "Authorizes DOE research programs, including energy-efficiency and advanced-nuclear R&D tied to data-center power.",
    keySubcommittees: ["HSSY20", "HSSY15"],
  },
  {
    id: "HSPW",
    topics: ["water", "permitting"],
    relevance: "Handles Clean Water Act Section 404 (wetlands) permits and water infrastructure, and sometimes the site-level federal permits.",
    keySubcommittees: ["HSPW02"],
  },
  {
    id: "SSAP",
    topics: ["grid_capacity", "nuclear"],
    relevance: "Its Energy and Water Development subcommittee funds DOE, the grid programs and the Army Corps of Engineers.",
    keySubcommittees: ["SSAP22"],
  },
  {
    id: "HSAP",
    topics: ["grid_capacity", "nuclear"],
    relevance: "Its Energy and Water Development subcommittee funds DOE, the grid programs and the Army Corps of Engineers.",
    keySubcommittees: ["HSAP10"],
  },
];

export const RELEVANT_COMMITTEE_IDS = new Set(RELEVANT_COMMITTEES.map((c) => c.id));
