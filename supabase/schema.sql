-- Run this in the Supabase SQL editor.

create extension if not exists postgis;

-- ============================================================
-- NOTE: the `meteorites` table is now owned by dbt.
-- ============================================================
-- Raw ingestion -> raw.meteorite_landings (see raw_schema.sql), then
-- `dbt run` builds public.meteorites (and public.meteorites_excluded) from
-- dbt/models/marts/meteorites.sql. Don't create or alter `meteorites` here -
-- run raw_schema.sql + scripts/load_raw.py + dbt instead. dbt's `table`
-- materialization recreates it on every run, so add a post-hook in
-- dbt_project.yml if you want indexes to persist automatically (see README):
--
-- create index if not exists meteorites_geom_idx on meteorites using gist (geom);
-- create index if not exists meteorites_year_idx on meteorites (year);
-- create index if not exists meteorites_recclass_idx on meteorites (recclass);

-- ============================================================
-- Supporting datasets (load later; AI tools handle missing data gracefully)
-- ============================================================
create table if not exists population_grid (
  id bigserial primary key,
  pop_density double precision,   -- people per km^2
  geom geometry(Polygon, 4326)
);
create index if not exists population_grid_geom_idx on population_grid using gist (geom);

create table if not exists climate (
  id bigserial primary key,
  annual_rainfall_mm double precision,
  mean_temp_c double precision,
  geom geometry(Polygon, 4326)
);
create index if not exists climate_geom_idx on climate using gist (geom);

create table if not exists land_cover (
  id bigserial primary key,
  class text,                      -- e.g. 'forest', 'desert', 'urban', 'ice'
  geom geometry(Polygon, 4326)
);
create index if not exists land_cover_geom_idx on land_cover using gist (geom);

create table if not exists roads (
  id bigserial primary key,
  road_class text,
  geom geometry(LineString, 4326)
);
create index if not exists roads_geom_idx on roads using gist (geom);

-- ============================================================
-- H3 hex aggregate cache (precomputed by a script for fast map rendering)
-- ============================================================
create table if not exists hex_aggregates (
  hex_id text primary key,
  resolution integer,
  meteorite_count integer default 0,
  avg_population double precision,
  avg_rainfall double precision,
  road_density double precision,
  expected_count double precision,
  bias_score double precision,
  centroid geometry(Point, 4326)
);
create index if not exists hex_aggregates_centroid_idx on hex_aggregates using gist (centroid);

-- ============================================================
-- RPC functions used by the AI tool layer (lib/aiTools.ts calls these
-- through Supabase's PostgREST RPC endpoint or directly via pg)
-- ============================================================

-- bbox = [minLng, minLat, maxLng, maxLat]
create or replace function get_meteorite_stats(min_lng float, min_lat float, max_lng float, max_lat float)
returns table (
  total_count bigint,
  fell_count bigint,
  found_count bigint,
  avg_mass_g double precision,
  median_mass_g double precision,
  earliest_year integer,
  latest_year integer,
  top_classes text[]
) as $$
  with region as (
    select * from meteorites
    where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
      and not is_off_world
  )
  select
    count(*),
    count(*) filter (where discovery_method = 'Fell'),
    count(*) filter (where discovery_method = 'Found'),
    avg(mass_g),
    percentile_cont(0.5) within group (order by mass_g),
    min(year),
    max(year),
    array_agg(distinct recclass) -- simplistic; fine for a first pass
  from region;
$$ language sql stable;

create or replace function get_population(min_lng float, min_lat float, max_lng float, max_lat float)
returns double precision as $$
  select avg(pop_density) from population_grid
  where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326);
$$ language sql stable;

create or replace function get_climate(min_lng float, min_lat float, max_lng float, max_lat float)
returns table (avg_rainfall_mm double precision, avg_temp_c double precision) as $$
  select avg(annual_rainfall_mm), avg(mean_temp_c) from climate
  where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326);
$$ language sql stable;

create or replace function get_dominant_land_cover(min_lng float, min_lat float, max_lng float, max_lat float)
returns text as $$
  select class from land_cover
  where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  group by class order by count(*) desc limit 1;
$$ language sql stable;

create or replace function get_road_density(min_lng float, min_lat float, max_lng float, max_lat float)
returns double precision as $$
  -- km of road per km^2 of the bbox (rough, uses st_length on degrees->meters cast via geography)
  select coalesce(sum(st_length(geom::geography)) / 1000.0, 0) /
         (st_area(st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography) / 1000000.0)
  from roads
  where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326);
$$ language sql stable;
