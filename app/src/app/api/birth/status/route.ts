import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

/** Show progress only to an existing companion of the same verified human. */
export async function GET(req: NextRequest): Promise<Response> {
  const current = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!current) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const label = req.nextUrl.searchParams.get("label") ?? "";
  if (!/^[a-z0-9-]{3,20}$/.test(label)) return NextResponse.json({ error: "invalid label" }, { status: 400 });
  try {
    const db = await getDb();
    const row = (await db.execute({
      sql: `SELECT b.status, b.register_tx FROM birth_provisioning b
        JOIN companions target ON target.label = b.label
        JOIN companions source ON source.label = ?
        WHERE target.label = ? AND source.human IS NOT NULL AND target.human = source.human`,
      args: [current, label],
    })).rows[0];
    if (!row) return NextResponse.json({ status: "preparing" });
    return NextResponse.json({ status: String(row.status), registerTx: row.register_tx ? String(row.register_tx) : null });
  } catch {
    return NextResponse.json({ error: "progress unavailable" }, { status: 503 });
  }
}
