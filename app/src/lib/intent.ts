import { z } from "zod";

const ensOrAddress = z.string().trim().min(3).max(100);

export const intentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("update_mood"), mood: z.string().trim().min(1).max(40) }),
  z.object({
    type: z.literal("request_friend"),
    friend: ensOrAddress,
    task: z.string().trim().min(1).max(500),
    rewardUsdc: z.number().nonnegative().max(1_000_000),
  }),
  z.object({
    type: z.literal("send_usdc"),
    to: ensOrAddress,
    amountUsdc: z.number().positive().max(1_000_000),
    memo: z.string().trim().max(200).default(""),
  }),
  z.object({ type: z.literal("private_task"), summary: z.string().trim().min(1).max(500) }),
]);

export type Intent = z.infer<typeof intentSchema>;
export const NO_INTENT: Intent = { type: "none" };

/** Extracts the last ```json fenced block (or trailing {...}) from an LLM reply. Anything invalid becomes `none`. */
export function parseIntent(reply: string): { text: string; intent: Intent } {
  const fence = [...reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].at(-1);
  const raw = fence?.[1] ?? reply.match(/\{[\s\S]*\}\s*$/)?.[0];
  const text = (fence ? reply.replace(fence[0], "") : raw ? reply.replace(raw, "") : reply).trim();
  if (!raw) return { text, intent: NO_INTENT };
  try {
    const parsed = intentSchema.safeParse(JSON.parse(raw));
    return { text, intent: parsed.success ? parsed.data : NO_INTENT };
  } catch {
    return { text, intent: NO_INTENT };
  }
}
