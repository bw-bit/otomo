import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { optionalNumberEnv, requireEnv } from "@/lib/env";
import { checkBirthProof, markNullifierUsed, type BirthPayload } from "@/lib/birth";
import { normalizeCompanionLabel } from "@/lib/ens";
import { generatePersonality, openAiCompatibleChat } from "@/lib/llm";
import { issueCompanionName } from "@/lib/chain";
import { SESSION_COOKIE, sessionValue } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  label: z.string(),
  hint: z.string().max(200).default(""),
  wallet: z.string().refine(isAddress, "invalid wallet"),
  idkitResult: z.record(z.string(), z.unknown()),
});

const portalBase = () =>
  process.env.NEXT_PUBLIC_WORLD_ENV === "production" ? "https://developer.world.org" : "https://staging-developer.worldcoin.org";

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hint, wallet } = parsed.data;
  const payload = parsed.data.idkitResult as unknown as BirthPayload;

  try {
    const env = requireEnv("WORLD_RP_ID", "ENS_PARENT_LABEL", "APP_SECRET");
    const label = normalizeCompanionLabel(parsed.data.label);
    const db = getDb();
    if (db.prepare(`SELECT 1 FROM companions WHERE label = ? OR owner = ?`).get(label, wallet.toLowerCase()))
      return NextResponse.json({ error: "その名前、またはこのウォレットの相棒はすでに存在します" }, { status: 409 });

    const check = await checkBirthProof(payload, wallet, {
      db,
      sybilMax: optionalNumberEnv("WORLD_SYBIL_MAX"),
      verifyWithPortal: async (p) => {
        const res = await fetch(`${portalBase()}/api/v4/verify/${env.WORLD_RP_ID}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(p),
        });
        const detail = await res.text();
        return { ok: res.ok, detail: detail.slice(0, 300) };
      },
    });
    console.info("[birth] proof check", { label, ok: check.ok, ...(check.ok ? { sybilScore: check.sybilScore } : { code: check.code }) });
    if (!check.ok) return NextResponse.json({ error: check.reason, code: check.code }, { status: 403 });

    const personality = await generatePersonality(label, hint, openAiCompatibleChat);
    const fullName = `${label}.${env.ENS_PARENT_LABEL}.eth`;
    const grantAgentInInit = process.env.ENS_GRANT_AGENT_IN_INIT === "true";
    const issued = await issueCompanionName({
      label,
      grantAgentInInit,
      records: {
        fullName,
        owner: wallet as Address,
        description: `${label} — Otomo companion. ${personality.catchphrase}`,
        personalityJson: JSON.stringify(personality),
        mood: "calm",
      },
    });

    db.transaction(() => {
      markNullifierUsed(db, check.nullifier, Date.now());
      db.prepare(`INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)`).run(
        label, fullName, wallet.toLowerCase(), issued.resolver, JSON.stringify(personality), check.nullifier, null, Date.now(),
      );
    })();

    const res = NextResponse.json({ label, fullName, personality, ...issued, needsAgentGrant: !issued.agentGrantedInInit });
    res.cookies.set(SESSION_COOKIE, sessionValue(label), { httpOnly: true, sameSite: "lax", path: "/" });
    return res;
  } catch (e) {
    console.error("[birth] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
