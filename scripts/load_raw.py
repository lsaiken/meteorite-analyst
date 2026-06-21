"""
Loads the NASA Meteorite Landings CSV verbatim into raw.meteorite_landings —
no cleaning, no type casting, no filtering. All transformation logic lives in
dbt (see dbt/models/staging/stg_meteorites.sql) so it's versioned and testable
instead of buried in a one-off Python script.

Usage:
  pip install psycopg2-binary --break-system-packages
  export DATABASE_URL=postgresql://...   # Supabase pooler connection string
  python load_raw.py path/to/Meteorite_Landings.csv
"""

import os
import sys
import csv
import psycopg2

DATABASE_URL = os.environ["DATABASE_URL"]

# Maps the CSV's actual header names -> raw table column names.
COLUMN_MAP = {
    "name": "name",
    "id": "id",
    "nametype": "nametype",
    "recclass": "recclass",
    "mass (g)": "mass_g",
    "fall": "fall",
    "year": "year",
    "reclat": "reclat",
    "reclong": "reclong",
    "GeoLocation": "geolocation"
}


def main(csv_path: str):
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("truncate table raw.meteorite_landings")

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        csv_cols = reader.fieldnames or []
        missing = [c for c in COLUMN_MAP if c not in csv_cols]
        if missing:
            raise ValueError(f"CSV is missing expected columns: {missing}")

        db_cols = [COLUMN_MAP[c] for c in COLUMN_MAP]
        placeholders = ", ".join(["%s"] * len(db_cols))
        insert_sql = f"insert into raw.meteorite_landings ({', '.join(db_cols)}) values ({placeholders})"

        rows = [tuple(row[csv_col] for csv_col in COLUMN_MAP) for row in reader]

    cur.executemany(insert_sql, rows)
    conn.commit()
    print(f"Loaded {len(rows)} raw rows into raw.meteorite_landings.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python load_raw.py path/to/Meteorite_Landings.csv")
        sys.exit(1)
    main(sys.argv[1])
