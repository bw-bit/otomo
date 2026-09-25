import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { acceptWork, deliverWork, reviewWork } from "@/lib/work";
import { openAiCompatibleChat } from "@/lib/llm";

export const runtime = "nodejs";
const bodySchema = z.object({ id: z.string(), status: z.enum(["accepted", "delivered", "done"]) });
export async function POST(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const db = await getDb();
    const { id, status } = body.data;
    if (status === "accepted") await acceptWork(db, id, label);
    else if (status === "delivered") await deliverWork(db, id, label, openAiCompatibleChat);
    else await reviewWork(db, id, label);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "作業を完了できませんでした" }, { status: 409 });
  }
}
