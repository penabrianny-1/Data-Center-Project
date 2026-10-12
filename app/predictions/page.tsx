import { connection } from "next/server";
import SenateBoard, { type BoardRace } from "@/components/SenateBoard";
import { getCandidatesForRace, getLegislators, getRaces } from "@/lib/repo";
import { readPredictions } from "@/lib/predictions";
import { stateName } from "@/lib/states";

export const metadata = { title: "My Senate ratings" };

export default async function PredictionsPage() {
  await connection();
  const races: BoardRace[] = getRaces()
    .filter((r) => r.data.office === "U.S. Senate")
    .map((r) => {
      const nominees = getCandidatesForRace(r.id)
        .filter((c) => c.data.status === "nominee")
        .map((c) => ({ name: c.data.name, party: c.data.party }));
      return {
        id: r.data.id,
        state: r.data.state,
        stateName: stateName(r.data.state),
        special: r.data.special,
        incumbent: r.data.incumbent,
        nominees,
        pros: r.data.ratings.map((x) => ({ rater: x.rater, rating: x.rating, date: x.date, url: x.url })),
      };
    })
    .sort((a, b) => a.stateName.localeCompare(b.stateName) || Number(a.special) - Number(b.special));

  // Seats not on the 2026 ballot, by caucus. Independents (King, Sanders) caucus with Democrats.
  const notUp = getLegislators().filter((l) => l.data.chamber === "Senate" && !l.data.up2026);
  const notUpD = notUp.filter((l) => l.data.party !== "R").length;
  const notUpR = notUp.filter((l) => l.data.party === "R").length;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <SenateBoard races={races} notUp={{ D: notUpD, R: notUpR }} initial={readPredictions()} />
    </div>
  );
}
