/** Race-rating scale shared by the predictions board (client) and its store (server). */
export const RATINGS = ["Solid D", "Likely D", "Lean D", "Tilt D", "Toss-up", "Tilt R", "Lean R", "Likely R", "Solid R"] as const;
export type RatingValue = (typeof RATINGS)[number];

export interface Predictions {
  version: 1;
  updatedAt: string | null;
  ratings: Record<string, { rating: RatingValue; note?: string; updatedAt: string }>;
  history: { raceId: string; from: RatingValue | null; to: RatingValue; at: string }[];
}

/** Direction of a move on the D→R scale: negative = toward Democrats. */
export function shift(from: RatingValue | null, to: RatingValue): number {
  return from === null ? 0 : RATINGS.indexOf(to) - RATINGS.indexOf(from);
}
