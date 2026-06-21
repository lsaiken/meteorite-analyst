"use client";

import { useState, useCallback } from "react";
import WorldMap from "@/components/WorldMap";
import Filters, { FilterState } from "@/components/Filters";
import BiasLayerToggle, { LayerState } from "@/components/BiasLayerToggle";
import Insights from "@/components/Insights";
import OffWorldPanel from "@/components/OffWorldPanel";

export default function Page() {
  const [filters, setFilters] = useState<FilterState>({});
  const [layers, setLayers] = useState<LayerState>({
    population: false,
    roads: false,
    climate: false,
    landCover: false
  });
  const [selectedBbox, setSelectedBbox] = useState<[number, number, number, number] | null>(null);
  const [explanation, setExplanation] = useState<string>("");
  const [toolCalls, setToolCalls] = useState<{ tool: string; input: any; result: any }[]>([]);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");

  const handleExplain = useCallback(async () => {
    if (!selectedBbox) return;
    setLoading(true);
    setExplanation("");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox: selectedBbox, question })
      });
      const data = await res.json();
      setExplanation(data.explanation || data.error || "No explanation returned.");
      setToolCalls(data.toolCalls || []);
    } catch (e: any) {
      setExplanation(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedBbox, question]);

  return (
    <div className="app-shell">
      <div className="map-pane">
        <WorldMap filters={filters} layers={layers} onRegionSelect={setSelectedBbox} />
      </div>
      <div className="sidebar">
        <div className="panel">
          <h3>Filters</h3>
          <Filters value={filters} onChange={setFilters} />
        </div>

        <div className="panel">
          <h3>Bias Layers</h3>
          <BiasLayerToggle value={layers} onChange={setLayers} />
        </div>

        <OffWorldPanel filters={filters} />

        <div className="panel">
          <h3>Explain This Pattern</h3>
          {selectedBbox ? (
            <p style={{ fontSize: 12, color: "#8b9bb0" }}>
              Region selected: [{selectedBbox.map((n) => n.toFixed(2)).join(", ")}]
            </p>
          ) : (
            <p style={{ fontSize: 12, color: "#8b9bb0" }}>
              Draw a box on the map (shift-drag) to select a region.
            </p>
          )}
          <textarea
            placeholder='e.g. "Why are there so few meteorites here?"'
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div style={{ height: 8 }} />
          <button className="primary" disabled={!selectedBbox || loading} onClick={handleExplain}>
            {loading ? "Investigating..." : "Investigate"}
          </button>
        </div>

        {explanation && (
          <div className="panel">
            <h3>AI Analyst</h3>
            <Insights explanation={explanation} toolCalls={toolCalls} />
          </div>
        )}
      </div>
    </div>
  );
}
