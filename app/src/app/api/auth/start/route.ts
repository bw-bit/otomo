import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Companion, type PendingAction } from "@/lib/db";
import { startAuthFlow } from "@/lib/approval";
import { agentOidcConfig, buildAuthorizeUrl } from "@/lib/oidc";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

/** GET /api/auth/start?kind=bind  |  /api/auth/start?kind=approve&action=<id> */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const owned = readSession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!owned) return NextResponse.json({ error: "相棒の持ち主としてログインしていません" }, { status: 401 });
    const db = await getDb();
    const kind = req.nextUrl.searchParams.get("kind");

    let ref: string;
    if (kind === "bind") {
      const c = (await db.execute({ sql: `SELECT * FROM companions WHERE label = ?`, args: [owned] })).rows[0] as unknown as Companion | undefined;
      if (!c) return NextResponse.json({ error: "相棒が見つかりません" }, { status: 404 });
      if (c.agent_sub) return NextResponse.json({ error: "すでに契りを結んでいます" }, { status: 409 });
      ref = c.label;
    } else if (kind === "approve") {
      const id = req.nextUrl.searchParams.get("action") ?? "";
      const a = (await db.execute({ sql: `SELECT * FROM pending_actions WHERE id = ?`, args: [id] })).rows[0] as unknown as PendingAction | undefined;
      if (!a || a.companion !== owned) return NextResponse.json({ error: "依頼が見つかりません" }, { status: 404 });
      if (a.status !== "pending") return NextResponse.json({ error: `この依頼は ${a.status} です` }, { status: 409 });
      ref = a.id;
    } else {
      return NextResponse.json({ error: "kind must be bind or approve" }, { status: 400 });
    }

    const flow = await startAuthFlow(db, { kind, ref, now: Date.now() });
    return NextResponse.redirect(buildAuthorizeUrl(agentOidcConfig(), { state: flow.state, nonce: flow.nonce, codeVerifier: flow.code_verifier }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
