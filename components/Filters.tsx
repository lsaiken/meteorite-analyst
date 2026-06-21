"use client";
import { useEffect, useState } from "react";


export interface FilterState {
  yearMin?: number;
  yearMax?: number;
  recclass?: string;
  discoveryMethod?: "Fell" | "Found";
  massMin?: number;
  massMax?: number;
}

export default function Filters({
  value,
  onChange
}: {
  value: FilterState;
  onChange: (v: FilterState) => void;
}) {
  const [recclasses, setRecclasses] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/recclasses")
      .then((r) => r.json())
      .then(setRecclasses)
      .catch(() => {});
  }, []);
  
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <label style={{ fontSize: 12, color: "#8b9bb0" }}>Year range</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            placeholder="Min year"
            value={value.yearMin ?? ""}
            onChange={(e) => set({ yearMin: e.target.value ? Number(e.target.value) : undefined })}
          />
          <input
            type="number"
            placeholder="Max year"
            value={value.yearMax ?? ""}
            onChange={(e) => set({ yearMax: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </div>

      <div>
        <label style={{ fontSize: 12, color: "#8b9bb0" }}>Discovery Method</label>
        <select
          value={value.discoveryMethod ?? ""}
          onChange={(e) => set({ discoveryMethod: (e.target.value || undefined) as "Fell" | "Found" | undefined })}
        >
          <option value="">All</option>
          <option value="Fell">Fell (witnessed)</option>
          <option value="Found">Found</option>
        </select>
      </div>

      <div>
        <label style={{ fontSize: 12, color: "#8b9bb0" }}>Class (e.g. L6, H5, CM2)</label>
        <input
          type="text"
          list="recclass-options"
          placeholder="Start typing... e.g. L6"
          value={value.recclass ?? ""}
          onChange={(e) => set({ recclass: e.target.value || undefined })}
        />
        <datalist id="recclass-options">
          {recclasses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div>
        <label style={{ fontSize: 12, color: "#8b9bb0" }}>Mass range (g)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            placeholder="Min g"
            value={value.massMin ?? ""}
            onChange={(e) => set({ massMin: e.target.value ? Number(e.target.value) : undefined })}
          />
          <input
            type="number"
            placeholder="Max g"
            value={value.massMax ?? ""}
            onChange={(e) => set({ massMax: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </div>
    </div>
  );
}
