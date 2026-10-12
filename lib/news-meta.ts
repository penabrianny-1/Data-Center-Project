import type { OutletType } from "./outlets";
import { classifyNews, isInternational, type NewsCategory, type NewsSignal } from "./news-classify";

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
  return { ...item, ...c, international: isInternational(`${item.title} ${item.data.summary ?? ""}`, item.data.states.length) };
}

export const SIGNAL_TONE: Record<NewsSignal, "red" | "amber" | "violet" | "green" | "slate"> = {
  restriction_active: "red",
  project_rejected: "red",
  restriction_advancing: "amber",
  under_discussion: "violet",
  favorable: "green",
  none: "slate",
};
