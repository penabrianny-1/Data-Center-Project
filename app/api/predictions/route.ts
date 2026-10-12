import { z } from "zod";
import { applyRatingUpdates, readPredictions, RatingUpdate } from "@/lib/predictions";

export async function GET() {
  return Response.json(readPredictions());
}

/** Body: { updates: [{ raceId, rating | null, note? }] } */
export async function PUT(request: Request) {
  const body = z.object({ updates: z.array(RatingUpdate).min(1).max(100) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  return Response.json(applyRatingUpdates(body.data.updates));
}
