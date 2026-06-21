import { NextResponse } from "next/server";
import { getMassRange } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // no request params, so Next would
                                          // otherwise try to prerender this at build time

export async function GET() {
  const mass = await getMassRange();
  return NextResponse.json(mass);
}