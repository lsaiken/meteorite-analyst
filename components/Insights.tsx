"use client";

interface ToolCall {
  tool: string;
  input: any;
  result: any;
}

function extractConfidenceChips(text: string): { label: string; level: "high" | "medium" | "low" }[] {
  const chips: { label: string; level: "high" | "medium" | "low" }[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/confidence:\s*(high|medium|low)/i);
    if (match) {
      const level = match[1].toLowerCase() as "high" | "medium" | "low";
      const label = line.replace(/confidence:\s*(high|medium|low)/i, "").replace(/^[-*\s]+/, "").trim() || level;
      chips.push({ label, level });
    }
  }
  return chips;
}

export default function Insights({ explanation, toolCalls }: { explanation: string; toolCalls: ToolCall[] }) {
  const chips = extractConfidenceChips(explanation);

  return (
    <div>
      <div className="explanation-text">{explanation}</div>

      {chips.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {chips.map((c, i) => (
            <span key={i} className={`chip ${c.level}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}

      {toolCalls.length > 0 && (
        <details className="tool-log">
          <summary>Show the AI's work ({toolCalls.length} queries)</summary>
          {toolCalls.map((tc, i) => (
            <div key={i} style={{ marginTop: 6 }}>
              <strong>{tc.tool}</strong>({JSON.stringify(tc.input)}) →{" "}
              {JSON.stringify(tc.result)}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
