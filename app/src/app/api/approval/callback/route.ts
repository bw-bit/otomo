import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { handleAuthCallback } from "@/lib/approval";
import { agentOidcConfig, exchangeCode, remoteJwks, verifyIdToken } from "@/lib/oidc";
import { executeApprovedAction } from "@/lib/actions";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams;
  const db = await getDb();
  const cfg = agentOidcConfig();
  const owned = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const flow = q.get("state") ? (await db.execute({ sql: "SELECT kind, ref FROM auth_flows WHERE state = ?", args: [q.get("state")!] })).rows[0] : null;
  let expectedOwner = flow?.kind === "bind" ? String(flow.ref) : null;
  if (flow?.kind === "approve") expectedOwner = String((await db.execute({ sql: "SELECT companion FROM pending_actions WHERE id = ?", args: [String(flow.ref)] })).rows[0]?.companion ?? "");
  if (!owned || owned !== expectedOwner) return NextResponse.json({ error: "認証を開始したセッションで開いてください" }, { status: 403 });
  const result = await handleAuthCallback(
    { state: q.get("state"), code: q.get("code"), error: q.get("error"), now: Date.now() },
    {
      db,
      authenticate: async (code, flow) => {
        const idToken = await exchangeCode(cfg, code, flow.code_verifier);
        return verifyIdToken(idToken, { issuer: cfg.issuer, audience: cfg.clientId, nonce: flow.nonce, getKey: remoteJwks(cfg.issuer) });
      },
      execute: (action, companion) => executeApprovedAction(db, action, companion),
    },
  );
  if (result.ok && result.kind === "bind") await db.execute({ sql: "INSERT INTO identity_bindings VALUES (?,?,?) ON CONFLICT(label) DO UPDATE SET issuer=excluded.issuer, verified_at=excluded.verified_at", args: [result.companion, cfg.issuer, Date.now()] });
  console.info("[approval] callback", { ok: result.ok, kind: result.ok ? result.kind : "failed" });

  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const url = new URL(label ? `/otomo/${label}` : "/", req.nextUrl.origin);
  url.searchParams.set("auth", result.ok ? "ok" : "ng");
  if (!result.ok) url.searchParams.set("reason", result.reason);
  return NextResponse.redirect(url);
}
