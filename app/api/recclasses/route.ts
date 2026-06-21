import { NextResponse } from "next/server";
import { getDistinctRecclassValues } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // no request params, so Next would
                                          // otherwise try to prerender this at build time

export async function GET() {
  const recclasses = await getDistinctRecclassValues();
  return NextResponse.json(recclasses);
}