"use client";

import Link from "next/link";
import { useState } from "react";
import type { CmteRef } from "@/lib/repo";
import { CategoryBadge, LeanBar, titleCase } from "./money";
import { money } from "./ui";

interface StateRow {
  code: string;
  name: string;
  total: number;
  proD: number;
  proR: number;
  primary: number;
  spenders: (CmteRef & { amount: number })[];
  pacs: (CmteRef & { amount: number })[];
}

export default function StateMoneyPicker({ states }: { states: StateRow[] }) {
  const sorted = [...states].sort((a, b) => b.total - a.total);
  const [code, setCode] = useState(sorted[0]?.code ?? "");
  const s = states.find((x) => x.code === code);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="State">
          {[...states].sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
        <span className="text-sm text-slate-500">Most spent in:</span>
        {sorted.slice(0, 8).map((x) => (
          <button key={x.code} type="button" onClick={() => setCode(x.code)} className={`rounded-full px-2.5 py-0.5 text-sm ${x.code === code ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {x.code} {money(x.total)}
          </button>
        ))}
      </div>
      {s && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-end justify-between">
              <h3 className="font-semibold">Outside spending in {s.name}: {money(s.total)}</h3>
              <LeanBar proD={s.proD} proR={s.proR} primary={s.primary} />
            </div>
            <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {s.spenders.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <Link href={`/money/${x.id}`} className="font-medium hover:underline">{titleCase(x.name)}</Link>{" "}
                    <CategoryBadge category={x.category} group={x.group} />
                  </span>
                  <span className="font-semibold tabular-nums">{money(x.amount)}</span>
                </li>
              ))}
              {s.spenders.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No outside spending reported.</li>}
            </ol>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Top PACs giving to {s.name} candidates</h3>
            <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {s.pacs.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <Link href={`/money/${x.id}`} className="font-medium hover:underline">{titleCase(x.name)}</Link>{" "}
                    <CategoryBadge category={x.category} group={x.group} />
                    {x.connectedOrg && <span className="block text-[11px] text-slate-500">Sponsored by {titleCase(x.connectedOrg)}</span>}
                  </span>
                  <span className="font-semibold tabular-nums">{money(x.amount)}</span>
                </li>
              ))}
              {s.pacs.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No PAC contributions reported.</li>}
            </ol>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Federal races only (U.S. House and Senate). Money in state races, such as governors and legislators, is reported to each state, not to the FEC.
        <Link href={`/states/${code}#money`} className="ml-1 underline">Open {s?.name} →</Link>
      </p>
    </div>
  );
}
