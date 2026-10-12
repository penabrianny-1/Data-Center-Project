export type StateStatus =
  | "ban"
  | "local"
  | "advancing"
  | "discussion"
  | "none"
  | "favorable";

export interface StateEntry {
  code: string;
  fips: string;
  name: string;
  status: StateStatus;
  summary: string;
  highlights?: string[];
  sources: { title: string; url: string }[];
  confidence: "high" | "medium" | "low";
}

export interface StatesData {
  lastUpdated: string;
  states: StateEntry[];
}

export interface Article {
  id: string;
  title: string;
  url: string;
  /** ISO 8601 publish date */
  date: string;
  /** AAF content type, e.g. "Insight", "The Daily Dish" */
  type: string;
  author: string | null;
  excerpt: string;
  /** Number of "data center" mentions found in the article text */
  mentions: number;
  /** "primary" = article is about data centers; "mention" = passing reference */
  relevance: "primary" | "mention";
}

export interface ArticleFeed {
  articles: Article[];
  fetchedAt: string;
  /** Which strategy produced the feed */
  method: "algolia" | "scrape" | "snapshot";
}
