import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { serviceEarnings } from "@/lib/services/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request: NextRequest) {
  const label=readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({error:"not_signed_in"},{status:401});
  try { return NextResponse.json({label,...await serviceEarnings(await getDb(),label)},{headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({error:"earnings_unavailable"},{status:503}); }
}
