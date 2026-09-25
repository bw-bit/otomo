import "server-only";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type { Companion, Db, PendingAction } from "./db";
import type { Intent } from "./intent";
import { agentTransferUsdc } from "./chain";

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
    default:
      throw new Error(`intent ${intent.type} is not an approvable action`);
  }
}
