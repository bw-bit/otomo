import { it, expect, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDb, type Companion } from "@/lib/db";
import { openAiCompatibleChat, companionSystemPrompt, personalitySchema } from "@/lib/llm";
import { parseIntent } from "@/lib/intent";
import { createPendingAction, handleAuthCallback, startAuthFlow } from "@/lib/approval";
import { executeApprovedAction } from "@/lib/actions";
import { resolveName } from "@/lib/chain";
import { acceptWork, deliverWork, reviewWork } from "@/lib/work";
import { reputationSnapshot } from "@/lib/reputation";

vi.mock("server-only", () => ({}));

// Opt-in integration rehearsal: real model + read-only ENS, isolated fixture DB,
// explicitly simulated identity approval. Never signs or sends a chain transaction.
it.skipIf(process.env.RUN_LIVE_WORK_DEMO !== "1")("rehearses a useful bilingual job through delivery and payment preparation", async () => {
  const file = process.env.WORK_DEMO_DB;
  const output = process.env.WORK_DEMO_OUTPUT;
  if (!file || !path.isAbsolute(file) || !output || !path.isAbsolute(output)) throw Error("Explicit local fixture/output paths required");
  const db = await openDb(`file:${file}`);
  try {
    const soraAddress = await resolveName("sora.otomo.eth");
    const taroAddress = await resolveName("taro.otomo.eth");
    expect(soraAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(taroAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    for (const [label, owner] of [["sora", soraAddress], ["taro", taroAddress]] as const) {
      await db.execute({ sql: "UPDATE companions SET owner=?,agent_sub='local-demo-human' WHERE label=?", args: [owner!, label] });
    }
    const sora = (await db.execute("SELECT * FROM companions WHERE label='sora'")).rows[0] as unknown as Companion;
    const task = "Write a 45–65 word English Otomo introduction, a natural Japanese version, and 3 short demo steps. Facts: World ID verifies the HUMAN OWNER at signup; sora and taro share that owner. ENS names identify companions. sora asks taro to write text; the owner reviews delivery and separately approves a 2 mUSDC testnet reward. Say this is a testnet demo. Do not claim agents are human, independently World-ID-verified, fully autonomous, or guaranteed safe/profitable.";
    const user = `Please ask taro.otomo.eth to do this job for 2 USDC: ${task}`;
    const started = Date.now();
    const reply = await openAiCompatibleChat([
      { role: "system", content: companionSystemPrompt("sora", sora.full_name, personalitySchema.parse(JSON.parse(sora.personality)), "personal") },
      { role: "user", content: user },
    ]);
    const parsed = parseIntent(reply);
    expect(parsed.intent.type).toBe("request_friend");
    if (parsed.intent.type !== "request_friend") throw Error("Model did not prepare the requested job");
    expect(parsed.intent.friend).toBe("taro.otomo.eth");
    expect(parsed.intent.rewardUsdc).toBe(2);
    const action = await createPendingAction(db, { companion: "sora", intent: parsed.intent, resolvedTo: taroAddress!, amountUsdc: 2, now: Date.now() });
    const flow = await startAuthFlow(db, { kind: "approve", ref: action.id, now: Date.now() });
    const approval = await handleAuthCallback({ state: flow.state, code: "local-fixture-only", error: null, now: Date.now() }, {
      db,
      authenticate: async () => ({ sub: "local-demo-human", authTime: Math.ceil(Date.now() / 1000) }),
      execute: (a, c) => executeApprovedAction(db, a, c),
    });
    expect(approval.ok).toBe(true);
    const request = (await db.execute("SELECT * FROM friend_requests WHERE from_label='sora' AND to_label='taro' ORDER BY created_at DESC LIMIT 1")).rows[0];
    const id = String(request.id);
    await acceptWork(db, id, "taro");
    await deliverWork(db, id, "taro", openAiCompatibleChat);
    const delivery = (await db.execute({ sql: "SELECT content FROM work_deliveries WHERE request_id=?", args: [id] })).rows[0];
    expect(String(delivery.content).length).toBeGreaterThan(150);
    expect(String(delivery.content)).toMatch(/[ぁ-んァ-ン]/);
    expect(String(delivery.content)).toMatch(/World ID|Otomo/);
    const rewardId = await reviewWork(db, id, "sora");
    const reward = (await db.execute({ sql: "SELECT status,amount_usdc,tx_hash FROM pending_actions WHERE id=?", args: [rewardId!] })).rows[0];
    expect(reward).toMatchObject({ status: "pending", amount_usdc: 2, tx_hash: null });
    await expect(reviewWork(db, id, "sora")).rejects.toThrow();
    const reputation = await reputationSnapshot(db, "taro");
    expect(reputation.delivered).toBeGreaterThan(0);
    expect(reputation.reviewed).toBeGreaterThan(0);
    for (const [role, content] of [["user", user], ["assistant", parsed.text]] as const) await db.execute({ sql: "INSERT INTO messages(companion,role,content,created_at) VALUES('sora',?,?,?)", args: [role, content, Date.now()] });
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "work-demo.json"), JSON.stringify({ passed: true, scope: "Local isolated database; real LLM and ENS reads; simulated identity approval; no payment sent", elapsedMs: Date.now() - started, request: { id, task: request.task, rewardUsdc: request.reward_usdc }, assistant: parsed.text, delivery: delivery.content, states: ["open", "accepted", "working", "delivered", "done"], payment: reward, reputation }, null, 2));
  } finally { db.close(); }
}, 180_000);
