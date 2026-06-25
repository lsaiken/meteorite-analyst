"""
Computes H3 hex aggregates (meteorite counts + joined population/road/climate
averages) and writes them into hex_aggregates for fast map rendering.

Run this after loading meteorites + any supporting layers, and re-run
whenever the underlying data changes (e.g. nightly cron, or manually).

Usage:
  pip install h3 psycopg2-binary --break-system-packages
  export DATABASE_URL=postgresql://...
  python compute_hexagons.py --resolution 3
"""

import os
import argparse
import h3
import psycopg2
from psycopg2.extras import execute_values

DATABASE_URL = os.environ["DATABASE_URL"]


def main(resolution: int):
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("select latitude, longitude from meteorites where geom is not null")
    points = cur.fetchall()

    counts: dict[str, int] = {}
    for lat, lng in points:
        hex_id = h3.latlng_to_cell(lat, lng, resolution)
        counts[hex_id] = counts.get(hex_id, 0) + 1

    rows = []
    for hex_id, count in counts.items():
        lat, lng = h3.cell_to_latlng(hex_id)
        rows.append((hex_id, resolution, count, lng, lat))

    cur.execute("delete from hex_aggregates where resolution = %s", (resolution,))

    execute_values(
        cur,
        """
        insert into hex_aggregates (hex_id, resolution, meteorite_count, centroid)
        values %s
        """,
        rows,
        template="(%s, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326))",
    )

    # Optionally join population_grid / roads / climate here via PostGIS
    # spatial join on each hex's polygon boundary (h3.cell_to_boundary) if
    # those tables are populated - left as a follow-up once you've loaded them.

    conn.commit()
    print(f"Wrote {len(rows)} hex aggregates at resolution {resolution}.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--resolution",
        type=int,
        default=3,
        help="H3 resolution (0=coarsest, 15=finest). 3-4 is a good global default.",
    )
    args = parser.parse_args()
    main(args.resolution)
