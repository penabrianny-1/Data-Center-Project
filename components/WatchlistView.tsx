"use client";

import Link from "next/link";
import type { ChangeRow } from "@/lib/repo";
import ChangeFeed from "./ChangeFeed";
import { useWatchlist } from "./WatchButton";
import { Empty } from "./ui";

export default function WatchlistView({ changes }: { changes: ChangeRow[] }) {
  const [items, setItems] = useWatchlist();
  if (!items.length) {
    return (
      <Empty title="Nothing watched yet">
        Open a <Link href="/states" className="underline">state</Link>, county, <Link href="/elections" className="underline">race</Link> or{" "}
        <Link href="/legislation" className="underline">bill</Link> and click ☆ Watch.
      </Empty>
    );
  }
  const ids = new Set(items.map((i) => i.id));
  const states = new Set(items.filter((i) => i.kind === "state").map((i) => i.id.split(":")[1]));
  const matches = (c: ChangeRow) => ids.has(c.entity_id) || (c.state !== null && states.has(c.state));

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <ul className="h-fit divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between px-3 py-1.5">
            <span>
              <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">{i.kind}</span>
              <Link href={i.href} className="underline decoration-slate-300">{i.label}</Link>
            </span>
            <button type="button" onClick={() => setItems(items.filter((x) => x.id !== i.id))} className="text-slate-400 hover:text-rose-700" aria-label={`Stop watching ${i.label}`}>×</button>
          </li>
        ))}
      </ul>
      <div>
        <ChangeFeed changes={changes} filter={matches} />
        <p className="mt-2 text-[11px] text-slate-500">
          Notifications: email or push delivery isn&apos;t set up. That needs a mail provider and user accounts. This in-app feed is the
          audit trail those notifications would be built on.
        </p>
      </div>
    </div>
  );
}
