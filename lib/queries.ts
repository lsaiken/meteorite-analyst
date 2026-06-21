import { query } from "./db";

export type Bbox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]

export interface MeteoriteFilters {
  yearMin?: number;
  yearMax?: number;
  recclass?: string;
  discoveryMethod?: "Fell" | "Found";
  massMin?: number;
  massMax?: number;
  bbox?: Bbox;
}

export async function getMeteoritesGeoJSON(filters: MeteoriteFilters) {
  // Off-world finds (e.g. Meridiani Planum, found on Mars) have no
  // meaningful Earth geometry - always excluded from map rendering,
  // regardless of other filters. Surfaced separately via getOffWorldFinds().
  const clauses: string[] = ["geom is not null", "not is_off_world"];
  const params: any[] = [];

  const push = (clause: string, value: any) => {
    params.push(value);
    clauses.push(clause.replace("$", `$${params.length}`));
  };

  if (filters.yearMin != null) push("year >= $", filters.yearMin);
  if (filters.yearMax != null) push("year <= $", filters.yearMax);
  if (filters.recclass) push("recclass = $", filters.recclass);
  if (filters.discoveryMethod) push("discovery_method = $", filters.discoveryMethod);
  if (filters.massMin != null) push("mass_g >= $", filters.massMin);
  if (filters.massMax != null) push("mass_g <= $", filters.massMax);
  if (filters.bbox) {
    const [minLng, minLat, maxLng, maxLat] = filters.bbox;
    params.push(minLng, minLat, maxLng, maxLat);
    clauses.push(
      `geom && st_makeenvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`
    );
  }

  const sql = `
    select
      nasa_id, name, year, mass_g, recclass, discovery_method, latitude, longitude
    from meteorites
    where ${clauses.join(" and ")}
    limit 50000
  `;

  const rows = await query(sql, params);

  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
      properties: {
        nasa_id: r.nasa_id,
        name: r.name,
        year: r.year,
        mass_g: r.mass_g,
        recclass: r.recclass,
        discoveryMethod: r.discovery_method
      }
    }))
  };
}

/** Off-world finds, kept out of the map but worth surfacing in their own UI panel. Respects the same filters as the map (minus bbox, which is Earth-only). */
export async function getOffWorldFinds(filters: Omit<MeteoriteFilters, "bbox"> = {}) {
  const clauses: string[] = ["is_off_world"];
  const params: any[] = [];

  const push = (clause: string, value: any) => {
    params.push(value);
    clauses.push(clause.replace("$", `$${params.length}`));
  };

  if (filters.yearMin != null) push("year >= $", filters.yearMin);
  if (filters.yearMax != null) push("year <= $", filters.yearMax);
  if (filters.recclass) push("recclass = $", filters.recclass);
  if (filters.discoveryMethod) push("discovery_method = $", filters.discoveryMethod);
  if (filters.massMin != null) push("mass_g >= $", filters.massMin);
  if (filters.massMax != null) push("mass_g <= $", filters.massMax);

  const sql = `
    select nasa_id, name, year, mass_g, recclass, discovery_method, latitude, longitude
    from meteorites
    where ${clauses.join(" and ")}
    order by year
  `;
  return query(sql, params);
}

/**
 * Discovery Opportunity Score, per hex.
 *
 * expected = baseline_rate * pop_density^a * road_density_norm^b * preservation_factor
 * bias_score = ln(observed + 1) - ln(expected + 1)
 *
 * NOTE: a, b below are placeholders (0.3, 0.3) - calibrate against known
 * heavily-searched, low-population regions (Antarctica blue-ice fields,
 * Sahara, Nullarbor Plain/Australia) where observed >> population-predicted,
 * to make sure the score isn't just re-deriving "more roads -> more finds."
 * Treat as illustrative until calibrated; surface that caveat in the UI.
 */
export async function getHexagonBiasScores() {
  const sql = `
    select
      hex_id,
      meteorite_count,
      avg_population,
      avg_rainfall,
      road_density,
      meteorite_count::float /
        greatest(
          0.01 * power(coalesce(avg_population, 1) + 1, 0.3) * power(coalesce(road_density, 0.01) + 0.01, 0.3),
          0.001
        ) as raw_ratio,
      ln(meteorite_count + 1) -
        ln(0.01 * power(coalesce(avg_population, 1) + 1, 0.3) * power(coalesce(road_density, 0.01) + 0.01, 0.3) + 1)
        as bias_score,
      st_x(centroid) as lng,
      st_y(centroid) as lat
    from hex_aggregates
  `;
  return query(sql);
}

/* Unique recclass values for filter display */
export async function getDistinctRecclassValues(): Promise<string[]> {
  const rows = await query<{ recclass: string }>(
    `select distinct recclass from meteorites where recclass is not null order by recclass`
  );
  return rows.map((row) => row.recclass);
}

/* Min and max values for year */
export async function getYearRange(): Promise<{ min: number; max: number }> {
  const rows = await query<{ min: number; max: number }>(
    `select min(year) as min, max(year) as max from meteorites where year is not null`
  );
  return rows[0];
}
