import type { Address } from "viem";
import type { Intent } from "./intent";

export const MAX_SINGLE_PAYMENT_USDC = 20;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export type PolicyDecision =
  | { kind: "noop" }
  | { kind: "auto"; intent: Extract<Intent, { type: "update_mood" }> }
  | { kind: "needs_approval"; intent: Intent; resolvedTo?: Address; amountUsdc: number }
  | { kind: "reject"; reason: string };

export interface PolicyContext {
  /** Remaining on-chain MockUSDC allowance the owner granted to the agent, in USDC units. */
  agentAllowanceUsdc: number;
  resolveName: (nameOrAddress: string) => Promise<Address | null>;
  /** True if the name belongs to an Otomo companion (has otomo.personality). */
  isCompanion: (name: string) => Promise<boolean>;
}

function checkAmount(amount: number, ctx: PolicyContext): string | null {
  if (amount > MAX_SINGLE_PAYMENT_USDC) return `1回の上限 ${MAX_SINGLE_PAYMENT_USDC} USDC を超えています`;
  if (amount > ctx.agentAllowanceUsdc)
    return `相棒に預けている上限（${ctx.agentAllowanceUsdc} USDC）を超えています`;
  return null;
}

export async function decide(intent: Intent, ctx: PolicyContext): Promise<PolicyDecision> {
  switch (intent.type) {
    case "none":
      return { kind: "noop" };
    case "update_mood":
      return { kind: "auto", intent };
    case "private_task":
      return { kind: "needs_approval", intent, amountUsdc: 0 };
    case "send_usdc": {
      const tooMuch = checkAmount(intent.amountUsdc, ctx);
      if (tooMuch) return { kind: "reject", reason: tooMuch };
      const to = await ctx.resolveName(intent.to);
      if (!to) return { kind: "reject", reason: `${intent.to} を解決できませんでした` };
      return { kind: "needs_approval", intent, resolvedTo: to, amountUsdc: intent.amountUsdc };
    }
    case "request_friend": {
      if (!(await ctx.isCompanion(intent.friend)))
        return { kind: "reject", reason: `${intent.friend} は Otomo の相棒ではありません` };
      const to = await ctx.resolveName(intent.friend);
      if (!to) return { kind: "reject", reason: `${intent.friend} を解決できませんでした` };
      if (intent.rewardUsdc > 0) {
        const tooMuch = checkAmount(intent.rewardUsdc, ctx);
        if (tooMuch) return { kind: "reject", reason: tooMuch };
      }
      return { kind: "needs_approval", intent, resolvedTo: to, amountUsdc: intent.rewardUsdc };
    }
  }
}
