"use client";

import { useState } from "react";
import type { Predictions } from "@/lib/ratings";
import SenateBoard, { type BoardRace } from "./SenateBoard";

interface Chamber {
  races: BoardRace[];
  notUp: { D: number; R: number };
  total: number;
  majority: number;
}

export default function PredictionTabs({
  senate, governors, senateControl, initial,
}: { senate: Chamber; governors: Chamber; senateControl: { D: number; R: number; markets: string[] } | null; initial: Predictions }) {
  const [tab, setTab] = useState<"sen" | "gov">("sen");
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit">
        {([["sen", `Senate (${senate.races.length})`], ["gov", `Governors (${governors.races.length})`]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "sen" ? (
        <SenateBoard key="sen" office="sen" {...senate} control={senateControl} initial={initial} />
      ) : (
        <SenateBoard key="gov" office="gov" {...governors} control={null} initial={initial} />
      )}
    </div>
  );
}
