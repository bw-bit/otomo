import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/aqua", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aqua")>();
  return {
    ...actual,
    planStrategy: vi.fn(async () => ({
      router: "0x00000000000000000000000000000000000000bb" as never,
      strategy: "0xdeadbeef" as never,
      deadline: 1_900_000_000,
      usdcAmount: 100,
      wethAmount: 0.025,
    })),
  };
});

import { parseIntent } from "@/lib/intent";
import { openDb, type Companion, type Db, type PendingAction, type Strategy } from "@/lib/db";
import { executeApprovedAction } from "@/lib/actions";
import { computeStrategyHash, planStrategy } from "@/lib/aqua";

const T0 = 1_800_000_000_000;
let db: Db;
let dir: string;

const companion: Companion = {
  label: "taro", full_name: "taro.otomo.eth", owner: "0x00000000000000000000000000000000000000aa",
  resolver: "0xres", personality: "{}", world_nullifier: "n1", agent_sub: "sub", created_at: T0, human: "n1", role: "personal",
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otomo-grow-"));
  db = await openDb(`file:${path.join(dir, "test.db")}`);
});
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });

describe("grow_savings intent", () => {
  it("parses with defaults and explicit days", () => {
    const r = parseIntent('OK\n```json\n{"type":"grow_savings","amountUsdc":100}\n```');
    expect(r.intent).toEqual({ type: "grow_savings", amountUsdc: 100, days: 7 });
    expect(parseIntent('```json\n{"type":"grow_savings","amountUsdc":50,"days":14}\n```').intent)
      .toEqual({ type: "grow_savings", amountUsdc: 50, days: 14 });
  });
  it("rejects invalid amounts and day ranges", () => {
    for (const raw of [
      '{"type":"grow_savings","amountUsdc":0}',
      '{"type":"grow_savings","amountUsdc":-5}',
      '{"type":"grow_savings","amountUsdc":10001}',
      '{"type":"grow_savings","amountUsdc":10,"days":0}',
      '{"type":"grow_savings","amountUsdc":10,"days":31}',
      '{"type":"grow_savings","amountUsdc":10,"days":1.5}',
    ]) {
      expect(parseIntent(`\`\`\`json\n${raw}\n\`\`\``).intent, raw).toEqual({ type: "none" });
    }
  });
});

describe("executeApprovedAction grow_savings", () => {
  it("stores a ready strategy without touching the chain", async () => {
    const action = {
      id: "a1", companion: "taro",
      intent: JSON.stringify({ type: "grow_savings", amountUsdc: 100, days: 10 }),
      resolved_to: null, amount_usdc: 100, status: "pending", reason: null,
      tx_hash: null, created_at: T0, expires_at: T0 + 300_000,
    } as PendingAction;
    const r = await executeApprovedAction(db, action, companion);
    expect(r).toEqual({});
    expect(planStrategy).toHaveBeenCalledWith({ maker: companion.owner, amountUsdc: 100, days: 10 });

    const row = (await db.execute(`SELECT * FROM strategies`)).rows[0] as unknown as Strategy;
    expect(row.status).toBe("ready");
    expect(row.action_id).toBe("a1");
    expect(row.maker).toBe(companion.owner);
    expect(row.strategy).toBe("0xdeadbeef");
    expect(row.usdc_amount).toBe(100);
    expect(row.weth_amount).toBe(0.025);
    expect(row.deadline).toBe(1_900_000_000);
    expect(row.strategy_hash).toBeNull();
  });
});

describe("computeStrategyHash", () => {
  it("matches Aqua's keccak256(strategy) (cast keccak vector)", () => {
    expect(computeStrategyHash("0x")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(computeStrategyHash("0x00000000000000000000000094d0664b249d23286d62f2dd2d21f739b3707f65"))
      .toBe("0xc263eea29f51de45a50e2fa8e977290178ae286ef458c11a39db5d73d404e5c5");
  });
});
