"use client";

export interface LayerState {
  population: boolean;
  roads: boolean;
  climate: boolean;
  landCover: boolean;
}

const LABELS: { key: keyof LayerState; label: string }[] = [
  { key: "population", label: "Population density" },
  { key: "roads", label: "Roads" },
  { key: "climate", label: "Climate (rainfall)" },
  { key: "landCover", label: "Land cover" }
];

export default function BiasLayerToggle({
  value,
  onChange
}: {
  value: LayerState;
  onChange: (v: LayerState) => void;
}) {
  return (
    <div>
      {LABELS.map(({ key, label }) => (
        <div className="layer-toggle-row" key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          <span>{label}</span>
        </div>
      ))}
      <p style={{ fontSize: 11, color: "#6b7787", marginTop: 8 }}>
        Layers render once the matching table (population_grid, roads, climate,
        land_cover) is loaded — see scripts/load_supporting_layers.py.
      </p>
    </div>
  );
}
