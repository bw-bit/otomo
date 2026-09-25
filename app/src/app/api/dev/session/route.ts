import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionValue } from "@/lib/session";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * ローカルデモ専用。OTOMO_DEV_SESSION=1 のときだけ有効。
 * 既存の相棒ラベルの持ち主セッションを発行して相棒ページへリダイレクトする。
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (process.env.OTOMO_DEV_SESSION !== "1") return NextResponse.json({ error: "not found" }, { status: 404 });
  const label = req.nextUrl.searchParams.get("label") ?? "";
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  const db = await getDb();
  const found = (await db.execute({ sql: `SELECT 1 FROM companions WHERE label = ?`, args: [label] })).rows[0];
  if (!found) return NextResponse.json({ error: "companion not found" }, { status: 404 });
  const res = NextResponse.redirect(new URL(`/otomo/${encodeURIComponent(label)}`, req.url));
  res.cookies.set(SESSION_COOKIE, sessionValue(label), { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
