import { readText } from "@/lib/chain";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { reputationSnapshot, recheckPublication } from "@/lib/reputation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { hasCompanionWallet } from "@/lib/companion-wallet";
import { createPendingAction } from "@/lib/approval";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const db = await getDb();
  const publication = (await db.execute({ sql: "SELECT snapshot,tx_hash,status,published_at,error FROM reputation_publications WHERE label = ?", args: [label] })).rows[0] ?? null;
  return NextResponse.json({ snapshot: await reputationSnapshot(db, label), publication });
}
export async function POST(req: NextRequest) {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const db = await getDb();
  if (!(await hasCompanionWallet(db, label))) return NextResponse.json({ error: "専用ウォレットへの移行が必要です" }, { status: 409 });
  const c = (await db.execute({ sql: "SELECT agent_sub, resolver FROM companions WHERE label = ?", args: [label] })).rows[0];
  if (!c?.agent_sub || !c.resolver) return NextResponse.json({ error: "本人との紐付けとENS登録を先に完了してください" }, { status: 409 });
  const snapshot = await reputationSnapshot(db, label);
  const action = await createPendingAction(db, { companion: label, intent: { type: "publish_reputation", snapshot: JSON.stringify(snapshot) }, amountUsdc: 0, now: Date.now() });
  return NextResponse.json({ snapshot, actionId: action.id });
}

export async function PATCH(req: NextRequest) {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try { return NextResponse.json({ publication: await recheckPublication(await getDb(), label, readText) }); }
  catch { return NextResponse.json({ error: "再確認できる公開記録がありません" }, { status: 409 }); }
}
