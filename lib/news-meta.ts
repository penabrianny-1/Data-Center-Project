import type { OutletType } from "./outlets";
import { classifyNews, type NewsCategory, type NewsSignal } from "./news-classify";
import { FOREIGN, isDomestic, namesUSPlace, statesFromPlaces } from "./geo-text";

export const OUTLET_TYPE_LABEL: Record<OutletType, string> = {
  government: "Official (.gov)",
  national_news: "National",
  business_news: "Business",
  public_media: "Public media",
  local_news: "Local",
  nonprofit_news: "Nonprofit",
  trade: "Trade press",
  press_release: "Company release",
};

export interface NewsData {
  title: string;
  url: string;
  published: string | null;
  summary: string;
  outlet: string;
  outletType: OutletType;
  /** Set for Google News items */
  via?: string;
  publisherDomain?: string;
  states: string[];
  policySignal: boolean;
}

export interface ClassifiedNews {
  id: string;
  title: string;
  date: string | null;
  data: NewsData;
  category: NewsCategory;
  topics: NewsCategory[];
  signal: NewsSignal;
  international: boolean;
}

/** Attach the rule-based category/signal (computed at read time so rule changes apply to the whole archive). */
export function classify(item: { id: string; title: string; date: string | null; data: NewsData }): ClassifiedNews {
  const c = classifyNews(item.title, item.data.summary ?? "");
  const text = `${item.title} ${item.data.summary ?? ""}`;
  // Add states named via cities/counties/hubs (e.g. "Memphis" → TN).
  const states = [...new Set([...item.data.states, ...statesFromPlaces(text)])];
  // Google News items carry the searched state, which only proves the article mentions it somewhere,
  // so a headline about a foreign place with no U.S. place in it is treated as international.
  const international =
    item.data.via === "Google News"
      ? FOREIGN.test(item.title) && !namesUSPlace(item.title.replace(/[‘“"'][^‘’“”"']{1,60}[’”"']/g, " "))
      : !isDomestic(item.title, states.length, item.data.summary ?? "");
  return { ...item, data: { ...item.data, states }, ...c, international };
}

export const SIGNAL_TONE: Record<NewsSignal, "red" | "amber" | "violet" | "green" | "slate"> = {
  restriction_active: "red",
  project_rejected: "red",
  restriction_advancing: "amber",
  under_discussion: "violet",
  favorable: "green",
  none: "slate",
};
