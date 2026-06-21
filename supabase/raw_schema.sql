-- The "raw" landing zone. Mirrors the NASA CSV columns 1:1, with permissive
-- types, so loading never fails on bad data. All cleaning happens downstream
-- in dbt (models/staging/stg_meteorites.sql) — never edit this table by hand,
-- and never add transformations here.

create schema if not exists raw;

create table if not exists raw.meteorite_landings (
  name        text,
  id          text,        -- text on purpose: don't assume it's always int-clean
  nametype    text,
  recclass    text,
  mass_g      text,        -- text: raw CSV header is "mass (g)", may contain blanks
  fall        text,
  year        text,        -- text: raw years can be malformed, dbt casts safely
  reclat      text,
  reclong     text,
  geolocation text,
  _loaded_at  timestamptz default now()
);
