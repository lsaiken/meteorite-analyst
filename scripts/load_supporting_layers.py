"""
Stubs for loading the supporting bias-layer datasets. Each is independent —
load whichever you have time for; the AI tool layer (lib/aiTools.ts) reports
"not available" for any table that's empty, so the app works without all four.

Suggested sources:
  - Population: WorldPop (https://www.worldpop.org) or NASA SEDAC GPWv4
  - Roads: OpenStreetMap via `osmnx` (osmnx.graph_from_place / features_from_bbox)
  - Climate: WorldClim (https://www.worldclim.org) rainfall + temperature rasters
  - Land cover: ESA WorldCover (https://esa-worldcover.org)

Common pattern: rasters (population, climate, land cover) get converted to a
grid of polygons with GeoPandas, then bulk-loaded with the same execute_values
approach as load_meteorites.py. Roads (vector line data) load more directly.

This file intentionally contains the loading pattern but not a finished,
runnable pipeline for each — the right raster resolution / road network size
depends on how granular you want the bias analysis, which is worth deciding
deliberately rather than defaulting to "load everything at full resolution"
(WorldPop alone is gigabytes globally).
"""

import os
import geopandas as gpd
import psycopg2
from psycopg2.extras import execute_values

DATABASE_URL = os.environ["DATABASE_URL"]


def load_polygon_grid(table: str, value_col: str, gdf: gpd.GeoDataFrame):
    """Generic loader: gdf must have geometry + value_col, in EPSG:4326."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    rows = [(row[value_col], row.geometry.wkt) for _, row in gdf.iterrows()]

    execute_values(
        cur,
        f"""
        insert into {table} ({value_col}, geom)
        values %s
        """,
        rows,
        template=f"(%s, st_geomfromtext(%s, 4326))",
    )

    conn.commit()
    print(f"Loaded {len(rows)} rows into {table}.")
    cur.close()
    conn.close()


def load_population(geotiff_path: str, grid_size_deg: float = 0.5):
    """
    Resample a WorldPop GeoTIFF to a coarse grid (grid_size_deg degrees per
    cell — 0.5 deg ~= 55km at the equator, adjust to taste) and load into
    population_grid. Use rasterio + rasterstats for the zonal aggregation.
    """
    raise NotImplementedError(
        "Implement with rasterio/rasterstats: build a grid of polygons at "
        "grid_size_deg resolution, compute mean pop_density per cell via "
        "rasterstats.zonal_stats, then call load_polygon_grid('population_grid', "
        "'pop_density', gdf)."
    )


def load_roads(osm_place_or_bbox):
    """
    Use osmnx to pull a road network and bulk-insert LineStrings into `roads`.
    For global coverage this needs to run per-country/region to stay tractable.
    """
    raise NotImplementedError(
        "Implement with osmnx.features_from_bbox(..., tags={'highway': True}) "
        "per region, then bulk insert geometries into the roads table."
    )


def load_climate(
    worldclim_rainfall_tif: str, worldclim_temp_tif: str, grid_size_deg: float = 0.5
):
    raise NotImplementedError(
        "Same pattern as load_population but with two raster bands "
        "(rainfall, temperature) aggregated into the climate table."
    )


def load_land_cover(esa_worldcover_tif: str, grid_size_deg: float = 0.1):
    raise NotImplementedError(
        "Same pattern, but takes the MODE (most common class) per cell "
        "instead of the mean, since land cover is categorical."
    )
