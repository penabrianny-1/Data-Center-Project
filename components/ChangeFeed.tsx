"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { hrefFor } from "@/lib/links";
import type { ChangeRow } from "@/lib/repo";
import { getLastChecked, setLastChecked } from "./WatchButton";
import { Pill, humanize } from "./ui";

/** The previous visit time, captured once per page load before this visit is recorded. */
let previous: string | null | undefined;
function previousVisit(): string | null {
  if (previous === undefined) {
    previous = getLastChecked();
    setLastChecked(new Date().toISOString());
  }
  return previous;
}
const noopSubscribe = () => () => {};

export default function ChangeFeed({ changes, filter }: { changes: ChangeRow[]; filter?: (c: ChangeRow) => boolean }) {
  const since = useSyncExternalStore(noopSubscribe, previousVisit, () => null);
  const [onlyNew, setOnlyNew] = useState(false);

  const rows = changes.filter((c) => (!filter || filter(c)) && (!onlyNew || !since || c.at > since));
  const newCount = since ? changes.filter((c) => (!filter || filter(c)) && c.at > since).length : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-xs">
        {newCount !== null ? (
          <span className="font-medium">{newCount} change(s) since your last check ({since!.slice(0, 16).replace("T", " ")} UTC)</span>
        ) : (
          <span className="text-slate-500">First visit on this browser: future visits will highlight what&apos;s new.</span>
        )}
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Only new since last check</label>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((c) => {
          const href = hrefFor(c.entity_id);
          const fields: string[] = c.fields ? JSON.parse(c.fields) : [];
          const isNew = since && c.at > since;
          return (
            <li key={c.seq} className={`flex flex-wrap items-baseline gap-2 px-3 py-1.5 text-xs ${isNew ? "bg-amber-50" : ""}`}>
              <time className="tabular-nums text-slate-500">{c.at.slice(0, 16).replace("T", " ")}</time>
              <Pill tone={c.change === "added" ? "green" : c.change === "removed" ? "red" : "amber"}>{c.change}</Pill>
              <span className="text-slate-500">{humanize(c.kind)}</span>
              {c.state && <span className="font-semibold">{c.state}</span>}
              {href ? <Link href={href} className="underline decoration-slate-300">{c.title}</Link> : <span>{c.title}</span>}
              {fields.length > 0 && <span className="text-slate-500">fields: {fields.slice(0, 6).join(", ")}</span>}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No changes recorded yet. Changes appear here as scheduled refreshes find new or updated records.</li>}
      </ul>
    </div>
  );
}
