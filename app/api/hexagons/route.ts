import { NextResponse } from "next/server";
import { getHexagonBiasScores } from "@/lib/queries";

export const runtime = "nodejs";
// No request params here (unlike /api/meteorites and /api/off-world, which
// take searchParams), so Next.js otherwise assumes this route is static and
// tries to prerender it at build time - before DATABASE_URL is wired up,
// which is what produced the ECONNREFUSED 127.0.0.1:5432 build error.
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await getHexagonBiasScores();
  return NextResponse.json(rows);
}