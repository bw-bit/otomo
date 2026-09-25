import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";
import { getDb, type Companion } from "@/lib/db";
import { MOOD_KEY, PERSONALITY_KEY } from "@/lib/ens";
import { agentAddress, agentAllowanceUsdc, publicClient, readText, resolveName } from "@/lib/chain";
import { hasCompanionWallet } from "@/lib/companion-wallet";
import { reputationSnapshot } from "@/lib/reputation";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

/** Owner dashboard. ENS values are read back from Sepolia (Universal Resolver), never from the local DB. */
export async function GET(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    const db = await getDb();
    const c = (await db.execute({ sql: `SELECT * FROM companions WHERE label = ?`, args: [label] })).rows[0] as unknown as Companion | undefined;
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    const uncertain = (await db.execute({ sql: "SELECT id,tx_hash,intent FROM pending_actions WHERE companion=? AND tx_hash IS NOT NULL AND reason IN ('executing','confirmation_pending')", args: [label] })).rows;
    for (const action of uncertain) {
      if (JSON.parse(String(action.intent)).type !== "send_usdc") continue;
      try {
        const receipt = await publicClient().getTransactionReceipt({ hash: String(action.tx_hash) as `0x${string}` });
        await db.execute({ sql: "UPDATE pending_actions SET status=?,reason=? WHERE id=? AND reason IN ('executing','confirmation_pending')", args: [receipt.status === "success" ? "executed" : "rejected", receipt.status === "success" ? null : "取引が取り消されました", String(action.id)] });
      } catch { /* A missing receipt stays unconfirmed and is never resent automatically. */ }
    }
    const managed = await hasCompanionWallet(db, label);
    const [address, mood, personality, allowance, actions, inbox, outbox, messages] = await Promise.all([
      resolveName(c.full_name),
      readText(c.full_name, MOOD_KEY),
      readText(c.full_name, PERSONALITY_KEY),
      managed ? Promise.resolve(20) : agentAllowanceUsdc(c.owner as Address),
      db.execute({ sql: `SELECT * FROM pending_actions WHERE companion = ? ORDER BY created_at DESC LIMIT 20`, args: [label] }),
      db.execute({ sql: `SELECT f.*, d.content, d.reviewed_at, d.reward_action_id FROM friend_requests f LEFT JOIN work_deliveries d ON d.request_id = f.id WHERE to_label = ? ORDER BY created_at DESC`, args: [label] }),
      db.execute({ sql: `SELECT f.*, d.content, d.reviewed_at, d.reward_action_id FROM friend_requests f LEFT JOIN work_deliveries d ON d.request_id = f.id WHERE from_label = ? ORDER BY created_at DESC`, args: [label] }),
      db.execute({ sql: `SELECT role, content FROM messages WHERE companion = ? ORDER BY id DESC LIMIT 30`, args: [label] }),
    ]);
    return NextResponse.json({
      label: c.label,
      fullName: c.full_name,
      owner: c.owner,
      resolver: c.resolver,
      bound: !!c.agent_sub,
      agent: managed ? c.owner : agentAddress(),
      managed,
      provisioning: (await db.execute({ sql: "SELECT status,error FROM birth_provisioning WHERE label=?", args: [label] })).rows[0] ?? null,
      reputation: await reputationSnapshot(db, label),
      ens: { address, mood, personality },
      allowanceUsdc: allowance,
      actions: actions.rows,
      inbox: inbox.rows,
      outbox: outbox.rows,
      messages: [...messages.rows].reverse(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
