-- Marts: the analysis-ready meteorites table. This is what the app/AI tools
-- query. Drops rows with no usable coordinates at all. Off-world finds
-- (currently just Meridiani Planum, found on Mars by the Opportunity rover)
-- are KEPT but flagged via is_off_world — their longitude (354.47) uses a
-- different convention than Earth coordinates, so PostGIS geometry isn't
-- meaningful for them and the app excludes them from map/geom queries by
-- default while still surfacing them in stats and a dedicated UI panel.

select
    nasa_id,
    name,
    nametype,
    is_relict,
    recclass,
    mass_g,
    discovery_method,
    year,
    reclat as latitude,
    reclong as longitude,
    is_off_world,
    case
        when not is_off_world then st_setsrid(st_makepoint(reclong, reclat), 4326)
    end as geom
from {{ ref('stg_meteorites') }}
where not is_missing_location
