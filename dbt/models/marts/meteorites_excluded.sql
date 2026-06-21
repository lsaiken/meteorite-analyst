-- Keeps a visible record of every row excluded from marts.meteorites and
-- why. Off-world finds are no longer excluded here (see meteorites.sql) -
-- they're kept and flagged with is_off_world instead, so this table now only
-- covers rows with no usable coordinates at all.

select
    nasa_id,
    name,
    'missing_location' as exclusion_reason
from {{ ref('stg_meteorites') }}
where is_missing_location
