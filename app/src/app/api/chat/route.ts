import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { getDb, type Companion } from "@/lib/db";
import { parseIntent } from "@/lib/intent";
import { decide } from "@/lib/policy";
import { createPendingAction } from "@/lib/approval";
import { companionSystemPrompt, openAiCompatibleChat, personalitySchema, type ChatMessage } from "@/lib/llm";
import { agentAllowanceUsdc, agentSetMood, isCompanion, resolveName, usdcBalanceOf } from "@/lib/chain";
import { hasCompanionWallet } from "@/lib/companion-wallet";
import { companionSetText } from "@/lib/chain";
import { MAX_SINGLE_PAYMENT_USDC } from "@/lib/policy";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { roleOf } from "@/lib/household";

export const runtime = "nodejs";

const bodySchema = z.object({ message: z.string().trim().min(1).max(1000) });

export async function POST(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "相棒の持ち主としてログインしていません" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  try {
    const db = await getDb();
    const c = (await db.execute({ sql: `SELECT * FROM companions WHERE label = ?`, args: [label] })).rows[0] as unknown as Companion | undefined;
    if (!c) return NextResponse.json({ error: "相棒が見つかりません" }, { status: 404 });

    const history = [...(await db.execute({ sql: `SELECT role, content FROM messages WHERE companion = ? ORDER BY id DESC LIMIT 12`, args: [label] })).rows].reverse() as unknown as ChatMessage[];
    const role = c.role === "work" ? "work" : "personal";
    const system = companionSystemPrompt(c.label, c.full_name, personalitySchema.parse(JSON.parse(c.personality)), role);
    const reply = await openAiCompatibleChat([{ role: "system", content: system }, ...history, { role: "user", content: body.data.message }]);
    const { text, intent } = parseIntent(reply);

    const insertSql = `INSERT INTO messages (companion, role, content, created_at) VALUES (?,?,?,?)`;
    await db.batch([
      { sql: insertSql, args: [label, "user", body.data.message, Date.now()] },
      { sql: insertSql, args: [label, "assistant", text, Date.now()] },
    ], "write");

    const managed = await hasCompanionWallet(db, c.label);
    const decision = await decide(intent, {
      owner: c.owner as Address,
      ownerUsdcBalance: usdcBalanceOf,
      agentAllowanceUsdc: managed ? Math.min(MAX_SINGLE_PAYMENT_USDC, await usdcBalanceOf(c.owner as Address)) : await agentAllowanceUsdc(c.owner as Address),
      resolveName,
      isCompanion,
      role,
      roleOf: (name) => roleOf(db, name),
    });
    console.info("[chat] decision", { label, intent: intent.type, decision: decision.kind });

    switch (decision.kind) {
      case "noop":
        return NextResponse.json({ text, decision });
      case "reject":
        return NextResponse.json({ text, decision });
      case "auto": {
        const txHash = managed ? await companionSetText(c, "otomo.mood", decision.intent.mood) : await agentSetMood(c.resolver as Address, c.full_name, decision.intent.mood);
        return NextResponse.json({ text, decision, txHash });
      }
      case "needs_approval": {
        const action = await createPendingAction(db, {
          companion: label,
          intent: decision.intent,
          resolvedTo: decision.resolvedTo,
          amountUsdc: decision.amountUsdc,
          now: Date.now(),
        });
        return NextResponse.json({ text, decision, actionId: action.id, expiresAt: action.expires_at });
      }
    }
  } catch (e) {
    console.error("[chat] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
