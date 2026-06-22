# Meteorite AI Analyst — Technical Design Document

## 1. Overview

This document describes the technical architecture of the Meteorite AI
Analyst: a conversational BI tool over NASA's Meteorite Landings dataset,
built as a single Next.js application deployed on Vercel, with Postgres/
PostGIS (Supabase) for storage, dbt for data transformation, and Claude
(via tool calling) as the agentic reasoning layer behind "Explain This
Pattern."

The guiding design principle throughout: **keep the surface area small
enough for one person to operate, while keeping every transformation step
auditable** — because the dataset itself turned out to have exactly the
kind of silent data-quality issues (placeholder coordinates, a non-Earth
meteorite, inconsistent years) that this tool exists to help users reason
about. The architecture treats "trustworthy data" as a feature, not an
implementation detail.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Vercel (single deploy)                  │
│                                                                   │
│  Next.js App Router                                              │
│  ├── app/page.tsx              UI shell (map + sidebar)          │
│  ├── components/                                                 │
│  │     WorldMap.tsx            MapLibre GL JS + region select    │
│  │     Filters.tsx             year/class/mass/discovery method  │
│  │     BiasLayerToggle.tsx     population/roads/climate/landcover│
│  │     Insights.tsx            renders AI explanation + chips    │
│  │     OffWorldPanel.tsx       Mars meteorite, surfaced honestly │
│  │                                                                │
│  └── app/api/  (serverless functions, Node runtime)              │
│        /meteorites    -> filtered GeoJSON for the map            │
│        /off-world     -> off-Earth finds, same filters            │
│        /hexagons      -> precomputed H3 bias scores               │
│        /recclasses    -> distinct classes (dropdown/datalist)     │
│        /year-range    -> min/max year (input bounds)              │
│        /explain       -> agentic Claude loop (tool calling)       │
└─────────────────────┬─────────────────────────────────────────────┘
                       │ pg (node-postgres), pooled connection
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase (Postgres + PostGIS)                │
│                                                                   │
│  raw.meteorite_landings        verbatim CSV load, all text       │
│         │  dbt run                                               │
│         ▼                                                        │
│  staging.stg_meteorites        typed, flagged, lossless           │
│         │                                                         │
│         ▼                                                        │
│  public.meteorites             clean, analysis-ready (app reads)  │
│  public.meteorites_excluded    audit trail of dropped rows        │
│  public.hex_aggregates         precomputed H3 bias scores         │
│  population_grid / climate /                                      │
│  land_cover / roads            supporting bias-layer tables       │
└─────────────────────────────────────────────────────────────────┘
```

Everything — frontend, API, and the agentic AI logic — ships from one
repository and one Vercel project. Data transformation lives in a separate
dbt project that targets the same Postgres instance, run independently of
app deploys.

---

## 3. Technology choices and rationale

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **Next.js (App Router)** | Co-locates UI and API routes in one deployable unit; first-class Vercel support; React ecosystem for the map/chart libraries needed. |
| API layer | **Next.js API routes**, not a separate FastAPI service | The actual workload is I/O-bound — parameterized SQL and LLM tool calls — not numerical computation. One language, one deploy, one set of env vars. See §3.1 for the tradeoff and when this would flip. |
| Map rendering | **MapLibre GL JS** (via `react-map-gl`) | Open-source, no vendor API key required to ship a working demo (falls back to free demo tiles), but swaps cleanly to MapTiler/Mapbox by changing one env var since both speak the same style-JSON format. |
| Database | **PostgreSQL + PostGIS**, hosted on **Supabase** | PostGIS is the only realistic choice for spatial joins, radius search, and bbox queries at this scale. Supabase bundles Postgres + PostGIS + a managed connection pooler (Supavisor) + auth/storage if needed later, without managing infrastructure directly. |
| Data transformation | **dbt** | Raw CSV ingestion is dumb on purpose (everything loaded as `text`); all cleaning/casting/flagging logic lives in version-controlled, tested SQL instead of a one-off Python script. See §4. |
| AI reasoning | **Claude, via the Anthropic SDK with tool calling**, not a single fixed prompt | "Explain This Pattern" needs to ground its answer in whatever data is actually available for a region — population here, road density there — which varies by what's been loaded. An agentic loop lets the model decide which tools to call rather than us hand-coding every combination. See §5. |
| Geospatial indexing | **H3** (hexagonal hierarchical index) | Rendering 30k+ raw points doesn't scale in the browser; H3 hex aggregation gives a fixed, fast grid for both map rendering and the bias-score calculation, computed offline rather than per-request. |
| Deployment | **Vercel** | Matches the Next.js-first architecture; serverless functions for API routes; environment variables scoped per environment (Production/Preview/Development). |

### 3.1 Why not a separate Python/FastAPI backend

The original plan for this project specified a Python/FastAPI backend
alongside a Next.js frontend. That was deliberately collapsed into one
Next.js project because:

- Every API route here is "run parameterized SQL, return JSON" or "call an
  LLM with tools" — neither needs Python's numerical/geospatial stack
  (GeoPandas, Shapely, rasterio) *at request time*. Those libraries are
  used instead in the offline data-loading scripts (`scripts/`), where
  Python's geo ecosystem is genuinely better than anything in JS.
- One deployable unit means one build pipeline, one set of preview deploys
  per PR, no CORS configuration between two origins.
- Touching both "ends" of a change (e.g. renaming a column) stays inside
  one language and one PR instead of coordinating a schema change across
  two codebases.

This would flip back toward a separate Python service if the request path
itself needed real geospatial computation (live GeoPandas joins, raster
sampling) rather than querying precomputed PostGIS results — or if batch
jobs (nightly bias-score recomputation across millions of rows) grew heavy
enough to warrant an independent worker regardless of what serves the API.

---

## 4. Data pipeline design

### 4.1 Raw / staging / marts separation

```
CSV  ->  load_raw.py (verbatim)  ->  raw.meteorite_landings (all columns as text)
                                          |  dbt run
                                          v
                                  stg_meteorites (view)
                                  - casts types
                                  - flags data-quality issues
                                  - drops NOTHING (lossless)
                                          |
                                          v
                                  meteorites (table)        meteorites_excluded (table)
                                  - what the app queries     - audit trail of dropped rows
```

**Why this shape, specifically:**

- **Raw ingestion is dumb on purpose.** `load_raw.py` does a straight
  `TRUNCATE` + bulk insert (`execute_values`, batched — not row-by-row
  `executemany`, which would take 15-75+ minutes over a pooled connection
  for this row count instead of under a minute). No cleaning logic lives
  here, so a malformed row never blocks the load.
- **Staging is lossless.** `stg_meteorites.sql` casts types and *flags*
  problems — non-positive mass, implausible years, the `(0,0)` placeholder
  coordinate convention NASA uses for "unknown location," the one
  Mars-surface meteorite (Meridiani Planum, whose longitude of 354°
  legitimately falls outside Earth's ±180° convention) — but drops
  nothing. Every row in the raw table has a corresponding row here,
  auditable.
- **Marts is where filtering actually happens**, and only for rows with no
  usable coordinates at all. Off-world finds are *kept*, flagged via
  `is_off_world`, given a null `geom` (PostGIS geometry isn't meaningful
  for a non-Earth coordinate), and surfaced in their own UI panel instead
  of being silently dropped or plotted somewhere nonsensical.
- **`meteorites_excluded` exists so "why doesn't this count match the raw
  CSV" always has a SQL answer**, not a buried assumption in a script.

### 4.2 Testing

`dbt test` enforces, via `dbt_utils`, that `nasa_id` is unique and
non-null, `discovery_method` only takes `Fell`/`Found`, mass is positive
where present, and year/lat/lng fall within sane ranges — with the
longitude range test explicitly scoped to `where: not is_off_world`, since
the one legitimate exception should not be treated as a data-quality
failure.

### 4.3 Known schema-naming pitfall (documented for future maintainers)

dbt's default schema-naming macro concatenates `{target.schema}_{custom
schema}`. Setting `+schema: public` in `dbt_project.yml` while the
`profiles.yml` target schema is *also* `public` produces a literal
`public_public` schema — not a bug in dbt, but an easy footgun. The fix is
to leave `+schema` unset for models that should land directly in the
target schema, and only set it where a genuinely different schema name is
intended (e.g. `staging` -> `public_staging`).

---

## 5. AI design: agentic tool calling, not a fixed prompt

`/api/explain` does not send a single prompt with a pre-baked JSON
summary. Instead, `lib/aiTools.ts` defines a small set of tools — region
meteorite stats, population, climate, dominant land cover, road density,
and a "compare to a reference region" tool — and `app/api/explain/route.ts`
runs an agentic loop (up to 6 turns) where Claude decides which tools to
call, in what order, and whether to call a second tool after seeing the
first result.

**Why this over a fixed prompt + JSON blob:**

- Quality scales with the data available. A region with only meteorite
  counts loaded gets a narrower answer; a region with population, climate,
  and road data loaded gets a richer one — without any prompt engineering
  change, because the model just has more tools that return real data
  instead of `{ available: false }`.
- Tools degrade gracefully. Each one reports `{ available: false, reason }`
  if its backing table is empty, so the model can say "I don't have road
  data for this region" instead of hallucinating a number.
- The system prompt explicitly asks the model to distinguish factors
  supported by retrieved data from plausible-but-unconfirmed hypotheses,
  and to end with confidence-labeled chips the UI renders directly — this
  matters more for an agentic flow than a fixed prompt, since the model is
  assembling the argument from whatever it found rather than filling in a
  template.

**Resilience:** the Anthropic client is configured with `fetch:
globalThis.fetch` explicitly (avoiding a known intermittent
`ERR_STREAM_PREMATURE_CLOSE` bug in the `node-fetch` package that
Next.js's route-handler bundling can pull in instead of native fetch) and
`maxRetries: 4`, with the whole loop wrapped in try/catch so a transient
network failure returns a readable `502` instead of an unhandled 500.

---

## 6. Frontend design notes

- **Region selection** is an explicit toggle ("Select Region" button), not
  a shift-drag gesture. MapLibre's own built-in box-zoom interaction also
  listens for shift+drag by default, which fought with a hand-rolled
  selection handler using the same gesture. The toggle disables `dragPan`
  while active and disables MapLibre's `boxZoom` permanently, removing the
  conflict rather than working around it.
- **Filter inputs are bounded by real data, not guessed ranges.** Year
  min/max default to the dataset's actual min/max (fetched from
  `/api/year-range`) and are clamped on blur — `Math.min(Math.max(raw,
  min), max)` — rather than just decorating the input with HTML `min`/
  `max` attributes, which only flag invalid values without preventing
  them.
- **The Class filter uses a text input + `<datalist>`, not a `<select>`.**
  With 466 distinct `recclass` values, a plain dropdown is an unwieldy
  scroll list; a datalist lets people type to narrow down while still
  surfacing valid options.

---

## 7. Deployment notes specific to this stack

- **API routes that take no request parameters must be marked
  `export const dynamic = "force-dynamic"`.** Next.js otherwise infers a
  parameterless `GET()` is static and tries to prerender it at build
  time — before `DATABASE_URL` exists in that phase — which surfaces as
  `ECONNREFUSED 127.0.0.1:5432` (pg's default fallback host) rather than a
  more obvious "env var missing" error.
- **The Supabase pooler requires the `postgres.<project-ref>` username
  format**, not plain `postgres` — that's only valid for the direct
  (non-pooled) connection, which doesn't work from serverless functions on
  the free tier (IPv6-only).
- **`lib/db.ts` resolves the connection string with a fallback chain**:
  `DATABASE_URL` -> `POSTGRES_URL` -> `POSTGRES_URL_NON_POOLING`. This lets
  the app work whether the connection string was wired up manually or via
  the Supabase <-> Vercel marketplace integration (which auto-syncs its
  own `POSTGRES_URL`-prefixed variables) without needing to keep both in
  sync by hand.
- **`sslmode` is stripped from the connection string before use**, since
  SSL is configured explicitly via the `ssl` option — a leftover
  `sslmode=require` in an integration-provided URL otherwise triggers a
  `pg-connection-string` deprecation warning about future semantic changes
  to that mode.

---

## 8. Deliberately out of scope (for now)

- **Discovery Opportunity Score calibration.** The current formula
  (`expected = baseline_rate x population_density^a x accessibility^b x
  preservation_factor^c`) uses placeholder exponents. It's flagged in the
  UI and docs as illustrative, not a rigorous causal estimate, until it's
  calibrated against regions with known dense search history (Antarctic
  blue-ice fields, the Nullarbor Plain) as anchors — without that step, the
  score risks circularly re-deriving "more roads -> more finds."
- **Supporting bias-layer loaders** (population, roads, climate, land
  cover) are documented loading patterns, not finished pipelines — the
  right raster resolution is a real decision (global WorldPop alone is
  gigabytes) rather than a default to load blindly.
- **Country-level grouping** isn't available since the raw NASA export has
  no `country` column; would require a reverse-geocoding join against a
  Natural Earth countries polygon table.
