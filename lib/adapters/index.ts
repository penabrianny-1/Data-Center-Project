import type { Adapter } from "../ingest/types";
import { aafAdapter } from "./aaf";
import { congressAdapter } from "./congress";
import { fecAdapter, fecIeAdapter } from "./fec";
import { aaaAdapter, eiaAdapter } from "./gas";
import { legislatorsAdapter } from "./legislators";
import { googleNewsAdapter } from "./google-news";
import { newsAdapter } from "./news";
import { openStatesAdapter } from "./openstates";
import { resolveAdapter } from "./resolve";
import { seedAdapter } from "./seed";

/** All adapters in dependency order. */
export const ADAPTERS: Adapter[] = [
  seedAdapter,
  legislatorsAdapter,
  fecAdapter,
  fecIeAdapter,
  congressAdapter,
  openStatesAdapter,
  aafAdapter,
  newsAdapter,
  googleNewsAdapter,
  aaaAdapter,
  eiaAdapter,
  resolveAdapter,
];

/**
 * Sources evaluated but not (yet) integrated, with the reason. Shown on the
 * Sources page so coverage gaps are explicit rather than implied.
 */
export const PENDING_SOURCES: { name: string; url: string; status: string; reason: string }[] = [
  {
    name: "Congress.gov API",
    url: "https://api.congress.gov/",
    status: "Optional",
    reason: "Federal bill status already comes from GovInfo BILLSTATUS bulk data, which needs no key. A Congress.gov key would add amendment and action-history detail.",
  },
  {
    name: "LegiScan",
    url: "https://legiscan.com/legiscan",
    status: "Needs API key",
    reason: "An alternative 50-state bill API, with a free tier that needs a key. Kept as a candidate for cross-checking bill status.",
  },
  {
    name: "BillTrack50 / NCSL / Ballotpedia trackers",
    url: "https://www.billtrack50.com/info/",
    status: "Discovery only",
    reason: "Third-party trackers are used to find bills and cross-check them, never as the record of truth. Their terms don't allow bulk use.",
  },
  {
    name: "State campaign finance portals",
    url: "https://www.ncsl.org/elections-and-campaigns/state-campaign-finance-disclosure-requirements",
    status: "Not integrated",
    reason:
      "There are about 50 separate systems with different formats and terms. Governor, state legislature and utility-commission candidate finance isn't integrated yet. FollowTheMoney (OpenSecrets) bulk access needs an agreement.",
  },
  {
    name: "AdImpact",
    url: "https://adimpact.com/",
    status: "Licensed data",
    reason:
      "Ad-spending data is proprietary and needs a subscription. Only AdImpact's own published figures, as cited in curated records, are shown. No licensed data is simulated.",
  },
  {
    name: "Senate LDA lobbying disclosures",
    url: "https://lda.senate.gov/api/",
    status: "Planned",
    reason: "This public API can give federal lobbying filings on data-center, energy and AI issues. Planned for the campaign-finance phase.",
  },
  {
    name: "Utility service territories & transmission (HIFLD / EIA-861)",
    url: "https://hifld-geoplatform.hub.arcgis.com/",
    status: "Planned",
    reason: "Public geospatial layers for utility territories and transmission lines. Planned for the map's infrastructure layers.",
  },
  {
    name: "Water stress (WRI Aqueduct / USGS)",
    url: "https://www.wri.org/aqueduct",
    status: "Planned",
    reason: "Basin-level water-stress indicators for the water layer. Planned, and will be kept separate from legal permitting constraints.",
  },
  {
    name: "County & municipal codes (Municode, eCode360, agendas)",
    url: "https://library.municode.com/",
    status: "Curated sample",
    reason:
      "There's no unified machine-readable source for local zoning across about 19,000 municipalities and 3,000 counties. Local actions are a curated, sourced sample. Counties with no record show as unresearched, not as having no rules.",
  },
];
