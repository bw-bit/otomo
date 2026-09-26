import { describe, expect, it } from "vitest";
import { parseIntent } from "@/lib/intent";
import { decide, MAX_SINGLE_PAYMENT_USDC, type PolicyContext } from "@/lib/policy";

const HANA = "0x00000000000000000000000000000000000000aa";
const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  owner: HANA,
  ownerUsdcBalance: async () => 100,
  agentAllowanceUsdc: 50,
  resolveName: async (n) => (n === "hana.otomo.eth" || n.startsWith("0x") ? HANA : null),
  isCompanion: async (n) => n === "hana.otomo.eth",
  ...over,
});

describe("parseIntent", () => {
  it("reads the last json fence and strips it from the text", () => {
    const r = parseIntent('いいよ！\n```json\n{"type":"update_mood","mood":"happy"}\n```');
    expect(r.intent).toEqual({ type: "update_mood", mood: "happy" });
    expect(r.text).toBe("いいよ！");
  });
  it("falls back to none for invalid json or unknown types", () => {
    expect(parseIntent("```json\n{oops}\n```").intent).toEqual({ type: "none" });
    expect(parseIntent('```json\n{"type":"drain_wallet"}\n```').intent).toEqual({ type: "none" });
    expect(parseIntent("ただの会話").intent).toEqual({ type: "none" });
  });
});

describe("role policy", () => {
  const friend = { type: "request_friend", friend: "hana.otomo.eth", task: "翻訳", rewardUsdc: 1 } as const;
  it("work companions never move money or delegate", async () => {
    for (const intent of [
      { type: "send_usdc", to: "hana.otomo.eth", amountUsdc: 1, memo: "" },
      { type: "grow_savings", amountUsdc: 10, days: 7 },
      friend,
      { type: "private_task", summary: "秘密" },
    ] as const) expect((await decide(intent, ctx({ role: "work" }))).kind).toBe("reject");
    expect((await decide({ type: "update_mood", mood: "calm" }, ctx({ role: "work" }))).kind).toBe("auto");
  });
  it("requests only go to work companions", async () => {
    expect(await decide(friend, ctx({ roleOf: async () => "personal" }))).toMatchObject({ kind: "reject" });
    expect(await decide(friend, ctx({ roleOf: async () => null }))).toMatchObject({ kind: "reject" });
    expect(await decide(friend, ctx({ roleOf: async () => "work" }))).toMatchObject({ kind: "needs_approval", resolvedTo: HANA });
  });
});

describe("policy", () => {
  it("auto-runs mood updates only", async () => {
    expect((await decide({ type: "update_mood", mood: "sleepy" }, ctx())).kind).toBe("auto");
    expect((await decide({ type: "private_task", summary: "x" }, ctx())).kind).toBe("needs_approval");
  });
  it("requires approval for payments and resolves ENS names", async () => {
    const d = await decide({ type: "send_usdc", to: "hana.otomo.eth", amountUsdc: 5, memo: "" }, ctx());
    expect(d).toMatchObject({ kind: "needs_approval", resolvedTo: HANA, amountUsdc: 5 });
  });
  it("rejects above the per-payment cap and above the on-chain allowance", async () => {
    const over = await decide({ type: "send_usdc", to: HANA, amountUsdc: MAX_SINGLE_PAYMENT_USDC + 1, memo: "" }, ctx());
    expect(over.kind).toBe("reject");
    const noAllowance = await decide({ type: "send_usdc", to: HANA, amountUsdc: 5, memo: "" }, ctx({ agentAllowanceUsdc: 1 }));
    expect(noAllowance.kind).toBe("reject");
  });
  it("grow_savings needs approval within the owner's balance, without using the agent cap", async () => {
    // No agent allowance is involved — funds stay in the owner's wallet.
    const d = await decide({ type: "grow_savings", amountUsdc: 50, days: 7 }, ctx({ agentAllowanceUsdc: 0 }));
    expect(d).toMatchObject({ kind: "needs_approval", amountUsdc: 50 });
  });
  it("grow_savings rejects when the owner does not hold enough USDC", async () => {
    const d = await decide({ type: "grow_savings", amountUsdc: 50, days: 7 }, ctx({ ownerUsdcBalance: async () => 10 }));
    expect(d.kind).toBe("reject");
  });
  it("rejects unresolvable names and non-companion friends", async () => {
    expect((await decide({ type: "send_usdc", to: "nobody.eth", amountUsdc: 1, memo: "" }, ctx())).kind).toBe("reject");
    expect((await decide({ type: "request_friend", friend: "vitalik.eth", task: "t", rewardUsdc: 0 }, ctx())).kind).toBe("reject");
    expect((await decide({ type: "request_friend", friend: "hana.otomo.eth", task: "t", rewardUsdc: 3 }, ctx())).kind).toBe("needs_approval");
  });
});
