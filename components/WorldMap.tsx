"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Map, { Source, Layer, MapRef } from "react-map-gl/maplibre";
import type { FilterState } from "./Filters";
import type { LayerState } from "./BiasLayerToggle";

interface Props {
  filters: FilterState;
  layers: LayerState;
  onRegionSelect: (bbox: [number, number, number, number]) => void;
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAPLIBRE_STYLE_URL || "https://demotiles.maplibre.org/style.json";

export default function WorldMap({ filters, layers, onRegionSelect }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [geojson, setGeojson] = useState<any>({ type: "FeatureCollection", features: [] });
  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [dragRect, setDragRect] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.yearMin != null) params.set("yearMin", String(filters.yearMin));
    if (filters.yearMax != null) params.set("yearMax", String(filters.yearMax));
    if (filters.recclass) params.set("recclass", filters.recclass);
    if (filters.discoveryMethod) params.set("discoveryMethod", filters.discoveryMethod);
    if (filters.massMin != null) params.set("massMin", String(filters.massMin));
    if (filters.massMax != null) params.set("massMax", String(filters.massMax));

    fetch(`/api/meteorites?${params.toString()}`)
      .then((r) => r.json())
      .then(setGeojson)
      .catch(() => {});
  }, [filters]);

  // Shift+drag to draw a selection rectangle -> bbox sent to /api/explain
  const onMouseDown = useCallback((e: any) => {
    if (!e.originalEvent.shiftKey) return;
    setDragStart([e.lngLat.lng, e.lngLat.lat]);
  }, []);

  const onMouseMove = useCallback(
    (e: any) => {
      if (!dragStart) return;
      const [lng0, lat0] = dragStart;
      setDragRect([
        Math.min(lng0, e.lngLat.lng),
        Math.min(lat0, e.lngLat.lat),
        Math.max(lng0, e.lngLat.lng),
        Math.max(lat0, e.lngLat.lat)
      ]);
    },
    [dragStart]
  );

  const onMouseUp = useCallback(() => {
    if (dragRect) onRegionSelect(dragRect);
    setDragStart(null);
  }, [dragRect, onRegionSelect]);

  const dragRectGeoJSON = dragRect
    ? {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [dragRect[0], dragRect[1]],
              [dragRect[2], dragRect[1]],
              [dragRect[2], dragRect[3]],
              [dragRect[0], dragRect[3]],
              [dragRect[0], dragRect[1]]
            ]
          ]
        },
        properties: {}
      }
    : null;

  return (
    <>
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1, fontSize: 12, color: "#8b9bb0", background: "#0e1318cc", padding: "6px 10px", borderRadius: 6 }}>
        Shift-drag to select a region for "Explain This Pattern"
      </div>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.6 }}
        mapStyle={STYLE_URL}
        style={{ width: "100%", height: "100%" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <Source id="meteorites" type="geojson" data={geojson} cluster={true} clusterRadius={40} clusterMaxZoom={8}>
          <Layer
            id="meteorite-clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": "#4d7cff",
              "circle-opacity": 0.65,
              "circle-radius": ["step", ["get", "point_count"], 12, 50, 18, 200, 26]
            }}
          />
          <Layer
            id="meteorite-points"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": ["match", ["get", "discoveryMethod"], "Fell", "#ff6a6a", "#6ee7a8"],
              "circle-radius": 3,
              "circle-opacity": 0.8
            }}
          />
        </Source>

        {/* Bias layer placeholders - wired up once supporting tables are loaded.
            Each toggle here would add a Source/Layer pulling from a
            /api/layers/{population|roads|climate|landcover} endpoint. */}
        {layers.population && (
          <div style={{ display: "none" }} data-layer="population-placeholder" />
        )}

        {dragRectGeoJSON && (
          <Source id="drag-rect" type="geojson" data={dragRectGeoJSON}>
            <Layer
              id="drag-rect-fill"
              type="fill"
              paint={{ "fill-color": "#4d7cff", "fill-opacity": 0.15 }}
            />
            <Layer
              id="drag-rect-line"
              type="line"
              paint={{ "line-color": "#4d7cff", "line-width": 2 }}
            />
          </Source>
        )}
      </Map>
    </>
  );
}
