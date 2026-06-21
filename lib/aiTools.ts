import { query } from "./db";
import type { Bbox } from "./queries";

/**
 * Tool definitions in Anthropic's tool-use schema, plus a dispatcher that
 * actually runs the corresponding SQL/RPC against Postgres/PostGIS.
 *
 * Each tool degrades gracefully (returns { available: false, reason }) if the
 * supporting dataset (population_grid, climate, roads, land_cover) hasn't
 * been loaded yet, so the AI can say "I don't have road data for this region
 * yet" instead of hallucinating.
 */

export const tools = [
  {
    name: "get_meteorite_stats",
    description:
      "Get meteorite counts, fall-vs-found split, mass distribution, and class breakdown for a bounding box.",
    input_schema: {
      type: "object",
      properties: {
        min_lng: { type: "number" },
        min_lat: { type: "number" },
        max_lng: { type: "number" },
        max_lat: { type: "number" }
      },
      required: ["min_lng", "min_lat", "max_lng", "max_lat"]
    }
  },
  {
    name: "get_population",
    description: "Get average population density (people/km^2) for a bounding box, if population data is loaded.",
    input_schema: {
      type: "object",
      properties: {
        min_lng: { type: "number" },
        min_lat: { type: "number" },
        max_lng: { type: "number" },
        max_lat: { type: "number" }
      },
      required: ["min_lng", "min_lat", "max_lng", "max_lat"]
    }
  },
  {
    name: "get_climate",
    description: "Get average annual rainfall (mm) and mean temperature (C) for a bounding box, if climate data is loaded.",
    input_schema: {
      type: "object",
      properties: {
        min_lng: { type: "number" },
        min_lat: { type: "number" },
        max_lng: { type: "number" },
        max_lat: { type: "number" }
      },
      required: ["min_lng", "min_lat", "max_lng", "max_lat"]
    }
  },
  {
    name: "get_dominant_land_cover",
    description: "Get the most common land cover class (e.g. forest, desert, urban, ice) for a bounding box, if land cover data is loaded.",
    input_schema: {
      type: "object",
      properties: {
        min_lng: { type: "number" },
        min_lat: { type: "number" },
        max_lng: { type: "number" },
        max_lat: { type: "number" }
      },
      required: ["min_lng", "min_lat", "max_lng", "max_lat"]
    }
  },
  {
    name: "get_road_density",
    description: "Get road density (km of road per km^2) for a bounding box, if road data is loaded. Used as a proxy for search accessibility.",
    input_schema: {
      type: "object",
      properties: {
        min_lng: { type: "number" },
        min_lat: { type: "number" },
        max_lng: { type: "number" },
        max_lat: { type: "number" }
      },
      required: ["min_lng", "min_lat", "max_lng", "max_lat"]
    }
  },
  {
    name: "compare_to_reference_region",
    description:
      "Get the same meteorite/population/climate/road stats for a second bounding box, to use as a contrast case (e.g. comparing a low-discovery region to a similarly-sized region known to be well-searched).",
    input_schema: {
      type: "object",
      properties: {
        min_lng: { type: "number" },
        min_lat: { type: "number" },
        max_lng: { type: "number" },
        max_lat: { type: "number" }
      },
      required: ["min_lng", "min_lat", "max_lng", "max_lat"]
    }
  }
] as const;

type Bounds = { min_lng: number; min_lat: number; max_lng: number; max_lat: number };

async function safeQuery<T>(fn: () => Promise<T>, label: string): Promise<any> {
  try {
    return await fn();
  } catch (err) {
    return { available: false, reason: `${label} data not loaded or query failed.` };
  }
}

async function statsFor(b: Bounds) {
  const rows = await query(
    `select * from get_meteorite_stats($1,$2,$3,$4)`,
    [b.min_lng, b.min_lat, b.max_lng, b.max_lat]
  );
  return rows[0] ?? { total_count: 0 };
}

async function populationFor(b: Bounds) {
  const rows = await query(`select get_population($1,$2,$3,$4) as avg_pop_density`, [
    b.min_lng, b.min_lat, b.max_lng, b.max_lat
  ]);
  const val = rows[0]?.avg_pop_density;
  if (val == null) return { available: false, reason: "No population data loaded for this region." };
  return { avg_pop_density_per_km2: val };
}

async function climateFor(b: Bounds) {
  const rows = await query(`select * from get_climate($1,$2,$3,$4)`, [
    b.min_lng, b.min_lat, b.max_lng, b.max_lat
  ]);
  const row = rows[0];
  if (!row || row.avg_rainfall_mm == null) return { available: false, reason: "No climate data loaded for this region." };
  return row;
}

async function landCoverFor(b: Bounds) {
  const rows = await query(`select get_dominant_land_cover($1,$2,$3,$4) as land_cover`, [
    b.min_lng, b.min_lat, b.max_lng, b.max_lat
  ]);
  const val = rows[0]?.land_cover;
  if (val == null) return { available: false, reason: "No land cover data loaded for this region." };
  return { dominant_land_cover: val };
}

async function roadsFor(b: Bounds) {
  const rows = await query(`select get_road_density($1,$2,$3,$4) as road_density_km_per_km2`, [
    b.min_lng, b.min_lat, b.max_lng, b.max_lat
  ]);
  const val = rows[0]?.road_density_km_per_km2;
  if (val == null) return { available: false, reason: "No road data loaded for this region." };
  return { road_density_km_per_km2: val };
}

/** Dispatches a single tool call from Claude and returns the JSON result. */
export async function runTool(name: string, input: Bounds): Promise<any> {
  switch (name) {
    case "get_meteorite_stats":
      return safeQuery(() => statsFor(input), "Meteorite");
    case "get_population":
      return safeQuery(() => populationFor(input), "Population");
    case "get_climate":
      return safeQuery(() => climateFor(input), "Climate");
    case "get_dominant_land_cover":
      return safeQuery(() => landCoverFor(input), "Land cover");
    case "get_road_density":
      return safeQuery(() => roadsFor(input), "Road");
    case "compare_to_reference_region":
      return safeQuery(async () => {
        const [stats, pop, climate, roads] = await Promise.all([
          statsFor(input),
          populationFor(input),
          climateFor(input),
          roadsFor(input)
        ]);
        return { stats, population: pop, climate, roads };
      }, "Reference region");
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export const SYSTEM_PROMPT = `You are a geospatial data analyst embedded in a meteorite-discovery
mapping tool. The user has noticed a pattern on the map (e.g. "few meteorites
here") and wants an investigated, evidence-based explanation - not speculation
dressed up as fact.

Use the available tools to gather population, climate, land cover, and road
data for the region in question before answering. When useful, call
compare_to_reference_region against a contrasting area to sharpen the
explanation (e.g. comparing a low-discovery rainforest region to a
well-searched desert of similar size).

If a tool reports data is unavailable, say so plainly rather than guessing.
Distinguish clearly between:
- factors supported by the data you retrieved (cite the numbers)
- plausible hypotheses that the data can't directly confirm (label them as such)

End your answer with a short list of "Confidence: high/medium/low" factors,
one per hypothesis, so the UI can render them as chips.`;
