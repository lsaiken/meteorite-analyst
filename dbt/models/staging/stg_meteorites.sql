-- Staging: casts raw text columns to real types and flags data-quality
-- issues. Deliberately does NOT drop any rows — staging should be lossless
-- and 1:1 with the source so you can always audit what got excluded and why.
-- Filtering happens downstream in marts/meteorites.sql.

with source as (
    select * from {{ source('raw', 'meteorite_landings') }}
),

casted as (
    select
        trim(name)                                   as name,
        -- NASA ids are normally integer-clean; nullify anything that isn't
        -- rather than letting a bad row break the whole load
        case when id ~ '^\d+$' then id::bigint end    as nasa_id,
        nametype,
        recclass,
        case when mass_g ~ '^[0-9.]+$' then mass_g::double precision end as mass_g_raw,
        -- Renamed from the source's `fall` column: clearer for analysts and
        -- the AI tool layer than the NASA-jargon original ("Fell" = witnessed
        -- fall, "Found" = discovered after the fact with no witnessed fall).
        fall as discovery_method,
        case when year ~ '^\d+(\.\d+)?$' then year::double precision::int end as year_raw,
        case when reclat ~ '^-?\d+(\.\d+)?$' then reclat::double precision end as reclat_raw,
        case when reclong ~ '^-?\d+(\.\d+)?$' then reclong::double precision end as reclong_raw,
        geolocation
    from source
),

flagged as (
    select
        *,

        -- Mass: NASA encodes some unknown/invalid masses as 0 or blank.
        -- Treat non-positive as null rather than a real zero-mass meteorite.
        case when mass_g_raw > 0 then mass_g_raw end as mass_g,

        -- Year: dataset has at least one clearly bad future year
        -- (e.g. 2101). Null out anything beyond the current year or before
        -- meteorite record-keeping plausibly began (~860 AD, oldest valid
        -- record in this dataset).
        case
            when year_raw between 860 and extract(year from current_date)::int
                then year_raw
        end as year,

        -- Location: NASA uses exactly (0, 0) as a placeholder for "no
        -- coordinates recorded" -- not an actual location in the Gulf of
        -- Guinea. Treat as missing.
        case when not (reclat_raw = 0 and reclong_raw = 0) then reclat_raw end as reclat,
        case when not (reclat_raw = 0 and reclong_raw = 0) then reclong_raw end as reclong,

        -- Flag rows with no usable coordinates at all
        (reclat_raw is null or reclong_raw is null) as is_missing_location,

        (reclat_raw = 0 and reclong_raw = 0) as is_zero_placeholder,

        -- Meridiani Planum (nasa_id 32789) was found on Mars by the
        -- Opportunity rover -- reclong of 354.47 isn't a bad value, it's a
        -- real off-world coordinate that breaks Earth-based PostGIS geometry.
        (reclong_raw > 180 or reclong_raw < -180) as is_off_world,

        (nametype = 'Relict') as is_relict

    from casted
)

select
    nasa_id,
    name,
    nametype,
    is_relict,
    recclass,
    mass_g,
    (mass_g_raw is not null and mass_g_raw <= 0) as had_invalid_mass,
    discovery_method,
    year,
    (year_raw is not null and year is null) as had_invalid_year,
    reclat,
    reclong,
    is_missing_location,
    is_zero_placeholder,
    is_off_world,
    geolocation
from flagged
