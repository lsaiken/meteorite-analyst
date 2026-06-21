import { NextRequest, NextResponse } from "next/server";
import { getMeteoritesGeoJSON } from "@/lib/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const bboxParam = sp.get("bbox");
  const bbox = bboxParam
    ? (bboxParam.split(",").map(Number) as [number, number, number, number])
    : undefined;

  const geojson = await getMeteoritesGeoJSON({
    yearMin: sp.get("yearMin") ? Number(sp.get("yearMin")) : undefined,
    yearMax: sp.get("yearMax") ? Number(sp.get("yearMax")) : undefined,
    recclass: sp.get("recclass") || undefined,
    discoveryMethod: (sp.get("discoveryMethod") as "Fell" | "Found") || undefined,
    massMin: sp.get("massMin") ? Number(sp.get("massMin")) : undefined,
    massMax: sp.get("massMax") ? Number(sp.get("massMax")) : undefined,
    bbox
  });

  return NextResponse.json(geojson);
}
