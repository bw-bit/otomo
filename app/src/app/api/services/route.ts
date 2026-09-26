import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { serviceCatalog } from "@/lib/services/config";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET() {
  try { return NextResponse.json(await serviceCatalog(await getDb()),{headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({error:"catalog_unavailable"},{status:503}); }
}
