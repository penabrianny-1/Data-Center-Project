import { cacheLife } from "next/cache";
import { geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import usAtlas from "us-atlas/states-albers-10m.json";
import countiesAtlas from "us-atlas/counties-albers-10m.json";
import { fetchAafFeed } from "./aaf";
import snapshot from "@/data/aaf-snapshot.json";
import statesData from "@/data/states.json";
import type { ArticleFeed, StatesData } from "./types";

/** AAF coverage, refreshed hourly. Falls back to the committed snapshot. */
export async function getFeed(): Promise<ArticleFeed> {
  "use cache";
  cacheLife("hours");
  try {
    return await fetchAafFeed();
  } catch (err) {
    console.error("[aaf] live fetch failed; serving snapshot:", err);
    return { ...(snapshot as ArticleFeed), method: "snapshot" };
  }
}

export function getStates(): StatesData {
  return statesData as StatesData;
}

export interface StateShape {
  fips: string;
  name: string;
  d: string;
}

/** Pre-projected (Albers USA, 975×610) SVG paths for each state. */
export async function getStateShapes(): Promise<{ shapes: StateShape[]; borders: string }> {
  "use cache";
  cacheLife("max");
  const topo = usAtlas as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>;
  const path = geoPath();
  const shapes = feature(topo, topo.objects.states).features.map((f) => ({
    fips: String(f.id),
    name: f.properties.name,
    d: path(f) ?? "",
  }));
  const borders = path(mesh(topo, topo.objects.states, (a, b) => a !== b)) ?? "";
  return { shapes, borders };
}

/** County outlines for one state, in the same projected space as the national map, plus a fitted viewBox. */
export async function getCountyShapes(stateFips: string): Promise<{ shapes: StateShape[]; borders: string; viewBox: string }> {
  "use cache";
  cacheLife("max");
  const topo = countiesAtlas as unknown as Topology<{ counties: GeometryCollection<{ name: string }>; states: GeometryCollection<{ name: string }> }>;
  const path = geoPath();
  const inState = (g: { id?: string | number }) => String(g.id).startsWith(stateFips);
  const geoms = topo.objects.counties.geometries.filter(inState);
  const fc = feature(topo, { type: "GeometryCollection", geometries: geoms });
  const shapes = fc.features.map((f) => ({ fips: String(f.id), name: f.properties.name, d: path(f) ?? "" }));
  const [[x0, y0], [x1, y1]] = path.bounds(fc);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
  const borders =
    path(mesh(topo, { type: "GeometryCollection", geometries: geoms }, (a, b) => a !== b)) ?? "";
  return {
    shapes,
    borders,
    viewBox: `${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${(x1 - x0 + 2 * pad).toFixed(1)} ${(y1 - y0 + 2 * pad).toFixed(1)}`,
  };
}
