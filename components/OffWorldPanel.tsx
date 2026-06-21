"use client";

import { useEffect, useState } from "react";
import type { FilterState } from "./Filters";

interface OffWorldFind {
  id: number;
  name: string;
  year: number | null;
  mass_g: number | null;
  recclass: string;
  discovery_method: string;
  latitude: number;
  longitude: number;
}

export default function OffWorldPanel({ filters }: { filters: FilterState }) {
  const [finds, setFinds] = useState<OffWorldFind[]>([]);
  const [open, setOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.yearMin != null) params.set("yearMin", String(filters.yearMin));
    if (filters.yearMax != null) params.set("yearMax", String(filters.yearMax));
    if (filters.recclass) params.set("recclass", filters.recclass);
    if (filters.discoveryMethod) params.set("discoveryMethod", filters.discoveryMethod);
    if (filters.massMin != null) params.set("massMin", String(filters.massMin));
    if (filters.massMax != null) params.set("massMax", String(filters.massMax));

    fetch(`/api/off-world?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setFinds(data);
        setHasLoaded(true);
      })
      .catch(() => {});
  }, [filters]);

  const filtersActive = Object.values(filters).some((v) => v !== undefined && v !== "");

  // Nothing to show, and filters aren't the reason (no off-world data loaded at all)
  if (hasLoaded && finds.length === 0 && !filtersActive) return null;

  return (
    <div className="panel">
      <h3>🛰️ Off-World Finds</h3>
      {finds.length === 0 ? (
        <p style={{ fontSize: 12, color: "#8b9bb0", margin: 0 }}>
          No off-world finds match the current filters.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "#8b9bb0", margin: 0 }}>
            {finds.length} meteorite{finds.length > 1 ? "s" : ""} matching your filters not shown on the
            map — found on another body, so Earth coordinates don't apply.
          </p>
          <button
            className="primary"
            style={{ marginTop: 10, background: "#1c232c" }}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide" : "Show"} details
          </button>
          {open && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {finds.map((f) => (
                <div key={f.id} style={{ fontSize: 12, border: "1px solid #2a3441", borderRadius: 6, padding: 8 }}>
                  <strong>{f.name}</strong> ({f.year ?? "year unknown"})
                  <div style={{ color: "#8b9bb0" }}>
                    {f.recclass} · {f.discovery_method}
                    {f.mass_g ? ` · ${f.mass_g.toLocaleString()} g` : ""}
                  </div>
                  <div style={{ color: "#6b7787" }}>
                    lat {f.latitude.toFixed(3)}, lng {f.longitude.toFixed(3)} (non-Earth coordinate convention)
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
