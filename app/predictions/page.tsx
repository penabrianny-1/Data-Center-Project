import { connection } from "next/server";
import PredictionTabs from "@/components/PredictionTabs";
import type { BoardRace, PartyMoney } from "@/components/SenateBoard";
import {
  getCandMoney, getCandidatesForRace, getChamberMarket, getPolls, getFinanceFor, getLegislators, getMarket, getRaces, getStateFinanceForCandidate,
  getStateGovernments, type Row,
} from "@/lib/repo";
import { readPredictions } from "@/lib/predictions";
import type { Race } from "@/lib/schema";
import { stateName } from "@/lib/states";

export const metadata = { title: "My ratings" };

function boardRace(r: Row<Race>): BoardRace {
  const cands = getCandidatesForRace(r.id).filter((c) => c.data.status === "nominee");
  const money: Record<string, PartyMoney> = {};
  for (const c of cands) {
    const party = c.data.party;
    if (!["D", "R", "I"].includes(party) || money[party]) continue;
    const fed = getFinanceFor(c.id)[0];
    const cm = fed ? getCandMoney(fed.data.fecId)?.data : undefined;
    const state = r.data.office === "Governor" ? getStateFinanceForCandidate(c.id)?.data : undefined;
    money[party] = {
      name: c.data.name,
      raised: fed?.data.receipts ?? state?.total ?? null,
      cash: fed?.data.cashOnHand ?? null,
      through: fed?.data.coverageEnd ?? state?.latest ?? null,
      outsideFor: cm?.outside?.support ?? null,
      outsideAgainst: cm?.outside?.oppose ?? null,
      source: fed ? "FEC" : state ? (state.agency ?? "state filings") : null,
    };
  }
  const m = getMarket(r.data.id)?.data;
  const pl = getPolls(r.data.id)?.data;
  const mu = pl?.matchup;
  const avgFor = (party: string) => {
    if (!mu?.average) return null;
    const i = mu.candidates.findIndex((c) => c.party === party);
    return i >= 0 ? mu.average.values[i] : null;
  };
  return {
    id: r.data.id,
    state: r.data.state,
    stateName: stateName(r.data.state),
    special: r.data.special,
    incumbent: r.data.incumbent,
    nominees: cands.map((c) => ({ name: c.data.name, party: c.data.party })),
    pros: r.data.ratings.map((x) => ({ rater: x.rater, rating: x.rating, date: x.date, url: x.url })),
    markets: m
      ? { avgD: m.average.D, avgR: m.average.R, quotes: m.quotes.map((q) => ({ market: q.market, url: q.url, D: q.byParty.D ?? 0, R: q.byParty.R ?? 0, volume: q.volume })) }
      : null,
    money,
    polls: mu?.average
      ? { D: avgFor("D"), R: avgFor("R"), n: mu.average.polls, source: "270toWin average", url: pl?.statePage ?? null }
      : pl?.average
        ? { D: pl.average.D, R: pl.average.R, n: pl.average.polls, source: "latest poll", url: pl.statePage }
        : null,
  };
}

export default async function PredictionsPage() {
  await connection();
  const races = getRaces();
  const sort = (a: BoardRace, b: BoardRace) => a.stateName.localeCompare(b.stateName) || Number(a.special) - Number(b.special);
  const senate = races.filter((r) => r.data.office === "U.S. Senate").map(boardRace).sort(sort);
  const governors = races.filter((r) => r.data.office === "Governor").map(boardRace).sort(sort);

  // Seats not on the ballot. Independents (King, Sanders) caucus with Democrats.
  const notUpSen = getLegislators().filter((l) => l.data.chamber === "Senate" && !l.data.up2026);
  const notUpGov = getStateGovernments().filter((g) => !g.data.governor.up2026 && g.state !== "DC");
  const control = getChamberMarket("senate")?.data;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <PredictionTabs
        senate={{ races: senate, notUp: { D: notUpSen.filter((l) => l.data.party !== "R").length, R: notUpSen.filter((l) => l.data.party === "R").length }, total: 100, majority: 51 }}
        governors={{ races: governors, notUp: { D: notUpGov.filter((g) => g.data.governor.party === "D").length, R: notUpGov.filter((g) => g.data.governor.party === "R").length }, total: 50, majority: 26 }}
        senateControl={control ? { D: control.average.D, R: control.average.R, markets: control.quotes.map((q) => q.market) } : null}
        initial={readPredictions()}
      />
    </div>
  );
}
