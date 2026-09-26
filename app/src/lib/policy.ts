import type { Address } from "viem";
import type { Intent } from "./intent";
import type { CompanionRole } from "./db";

export const MAX_SINGLE_PAYMENT_USDC = 20;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export type PolicyDecision =
  | { kind: "noop" }
  | { kind: "auto"; intent: Extract<Intent, { type: "update_mood" }> }
  | { kind: "needs_approval"; intent: Intent; resolvedTo?: Address; amountUsdc: number }
  | { kind: "reject"; reason: string };

export interface PolicyContext {
  /** The companion owner's wallet address. */
  owner: Address;
  /** Owner's MockUSDC balance, in USDC units. */
  ownerUsdcBalance: (owner: Address) => Promise<number>;
  /** Remaining on-chain MockUSDC allowance the owner granted to the agent, in USDC units. */
  agentAllowanceUsdc: number;
  resolveName: (nameOrAddress: string) => Promise<Address | null>;
  /** True if the name belongs to an Otomo companion (has otomo.personality). */
  isCompanion: (name: string) => Promise<boolean>;
  /** Role of the acting companion. Work companions only deliver; they never move money or delegate. */
  role?: CompanionRole;
  /** Role of another companion by ENS name or label; null if unknown. */
  roleOf?: (name: string) => Promise<CompanionRole | null>;
}

const WORK_FORBIDDEN: ReadonlySet<Intent["type"]> = new Set(["send_usdc", "grow_savings", "request_friend", "private_task"]);

function checkAmount(amount: number, ctx: PolicyContext): string | null {
  if (amount > MAX_SINGLE_PAYMENT_USDC) return `1回の上限 ${MAX_SINGLE_PAYMENT_USDC} USDC を超えています`;
  if (amount > ctx.agentAllowanceUsdc)
    return `相棒に預けている上限（${ctx.agentAllowanceUsdc} USDC）を超えています`;
  return null;
}

export async function decide(intent: Intent, ctx: PolicyContext): Promise<PolicyDecision> {
  if (ctx.role === "work" && WORK_FORBIDDEN.has(intent.type))
    return { kind: "reject", reason: "仕事係の相棒はお金を動かしたり依頼を出したりしません。個人の相棒に頼んでください" };
  switch (intent.type) {
    case "strategy_operation":
    case "publish_reputation":
      return { kind: "reject", reason: "実績カードの公開ボタンから内容を確認してください" };
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
    case "grow_savings": {
      // The agent never moves funds — shipping is the owner's own wallet action,
      // so the per-payment cap / agent allowance do not apply; the owner just
      // needs to actually hold the USDC.
      const balance = await ctx.ownerUsdcBalance(ctx.owner);
      if (intent.amountUsdc > balance)
        return { kind: "reject", reason: `ウォレットの USDC が足りません（残高 ${balance} USDC）` };
      return { kind: "needs_approval", intent, amountUsdc: intent.amountUsdc };
    }
    case "request_friend": {
      if (!(await ctx.isCompanion(intent.friend)))
        return { kind: "reject", reason: `${intent.friend} は Otomo の相棒ではありません` };
      if (ctx.roleOf && (await ctx.roleOf(intent.friend)) !== "work")
        return { kind: "reject", reason: `${intent.friend} は依頼を受ける仕事係ではありません` };
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
