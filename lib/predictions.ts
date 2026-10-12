/**
 * The user's own race ratings ("My ratings"), stored as a JSON file so they
 * persist across browsers and restarts. Every change is appended to a history
 * so the board can show which races moved and when.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { RATINGS, type Predictions } from "./ratings";
export { RATINGS, shift, type Predictions, type RatingValue } from "./ratings";

const Entry = z.object({
  rating: z.enum(RATINGS),
  note: z.string().max(1000).optional(),
  updatedAt: z.string(),
});
const Change = z.object({ raceId: z.string(), from: z.enum(RATINGS).nullable(), to: z.enum(RATINGS), at: z.string() });
export const PredictionsFile = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  ratings: z.record(z.string(), Entry),
  history: z.array(Change),
});

export const PREDICTIONS_PATH = process.env.PREDICTIONS_PATH ?? join(process.cwd(), "data", "user", "predictions.json");

const EMPTY: Predictions = { version: 1, updatedAt: null, ratings: {}, history: [] };

export function readPredictions(path = PREDICTIONS_PATH): Predictions {
  if (!existsSync(path)) return structuredClone(EMPTY);
  const parsed = PredictionsFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  return parsed.success ? (parsed.data as Predictions) : structuredClone(EMPTY);
}

export const RatingUpdate = z.object({
  raceId: z.string().regex(/^2026-(sen|gov)-[A-Z]{2}(-special)?$/),
  rating: z.enum(RATINGS).nullable(),
  note: z.string().max(1000).optional(),
});
export type RatingUpdate = z.infer<typeof RatingUpdate>;

/** Apply updates (null rating = clear) and persist atomically. */
export function applyRatingUpdates(updates: RatingUpdate[], path = PREDICTIONS_PATH, now = new Date().toISOString()): Predictions {
  const p = readPredictions(path);
  for (const u of updates) {
    const prev = p.ratings[u.raceId];
    if (u.rating === null) {
      delete p.ratings[u.raceId];
      continue;
    }
    if (!prev || prev.rating !== u.rating) p.history.push({ raceId: u.raceId, from: prev?.rating ?? null, to: u.rating, at: now });
    p.ratings[u.raceId] = { rating: u.rating, note: u.note ?? prev?.note, updatedAt: now };
  }
  p.history = p.history.slice(-2000);
  p.updatedAt = now;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2) + "\n");
  renameSync(tmp, path);
  return p;
}
