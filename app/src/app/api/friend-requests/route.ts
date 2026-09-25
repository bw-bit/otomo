import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb, type Companion } from "@/lib/db";
import { createPendingAction } from "@/lib/approval";
import { decide } from "@/lib/policy";
import { agentAllowanceUsdc, isCompanion, resolveName } from "@/lib/chain";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import type { Address } from "viem";

export const runtime = "nodejs";

const bodySchema = z.object({ id: z.string(), status: z.enum(["accepted", "done"]) });

interface FriendRequest {
  id: string;
  from_label: string;
  to_label: string;
  task: string;
  reward_usdc: number;
  status: string;
}

/**
 * The friend's owner accepts / completes a request. Completing creates a reward payment
 * on the requester's side that still needs the requester's fresh World ID approval.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  try {
    const db = getDb();
    const r = db.prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(body.data.id) as FriendRequest | undefined;
    if (!r || r.to_label !== label) return NextResponse.json({ error: "依頼が見つかりません" }, { status: 404 });
    const allowed = { accepted: ["open"], done: ["accepted"] }[body.data.status];
    if (!allowed.includes(r.status)) return NextResponse.json({ error: `今の状態（${r.status}）からは変更できません` }, { status: 409 });
    db.prepare(`UPDATE friend_requests SET status = ? WHERE id = ?`).run(body.data.status, r.id);

    if (body.data.status === "done" && r.reward_usdc > 0) {
      const from = db.prepare(`SELECT * FROM companions WHERE label = ?`).get(r.from_label) as Companion | undefined;
      const to = db.prepare(`SELECT * FROM companions WHERE label = ?`).get(r.to_label) as Companion | undefined;
      if (from && to) {
        const intent = { type: "send_usdc" as const, to: to.full_name, amountUsdc: r.reward_usdc, memo: `reward: ${r.task}` };
        const decision = await decide(intent, { agentAllowanceUsdc: await agentAllowanceUsdc(from.owner as Address), resolveName, isCompanion });
        if (decision.kind === "needs_approval")
          createPendingAction(db, { companion: from.label, intent, resolvedTo: decision.resolvedTo, amountUsdc: decision.amountUsdc, now: Date.now() });
        else console.warn("[friend] reward not queued", decision);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
