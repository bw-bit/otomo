import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { siblingsOf } from "@/lib/household";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    return NextResponse.json({ companions: await siblingsOf(await getDb(), label), current: label });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
