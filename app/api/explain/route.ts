import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tools, runTool, SYSTEM_PROMPT } from "@/lib/aiTools";

export const runtime = "nodejs";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ExplainRequestBody {
  bbox: [number, number, number, number]; // minLng, minLat, maxLng, maxLat
  question?: string;
}

export async function POST(req: NextRequest) {
  const body: ExplainRequestBody = await req.json();
  const { bbox, question } = body;

  if (!bbox || bbox.length !== 4) {
    return NextResponse.json({ error: "bbox [minLng,minLat,maxLng,maxLat] is required" }, { status: 400 });
  }

  const userQuestion =
    question?.trim() ||
    "Explain why meteorite discoveries are sparse or dense in this region compared to what we'd expect.";

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Region bounding box: [minLng=${bbox[0]}, minLat=${bbox[1]}, maxLng=${bbox[2]}, maxLat=${bbox[3]}]\n\nQuestion: ${userQuestion}`
    }
  ];

  const MAX_TURNS = 6;
  let finalText = "";
  const toolCallLog: { tool: string; input: any; result: any }[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: tools as any,
      messages
    });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];

    if (toolUseBlocks.length === 0) {
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await runTool(block.name, block.input as any);
        toolCallLog.push({ tool: block.name, input: block.input, result });
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(result)
        };
      })
    );

    messages.push({ role: "user", content: toolResults });

    if (turn === MAX_TURNS - 1) {
      // Force a final answer on the last allowed turn
      const wrapUp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [...messages, { role: "user", content: "Please give your final explanation now based on everything gathered so far." }]
      });
      finalText = wrapUp.content
        .filter((b) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    }
  }

  return NextResponse.json({
    explanation: finalText,
    toolCalls: toolCallLog // expose for the "show your work" panel in the UI
  });
}
