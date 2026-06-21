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
  const [selecting, setSelecting] = useState(false);
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

  // Selection is an explicit toggle (button below) rather than shift+drag -
  // shift+drag collides with MapLibre's own built-in box-zoom interaction,
  // which made the old gesture feel unreliable. dragPan is disabled on the
  // <Map> itself while selecting (see below) so a plain click-drag draws a
  // rectangle instead of panning.
  const onMouseDown = useCallback(
    (e: any) => {
      if (!selecting) return;
      setDragStart([e.lngLat.lng, e.lngLat.lat]);
    },
    [selecting]
  );

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
    if (dragRect) {
      onRegionSelect(dragRect);
      setSelecting(false); // auto-exit selection mode once a region is drawn
    }
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
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <button
          onClick={() => {
            setSelecting((s) => !s);
            setDragRect(null);
            setDragStart(null);
          }}
          style={{
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: 6,
            border: selecting ? "1px solid #4d7cff" : "1px solid #2a3441",
            background: selecting ? "#4d7cff" : "#0e1318cc",
            color: selecting ? "white" : "#e6edf3",
            cursor: "pointer",
            fontWeight: selecting ? 600 : 400
          }}
        >
          {selecting ? "Click and drag to draw a region…" : "📍 Select Region"}
        </button>
        {selecting && (
          <span style={{ fontSize: 12, color: "#8b9bb0", background: "#0e1318cc", padding: "6px 10px", borderRadius: 6 }}>
            Map panning is disabled while selecting
          </span>
        )}
      </div>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.6 }}
        mapStyle={STYLE_URL}
        style={{ width: "100%", height: "100%", cursor: selecting ? "crosshair" : undefined }}
        // Disable MapLibre's own shift+drag box-zoom - it listens for the same
        // gesture we used to use and was fighting with our handlers.
        boxZoom={false}
        // Disable panning while in selection mode so a plain drag draws a
        // rectangle instead of moving the map.
        dragPan={!selecting}
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
