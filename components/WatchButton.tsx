"use client";

import { useSyncExternalStore } from "react";

export interface WatchItem {
  id: string;
  label: string;
  href: string;
  kind: string;
  addedAt: string;
}

const KEY = "dci.watchlist.v1";
const LAST_VISIT = "dci.watchlist.lastChecked.v1";
const listeners = new Set<() => void>();

export function readWatchlist(): WatchItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(items: WatchItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  cached = null;
  listeners.forEach((l) => l());
}
let cached: string | null = null;
function snapshot() {
  cached ??= typeof window === "undefined" ? "[]" : (localStorage.getItem(KEY) ?? "[]");
  return cached;
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useWatchlist(): [WatchItem[], (items: WatchItem[]) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return [JSON.parse(raw) as WatchItem[], write];
}

export function getLastChecked(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(LAST_VISIT);
}
export function setLastChecked(at: string) {
  localStorage.setItem(LAST_VISIT, at);
}

export default function WatchButton({ id, label, href, kind }: Omit<WatchItem, "addedAt">) {
  const [items, setItems] = useWatchlist();
  const watching = items.some((i) => i.id === id);
  return (
    <button
      type="button"
      onClick={() =>
        setItems(watching ? items.filter((i) => i.id !== id) : [...items, { id, label, href, kind, addedAt: new Date().toISOString() }])
      }
      className={`rounded border px-2.5 py-1 text-xs font-medium ${
        watching ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
      }`}
      aria-pressed={watching}
    >
      {watching ? "★ Watching" : "☆ Watch"}
    </button>
  );
}
