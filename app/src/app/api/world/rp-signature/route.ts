import { getDb } from "@/lib/db";
import { createBirthChallenge, BIRTH_CHALLENGE_COOKIE } from "@/lib/birth-challenge";
import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { requireEnv } from "@/lib/env";
import { BIRTH_ACTION } from "@/lib/birth";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    const { WORLD_RP_SIGNING_KEY, WORLD_RP_ID } = requireEnv("WORLD_RP_SIGNING_KEY", "WORLD_RP_ID");
    const { sig, nonce, createdAt, expiresAt } = signRequest({ action: BIRTH_ACTION, signingKeyHex: WORLD_RP_SIGNING_KEY });
    const challenge = await createBirthChallenge(await getDb());
    const response = NextResponse.json({ rp_id: WORLD_RP_ID, sig, nonce, created_at: createdAt, expires_at: expiresAt, signal: challenge.signal });
    response.cookies.set(BIRTH_CHALLENGE_COOKIE, challenge.id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
    return response;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
