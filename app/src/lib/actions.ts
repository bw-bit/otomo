import "server-only";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type { Companion, Db, PendingAction } from "./db";
import type { Intent } from "./intent";
import { agentTransferUsdc } from "./chain";
import { planStrategy } from "./aqua";

/** Runs an approved action. Only called by handleAuthCallback after fresh World ID for Agents verification. */
export async function executeApprovedAction(db: Db, action: PendingAction, companion: Companion): Promise<{ txHash?: string }> {
  const intent = JSON.parse(action.intent) as Intent;
  switch (intent.type) {
    case "send_usdc":
      if (!action.resolved_to) throw new Error("recipient not resolved");
      return { txHash: await agentTransferUsdc(companion.owner as Address, action.resolved_to as Address, action.amount_usdc) };
    case "request_friend": {
      const toLabel = intent.friend.split(".")[0];
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
