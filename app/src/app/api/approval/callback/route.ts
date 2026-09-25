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
  console.info("[approval] callback", result);

  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const url = new URL(label ? `/otomo/${label}` : "/", req.nextUrl.origin);
  url.searchParams.set("auth", result.ok ? "ok" : "ng");
  if (!result.ok) url.searchParams.set("reason", result.reason);
  return NextResponse.redirect(url);
}
