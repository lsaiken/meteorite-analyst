# Meteorite AI Analyst

Conversational BI tool for NASA's meteorite landings dataset. Map + bias layers +
an LLM that can query Postgres/PostGIS itself to explain spatial patterns.

## Stack

- **Frontend**: Next.js 14 (App Router), MapLibre GL JS, deck.gl (for hex layer)
- **Backend**: Next.js API routes (Vercel Functions)
- **DB**: Supabase Postgres + PostGIS
- **AI**: Anthropic API with **tool calling** — the model decides which SQL/RPC
  tools to call (population in radius, meteorite counts, climate lookup, etc.)
  and synthesizes an explanation from the results, rather than us pre-baking a
  fixed JSON summary.

## 1. Create the Supabase project

1. Go to supabase.com → New Project.
2. In the SQL Editor, run `supabase/schema.sql` (creates tables, PostGIS
   extension, indexes, and the RPC functions the AI tools call).
3. Settings → Database → copy the connection string (use the **pooler**
   connection string for serverless) into `DATABASE_URL`.
4. Settings → API → copy `Project URL` and `anon public key`.

## 2. Load and transform the NASA data (raw -> dbt -> clean)

Architecture: **raw ingestion is dumb, all cleaning logic lives in dbt SQL.**

```
Meteorite_Landings.csv
   -> scripts/load_raw.py (verbatim load, no transforms)
   -> raw.meteorite_landings (everything as text)
   -> dbt run
        -> stg_meteorites (casts types, flags issues, drops nothing)
        -> meteorites (analysis-ready table the app queries)
        -> meteorites_excluded (audit trail of dropped rows + why)
```

**Step 1 — create the raw table:**
Run `supabase/raw_schema.sql` in the Supabase SQL editor.

**Step 2 — load the CSV verbatim:**
```bash
cd scripts
pip install psycopg2-binary --break-system-packages
export DATABASE_URL=...   # Supabase pooler connection string
python load_raw.py /path/to/Meteorite_Landings.csv
```

**Step 3 — run dbt:**
```bash
cd dbt
pip install dbt-postgres --break-system-packages
cp profiles.yml.example ~/.dbt/profiles.yml   # fill in your Supabase details
export SUPABASE_DB_PASSWORD=...
dbt deps     # installs dbt_utils for range tests
dbt run      # builds stg_meteorites (view) + meteorites, meteorites_excluded (tables)
dbt test     # runs schema tests (uniqueness, accepted ranges, etc.)
```

`dbt run` is what you re-run any time the raw data changes — it's idempotent
and rebuilds `meteorites` from scratch each time.

**What gets cleaned, and where to look:**
- `dbt/models/staging/stg_meteorites.sql` — type casting + flagging (lossless,
  drops nothing): nulls out non-positive mass, nulls out implausible years
  (e.g. a row with year 2101), treats NASA's `(0,0)` placeholder coordinates
  as missing rather than real locations, flags the one Mars-surface
  meteorite (Meridiani Planum, found by the Opportunity rover — its
  longitude of 354° isn't bad data, it's a non-Earth coordinate convention),
  and flags `nametype = 'Relict'` records (suspected but unconfirmed).
- `dbt/models/marts/meteorites.sql` — the clean, analysis-ready table the
  app's `lib/queries.ts` queries directly. Drops only rows with no usable
  coordinates at all. Off-world finds are **kept**, flagged via
  `is_off_world`, and given a null `geom` (their lat/lng don't use Earth's
  coordinate system, so PostGIS geometry isn't meaningful for them).
- `dbt/models/marts/meteorites_excluded.sql` — rows dropped for missing
  location, plus why, so "why doesn't this count match the raw CSV" always
  has a SQL answer.

**Off-world finds in the app:** `getMeteoritesGeoJSON` always filters
`not is_off_world`, so they never render on the map or skew bbox-based AI
stats (`get_meteorite_stats` excludes them too). They're surfaced instead via
a dedicated `/api/off-world` route and `components/OffWorldPanel.tsx`, a
small sidebar panel ("🛰️ Off-World Finds") that lists them separately with an
explanation, rather than being silently dropped or awkwardly plotted at a
meaningless Earth coordinate.

There's no `country` column in the raw NASA export — if you want
country-level grouping for the bias analysis, add a marts model that
reverse-geocodes `(latitude, longitude)` against a Natural Earth countries
polygon table via `ST_Contains`.

Optional supporting datasets (population, roads, climate, land cover) — see
`scripts/load_supporting_layers.py`. The app works without them; the AI
tools just report "not available" until those tables are loaded.

Lastly, build the H3 hex aggregates the map uses for fast rendering:
```bash
cd scripts
pip install h3 --break-system-packages
python compute_hexagons.py --resolution 3
```

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
DATABASE_URL=postgresql://...           # Supabase pooler connection string
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_MAPLIBRE_STYLE_URL=https://demotiles.maplibre.org/style.json
```

(MapLibre's demo style is free/no-key; swap for Mapbox/MapTiler if you want
nicer basemaps — just add the token.)

## 4. Run locally

```bash
npm install
npm run dev
```

## 5. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Add the same env vars in the Vercel dashboard (Project → Settings →
Environment Variables). PostGIS stays in Supabase; Vercel only hosts the
Next.js app + serverless functions.

## How "Explain This Pattern" works

1. User draws/selects a region (or clicks a hex cell) on the map.
2. Frontend POSTs `{ bbox or hexIds, question }` to `/api/explain`.
3. `/api/explain` opens an agentic loop with the Anthropic API, giving Claude
   tools defined in `lib/aiTools.ts`:
   - `get_meteorite_stats(bbox)` — count, mass distribution, fall vs found
   - `get_population(bbox)` — avg population density in region
   - `get_climate(bbox)` — avg rainfall/temperature
   - `get_land_cover(bbox)` — dominant land cover class
   - `get_road_density(bbox)` — road km per km²
   - `compare_to_similar_regions(bbox)` — same stats for regions with similar
     climate/population, elsewhere, for contrast
4. Claude calls whichever tools it needs (it may call several, or ask a
   follow-up tool after seeing the first result), then returns a final
   natural-language explanation plus a structured `confidence` and
   `cited_factors` field we render as chips/charts in the sidebar.
5. The route streams the final answer back to `Insights.tsx`.

This is intentionally agentic rather than a fixed prompt+JSON-blob, so the
quality of explanations scales as you add more supporting datasets — Claude
just gets more tools, no prompt engineering required.

## Project structure

```
app/
  page.tsx                 - main map + sidebar layout
  api/explain/route.ts     - agentic AI explanation endpoint
  api/meteorites/route.ts  - filtered meteorite GeoJSON for the map
  api/hexagons/route.ts    - H3 hex aggregates (counts, bias score) for fast render
components/
  WorldMap.tsx             - MapLibre + deck.gl hex layer, region selection
  Filters.tsx              - year/type/mass/fall-found filters
  BiasLayerToggle.tsx       - toggles population/roads/climate/land-cover overlays
  Insights.tsx             - renders AI explanation + confidence + charts
lib/
  db.ts                    - pg Pool connection
  queries.ts               - raw SQL helpers (spatial joins, hex aggregation)
  aiTools.ts               - tool definitions + dispatcher for Claude tool calls
  h3.ts                    - lat/lng <-> hex helpers
supabase/
  raw_schema.sql            - raw.meteorite_landings landing table
  schema.sql                - PostGIS extension, supporting tables, RPC functions
dbt/
  models/staging/stg_meteorites.sql   - type casting + data-quality flags (lossless)
  models/marts/meteorites.sql         - clean analysis-ready table the app queries
  models/marts/meteorites_excluded.sql - audit trail of dropped rows + why
scripts/
  load_raw.py               - verbatim CSV -> raw.meteorite_landings
  compute_hexagons.py       - H3 hex aggregation for fast map rendering
  load_supporting_layers.py - stubs for population/roads/climate/landcover
```

## Discovery Opportunity Score

Implemented in `lib/queries.ts::getHexagonBiasScores`:

```
expected = baseline_rate * population_density^a * accessibility^b * preservation_factor^c
bias_score = log(observed_count + 1) - log(expected + 1)
```

The exponents (`a, b, c`) are fit (or just guessed initially — see comment in
the file) against regions with well-known dense search history (Antarctica,
the Sahara, Australian deserts) as calibration anchors, since those are known
to be *over*-observed relative to population — useful for sanity-checking the
model before trusting it elsewhere. Treat this score as illustrative, not a
rigorous causal estimate, and say so in the UI — it's easy to make it just
re-derive "fewer roads → fewer meteorites" circularly. Worth flagging this
caveat to users in the product copy.
