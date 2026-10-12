import type { StateStatus } from "./types";

/** Display order, labels and colors (Apple system palette, matching datacenterbans.com). */
export const STATUSES: { key: StateStatus; label: string; color: string; darkText?: boolean }[] = [
  { key: "ban", label: "Statewide Ban / Moratorium", color: "#FF3B30" },
  { key: "local", label: "Local Bans Only", color: "#FFA39E", darkText: true },
  { key: "advancing", label: "Legislation Advancing", color: "#FF9500" },
  { key: "discussion", label: "Under Discussion", color: "#5856D6" },
  { key: "none", label: "No Action", color: "#C7C7CC", darkText: true },
  { key: "favorable", label: "Favorable / Incentives", color: "#34C759" },
];

export const STATUS_BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s])) as Record<
  StateStatus,
  (typeof STATUSES)[number]
>;

/** Statuses counted as "restricting or considering restrictions". */
export const RESTRICTIVE: StateStatus[] = ["ban", "local", "advancing", "discussion"];
