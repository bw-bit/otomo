import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { getDb, type Companion } from "@/lib/db";
import { parseIntent } from "@/lib/intent";
import { decide } from "@/lib/policy";
import { createPendingAction } from "@/lib/approval";
import { companionSystemPrompt, openAiCompatibleChat, personalitySchema, type ChatMessage } from "@/lib/llm";
import { agentAllowanceUsdc, agentSetMood, isCompanion, resolveName } from "@/lib/chain";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({ message: z.string().trim().min(1).max(1000) });

export async function POST(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "相棒の持ち主としてログインしていません" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  try {
    const db = getDb();
    const c = db.prepare(`SELECT * FROM companions WHERE label = ?`).get(label) as Companion | undefined;
    if (!c) return NextResponse.json({ error: "相棒が見つかりません" }, { status: 404 });

    const history = db
      .prepare(`SELECT role, content FROM messages WHERE companion = ? ORDER BY id DESC LIMIT 12`)
      .all(label)
      .reverse() as ChatMessage[];
    const system = companionSystemPrompt(c.label, c.full_name, personalitySchema.parse(JSON.parse(c.personality)));
    const reply = await openAiCompatibleChat([{ role: "system", content: system }, ...history, { role: "user", content: body.data.message }]);
    const { text, intent } = parseIntent(reply);

    const insert = db.prepare(`INSERT INTO messages (companion, role, content, created_at) VALUES (?,?,?,?)`);
    insert.run(label, "user", body.data.message, Date.now());
    insert.run(label, "assistant", text, Date.now());

    const decision = await decide(intent, {
      agentAllowanceUsdc: await agentAllowanceUsdc(c.owner as Address),
      resolveName,
      isCompanion,
    });
    console.info("[chat] decision", { label, intent: intent.type, decision: decision.kind });

    switch (decision.kind) {
      case "noop":
        return NextResponse.json({ text, decision });
      case "reject":
        return NextResponse.json({ text, decision });
      case "auto": {
        const txHash = await agentSetMood(c.resolver as Address, c.full_name, decision.intent.mood);
        return NextResponse.json({ text, decision, txHash });
      }
      case "needs_approval": {
        const action = createPendingAction(db, {
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
