import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { checkBirthProof, type BirthPayload } from "@/lib/birth";
import { consumeBirthChallenge, BIRTH_CHALLENGE_COOKIE } from "@/lib/birth-challenge";
import { requireEnv } from "@/lib/env";
import { SESSION_COOKIE, sessionValue } from "@/lib/session";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = await getDb();
    const signal = await consumeBirthChallenge(db, req.cookies.get(BIRTH_CHALLENGE_COOKIE)?.value);
    if (!signal || !body.idkitResult || !Array.isArray(body.idkitResult.responses)) return NextResponse.json({ error: "ログイン確認をやり直してください" }, { status: 403 });
    const { WORLD_RP_ID } = requireEnv("WORLD_RP_ID");
    const portal = process.env.NEXT_PUBLIC_WORLD_ENV === "production" ? "https://developer.world.org" : "https://staging-developer.worldcoin.org";
    const check = await checkBirthProof(body.idkitResult as BirthPayload, signal, { db, allowExisting: true,
      verifyWithPortal: async payload => {
        const response = await fetch(`${portal}/api/v4/verify/${WORLD_RP_ID}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        return { ok: response.ok, detail: "World ID verification failed" };
      },
    });
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });
    const c = (await db.execute({ sql: "SELECT label FROM companions WHERE human = ? ORDER BY created_at LIMIT 1", args: [check.nullifier] })).rows[0];
    if (!c) return NextResponse.json({ error: "このWorld IDの相棒はまだいません" }, { status: 404 });
    const response = NextResponse.json({ label: String(c.label) });
    response.cookies.set(SESSION_COOKIE, sessionValue(String(c.label)), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 86400 });
    return response;
  } catch { return NextResponse.json({ error: "ログインできませんでした" }, { status: 500 }); }
}
