import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { canSwitch } from "@/lib/household";
import { SESSION_COOKIE, readSession, sessionValue } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({ label: z.string().min(1).max(40) });

/** Switch the session between companions born from the same verified human. */
export async function POST(req: NextRequest): Promise<Response> {
  const current = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!current) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    if (!(await canSwitch(await getDb(), current, body.data.label)))
      return NextResponse.json({ error: "この相棒には切り替えられません" }, { status: 403 });
    const res = NextResponse.json({ label: body.data.label });
    res.cookies.set(SESSION_COOKIE, sessionValue(body.data.label), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 86400 });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
