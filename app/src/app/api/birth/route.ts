import { NextResponse, type NextRequest } from "next/server";
import { consumeBirthChallenge, BIRTH_CHALLENGE_COOKIE } from "@/lib/birth-challenge";
import { createCompanionWallet } from "@/lib/companion-wallet";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { optionalNumberEnv, requireEnv } from "@/lib/env";
import { checkBirthProof, type BirthPayload } from "@/lib/birth";
import { normalizeCompanionLabel } from "@/lib/ens";
import { generatePersonality, openAiCompatibleChat } from "@/lib/llm";
import { publicClient, issueCompanionName, fundCompanionGas } from "@/lib/chain";
import { SESSION_COOKIE, sessionValue } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  label: z.string(),
  hint: z.string().max(200).default(""),
  idkitResult: z.record(z.string(), z.unknown()),
});

const portalBase = () =>
  process.env.NEXT_PUBLIC_WORLD_ENV === "production" ? "https://developer.world.org" : "https://staging-developer.worldcoin.org";

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hint } = parsed.data;
  const payload = parsed.data.idkitResult as unknown as BirthPayload;

  let label: string;
  try {
    label = normalizeCompanionLabel(parsed.data.label);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  let reservedLabel: string | null = null;
  try {
    const env = requireEnv("WORLD_RP_ID", "ENS_PARENT_LABEL", "APP_SECRET", "SEPOLIA_RPC_URL", "ENS_USER_REGISTRY", "OPERATOR_PRIVATE_KEY", "COMPANION_WALLET_KEY", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL");
    const db = await getDb();
    if ((await db.execute({ sql: `SELECT 1 FROM companions WHERE label = ?`, args: [label] })).rows[0])
      return NextResponse.json({ error: "その名前の相棒はすでに存在します" }, { status: 409 });

    const signal = await consumeBirthChallenge(db, req.cookies.get(BIRTH_CHALLENGE_COOKIE)?.value);
    if (!signal) return NextResponse.json({ error: "誕生セッションが無効か期限切れです。やり直してください" }, { status: 403 });
    const check = await checkBirthProof(payload, signal, {
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
    console.info("[birth] proof check", { label, ok: check.ok, ...(!check.ok ? { code: check.code } : {}) });
    if (!check.ok) return NextResponse.json({ error: check.reason, code: check.code }, { status: 403 });

    const personality = await generatePersonality(label, hint, openAiCompatibleChat);
    const fullName = `${label}.${env.ENS_PARENT_LABEL}.eth`;
    const grantAgentInInit = false;
    const wallet = createCompanionWallet(label);
    if (await publicClient().getChainId() !== 11155111) throw new Error("Sepolia RPC required");
    // Reserve identity before sending chain transactions: duplicates cannot race to mint two names.
    await db.batch([
      { sql: "INSERT INTO used_nullifiers VALUES (?,?)", args: [check.nullifier, Date.now()] },
      { sql: "INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)", args: [label, fullName, wallet.address.toLowerCase(), "", JSON.stringify(personality), check.nullifier, null, Date.now()] },
      { sql: "INSERT INTO companion_identity VALUES (?,?,?,?,?)", args: [label, wallet.ciphertext, check.sybilScore, process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging", Date.now()] },
      { sql: "INSERT INTO birth_provisioning VALUES (?, 'running', NULL, NULL)", args: [label] },
    ], "write");
    reservedLabel = label;
    await fundCompanionGas(wallet.address);
    const issued = await issueCompanionName({
      label,
      grantAgentInInit,
      onResolver: async resolver => { await db.execute({ sql: "UPDATE companions SET resolver = ? WHERE label = ?", args: [resolver, label] }); },
      records: {
        fullName,
        owner: wallet.address,
        description: `${label} — Otomo companion. ${personality.catchphrase}`,
        personalityJson: JSON.stringify(personality),
        mood: "calm",
      },
    });

    await db.execute({ sql: "UPDATE companions SET resolver = ? WHERE label = ?", args: [issued.resolver, label] });

    await db.execute({ sql: "UPDATE birth_provisioning SET status='ready', register_tx=? WHERE label=?", args: [issued.registerTx, label] });
    const res = NextResponse.json({ label, fullName, personality, ...issued, needsAgentGrant: false });
    res.cookies.set(SESSION_COOKIE, sessionValue(label), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 86400 });
    return res;
  } catch (e) {
    if (reservedLabel) {
      const db = await getDb();
      await db.execute({ sql: "UPDATE birth_provisioning SET status='needs_review', error=? WHERE label=?", args: ["ENS登録の完了を確認できませんでした。再送前にトランザクションを確認する必要があります。", reservedLabel] });
      const res = NextResponse.json({ error: "相棒の本人情報と専用ウォレットは保存されました。ENS登録は確認待ちです。再ログインで状態を確認できます。", label: reservedLabel }, { status: 503 });
      res.cookies.set(SESSION_COOKIE, sessionValue(reservedLabel), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 86400 });
      return res;
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
