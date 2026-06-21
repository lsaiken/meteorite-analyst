-- Keeps a visible record of every row excluded from marts.meteorites and
-- why. Off-world finds are no longer excluded here (see meteorites.sql) -
-- they're kept and flagged with is_off_world instead, so this table now only
-- covers rows with no usable coordinates at all.

select
    nasa_id,
    name,
    case
        when is_zero_placeholder then 'zero_placeholder_coordinates'
        else 'missing_location'
    end as exclusion_reason
from {{ ref('stg_meteorites') }}
where is_missing_location