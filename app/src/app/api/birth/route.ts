import { NextResponse, after, type NextRequest } from "next/server";
import { consumeBirthChallenge, BIRTH_CHALLENGE_COOKIE } from "@/lib/birth-challenge";
import { createCompanionWallet } from "@/lib/companion-wallet";
import { z } from "zod";
import { getDb, type Companion } from "@/lib/db";
import { optionalNumberEnv, requireEnv } from "@/lib/env";
import { checkBirthProof, type BirthPayload } from "@/lib/birth";
import { ROLE_KEY, SIBLINGS_KEY, normalizeCompanionLabel } from "@/lib/ens";
import { siblingsOf } from "@/lib/household";
import { generatePersonality, openAiCompatibleChat } from "@/lib/llm";
import { publicClient, issueCompanionName, fundCompanionGas, companionSetText } from "@/lib/chain";
import { SESSION_COOKIE, readSession, sessionValue } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  label: z.string(),
  hint: z.string().max(200).default(""),
  role: z.enum(["personal", "work"]).default("personal"),
  reuseVerifiedHuman: z.boolean().optional(),
  idkitResult: z.record(z.string(), z.unknown()).optional(),
});

const portalBase = () =>
  process.env.NEXT_PUBLIC_WORLD_ENV === "production" ? "https://developer.world.org" : "https://staging-developer.worldcoin.org";

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hint, role } = parsed.data;
  const payload = parsed.data.idkitResult as unknown as BirthPayload | undefined;

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

    const limit = Math.max(1, Math.trunc(optionalNumberEnv("WORLD_MAX_COMPANIONS") ?? 3));
    let nullifier: string;
    let sybilScore: number | null = null;
    if (parsed.data.reuseVerifiedHuman) {
      const current = readSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!current) return NextResponse.json({ error: "最初の相棒へログインしてから追加してください" }, { status: 401 });
      const source = (await db.execute({ sql: `SELECT c.human, b.status, i.verification_environment AS environment FROM companions c JOIN birth_provisioning b ON b.label = c.label JOIN companion_identity i ON i.label = c.label WHERE c.label = ?`, args: [current] })).rows[0];
      if (!source || source.status !== "ready" || typeof source.human !== "string" || !source.human || source.environment !== (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging"))
        return NextResponse.json({ error: "本人確認済みの相棒が見つかりません" }, { status: 403 });
      nullifier = source.human;
    } else {
      const signal = await consumeBirthChallenge(db, req.cookies.get(BIRTH_CHALLENGE_COOKIE)?.value);
      if (!signal || !payload) return NextResponse.json({ error: "誕生セッションが無効か期限切れです。やり直してください" }, { status: 403 });
      const check = await checkBirthProof(payload, signal, {
        db,
        sybilMax: optionalNumberEnv("WORLD_SYBIL_MAX"),
        maxCompanions: limit,
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
      nullifier = check.nullifier;
      sybilScore = check.sybilScore;
    }
    const alreadyOwned = Number((await db.execute({ sql: "SELECT COUNT(*) AS c FROM companions WHERE human = ?", args: [nullifier] })).rows[0]?.c ?? 0);
    if (alreadyOwned >= limit)
      return NextResponse.json({ error: `この World ID で作れる相棒は${limit}体までです`, code: "duplicate" }, { status: 409 });

    const personality = await generatePersonality(label, hint, openAiCompatibleChat);
    const fullName = `${label}.${env.ENS_PARENT_LABEL}.eth`;
    const grantAgentInInit = false;
    const wallet = createCompanionWallet(label);
    if (await publicClient().getChainId() !== 11155111) throw new Error("Sepolia RPC required");
    // A write transaction serializes the per-human quota check and reservation.
    const tx = await db.transaction("write");
    try {
      const owned = Number((await tx.execute({ sql: "SELECT COUNT(*) AS c FROM companions WHERE human = ?", args: [nullifier] })).rows[0]?.c ?? 0);
      if (owned >= limit) {
        await tx.rollback();
        return NextResponse.json({ error: `この World ID で作れる相棒は${limit}体までです`, code: "duplicate" }, { status: 409 });
      }
      await tx.execute({ sql: "INSERT OR IGNORE INTO used_nullifiers VALUES (?,?)", args: [nullifier, Date.now()] });
      await tx.execute({ sql: "INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at,human,role) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [label, fullName, wallet.address.toLowerCase(), "", JSON.stringify(personality), `${nullifier}:${label}`, null, Date.now(), nullifier, role] });
      await tx.execute({ sql: "INSERT INTO companion_identity VALUES (?,?,?,?,?)", args: [label, wallet.ciphertext, sybilScore, process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging", Date.now()] });
      await tx.execute({ sql: "INSERT INTO birth_provisioning VALUES (?, 'funding', NULL, NULL)", args: [label] });
      await tx.commit();
    } catch (error) { await tx.rollback(); throw error; }
    finally { tx.close(); }
    reservedLabel = label;
    const siblings = (await siblingsOf(db, label)).filter((s) => s.label !== label);
    await fundCompanionGas(wallet.address);
    await db.execute({ sql: "UPDATE birth_provisioning SET status='deploying_resolver' WHERE label=?", args: [label] });
    const issued = await issueCompanionName({
      label,
      grantAgentInInit,
      onResolver: async resolver => {
        await db.batch([
          { sql: "UPDATE companions SET resolver = ? WHERE label = ?", args: [resolver, label] },
          { sql: "UPDATE birth_provisioning SET status='registering_name' WHERE label=?", args: [label] },
        ], "write");
      },
      records: {
        fullName,
        owner: wallet.address,
        description: `${label} — Otomo companion. ${personality.catchphrase}`,
        personalityJson: JSON.stringify(personality),
        mood: "calm",
        role,
        skills: JSON.stringify(personality.strengths),
        siblings: siblings.map((s) => s.full_name).join(","),
      },
    });

    await db.execute({ sql: "UPDATE companions SET resolver = ? WHERE label = ?", args: [issued.resolver, label] });

    await db.execute({ sql: "UPDATE birth_provisioning SET status='ready', register_tx=? WHERE label=?", args: [issued.registerTx, label] });
    // Best effort: existing siblings announce the newcomer on their own ENS records, without delaying the birth.
    if (siblings.length) after(async () => {
      const all = await siblingsOf(db, label);
      for (const s of siblings) {
        try {
          const c = (await db.execute({ sql: "SELECT * FROM companions WHERE label = ?", args: [s.label] })).rows[0] as unknown as Companion | undefined;
          if (!c?.resolver) continue;
          await companionSetText(c, SIBLINGS_KEY, all.filter((x) => x.label !== s.label).map((x) => x.full_name).join(","));
          await companionSetText(c, ROLE_KEY, s.role);
        } catch (e) { console.error("[birth] sibling ENS update failed", { sibling: s.label, error: e instanceof Error ? e.message : String(e) }); }
      }
    });
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
