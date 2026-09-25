import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { requireEnv } from "@/lib/env";
import { BIRTH_ACTION } from "@/lib/birth";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    const { WORLD_RP_SIGNING_KEY, WORLD_RP_ID } = requireEnv("WORLD_RP_SIGNING_KEY", "WORLD_RP_ID");
    const { sig, nonce, createdAt, expiresAt } = signRequest({ action: BIRTH_ACTION, signingKeyHex: WORLD_RP_SIGNING_KEY });
    return NextResponse.json({ rp_id: WORLD_RP_ID, sig, nonce, created_at: createdAt, expires_at: expiresAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
