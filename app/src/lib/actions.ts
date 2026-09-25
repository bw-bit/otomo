import "server-only";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type { Companion, Db, PendingAction } from "./db";
import type { Intent } from "./intent";
import { companionTransferUsdc, companionSetText, readText, resolveName } from "./chain";
import { REPUTATION_KEY } from "./reputation";
import { executeManagedStrategy, planStrategy } from "./aqua";

/** Runs an approved action. Only called by handleAuthCallback after fresh World ID for Agents verification. */
export async function executeApprovedAction(db: Db, action: PendingAction, companion: Companion): Promise<{ txHash?: string }> {
  const intent = JSON.parse(action.intent) as Intent;
  switch (intent.type) {
    case "strategy_operation":
      return { txHash: await executeManagedStrategy(db, companion, intent.strategyId, intent.operation) };
    case "publish_reputation": {
      const snapshot = JSON.parse(intent.snapshot);
      if (snapshot.name !== companion.full_name || snapshot.issuer !== "Otomo") throw new Error("Invalid reputation snapshot");
      const txHash = await companionSetText(companion, REPUTATION_KEY, intent.snapshot);
      const actual = await readText(companion.full_name, REPUTATION_KEY).catch(() => null);
      const matched = actual === intent.snapshot;
      await db.execute({ sql: "INSERT INTO reputation_publications VALUES (?,?,?,?,?,?) ON CONFLICT(label) DO UPDATE SET snapshot=excluded.snapshot,tx_hash=excluded.tx_hash,status=excluded.status,published_at=excluded.published_at,error=excluded.error", args: [companion.label, intent.snapshot, txHash, matched ? "verified" : "unverified", Date.now(), matched ? null : "ENS readback did not match"] });
      return { txHash };
    }
    case "send_usdc":
      if (action.amount_usdc <= 0 || action.amount_usdc > 20 || action.amount_usdc !== intent.amountUsdc) throw new Error("Payment amount mismatch or limit exceeded");
      if (!action.resolved_to) throw new Error("recipient not resolved");
      return { txHash: await companionTransferUsdc(companion, action.resolved_to as Address, action.amount_usdc, async hash => { await db.execute({ sql: "UPDATE pending_actions SET tx_hash=? WHERE id=?", args: [hash, action.id] }); }) };
    case "request_friend": {
      const target = (await db.execute({ sql: "SELECT label, owner FROM companions WHERE full_name = ?", args: [intent.friend.toLowerCase()] })).rows[0];
      if (!target || String(target.label) === companion.label) throw new Error("仕事は別の相棒に依頼してください");
      const resolved = await resolveName(intent.friend);
      if (!resolved || resolved.toLowerCase() !== String(target.owner).toLowerCase()) throw new Error("相棒のENS宛先が一致しません");
      const toLabel = String(target.label);
      await db.execute({ sql: `INSERT INTO friend_requests VALUES (?,?,?,?,?,?,?)`, args: [
        randomUUID(), companion.label, toLabel, intent.task, intent.rewardUsdc, "open", Date.now(),
      ] });
      return {};
    }
    case "private_task":
      // Private tasks stay in the server DB only; nothing is written on-chain.
      return {};
    case "grow_savings": {
      // The plan only prepares the strategy. The maker's own wallet ships it to
      // Aqua from the companion page; the agent never touches the funds.
      const plan = await planStrategy({ maker: companion.owner as Address, amountUsdc: intent.amountUsdc, days: intent.days });
      await db.execute({ sql: `INSERT INTO strategies VALUES (@id,@companion,@action_id,@maker,@router,@strategy,@strategy_hash,@usdc_amount,@weth_amount,@deadline,@status,@ship_tx,@dock_tx,@created_at)`, args: {
        id: randomUUID(),
        companion: companion.label,
        action_id: action.id,
        maker: companion.owner,
        router: plan.router,
        strategy: plan.strategy,
        strategy_hash: null,
        usdc_amount: plan.usdcAmount,
        weth_amount: plan.wethAmount,
        deadline: plan.deadline,
        status: "ready",
        ship_tx: null,
        dock_tx: null,
        created_at: Date.now(),
      } });
      return {};
    }
    default:
      throw new Error(`intent ${intent.type} is not an approvable action`);
  }
}
