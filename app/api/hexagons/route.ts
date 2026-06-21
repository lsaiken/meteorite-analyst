import { NextResponse } from "next/server";
import { getHexagonBiasScores } from "@/lib/queries";

export const runtime = "nodejs";

export async function GET() {
  const rows = await getHexagonBiasScores();
  return NextResponse.json(rows);
}
