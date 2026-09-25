import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type Db, type PendingAction } from "@/lib/db";
import { createPendingAction, handleAuthCallback, startAuthFlow, type CallbackDeps } from "@/lib/approval";
import { APPROVAL_TTL_MS } from "@/lib/policy";

const T0 = 1_800_000_000_000;
let db: Db;
let dir: string;

async function seedCompanion(sub: string | null = "sub-owner") {
  await db.execute({ sql: `INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)`, args: ["taro", "taro.otomo.eth", "0xowner", "0xres", "{}", "n1", sub, T0] });
}

async function setup(authTimeSec = Math.floor(T0 / 1000) + 10, sub = "sub-owner") {
  const action = await createPendingAction(db, { companion: "taro", intent: { type: "private_task", summary: "s" }, amountUsdc: 0, now: T0 });
  const flow = await startAuthFlow(db, { kind: "approve", ref: action.id, now: T0 });
  const execute = vi.fn(async () => ({ txHash: "0xtx" }));
  const deps: CallbackDeps = { db, authenticate: vi.fn(async () => ({ sub, authTime: authTimeSec })), execute };
  return { action, flow, execute, deps };
}
const statusOf = async (id: string) => ((await db.execute({ sql: `SELECT * FROM pending_actions WHERE id = ?`, args: [id] })).rows[0] as unknown as PendingAction).status;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otomo-approval-"));
  db = await openDb(`file:${path.join(dir, "test.db")}`);
  await seedCompanion();
});
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });

describe("approval callback", () => {
  it("executes exactly once after a fresh, matching verification", async () => {
    const { action, flow, execute, deps } = await setup();
    const r = await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps);
    expect(r).toMatchObject({ ok: true, kind: "approve", txHash: "0xtx" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await statusOf(action.id)).toBe("executed");
    // Replaying the same state must not execute again.
    const again = await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 2000 }, deps);
    expect(again.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("consumes state across separate connections to the same persistent database", async () => {
    const { flow, execute, deps } = await setup();
    const other = await openDb(`file:${path.join(dir, "test.db")}`);
    try {
      const secondDeps = { ...deps, db: other };
      expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, secondDeps)).ok).toBe(true);
      expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1001 }, deps)).ok).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      other.close();
    }
  });

  it("does not execute when the user cancels at the IdP", async () => {
    const { action, flow, execute, deps } = await setup();
    const r = await handleAuthCallback({ state: flow.state, code: null, error: "access_denied", now: T0 + 1000 }, deps);
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(await statusOf(action.id)).toBe("rejected");
  });

  it("does not execute after the 5 minute window", async () => {
    const { action, flow, execute, deps } = await setup();
    const r = await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + APPROVAL_TTL_MS + 1 }, deps);
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(await statusOf(action.id)).toBe("expired");
  });

  it("does not execute when a different human approves", async () => {
    const { action, flow, execute, deps } = await setup(undefined, "sub-stranger");
    expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(await statusOf(action.id)).toBe("rejected");
  });

  it("does not execute on a stale authentication (auth_time before the request)", async () => {
    const { flow, execute, deps } = await setup(Math.floor(T0 / 1000) - 60);
    expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute on unknown state or token verification failure", async () => {
    const { action, flow, execute, deps } = await setup();
    expect((await handleAuthCallback({ state: "forged", code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    deps.authenticate = vi.fn(async () => { throw new Error("nonce mismatch"); });
    expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(await statusOf(action.id)).toBe("rejected");
  });

  it("binds the World ID subject once and refuses to rebind", async () => {
    await db.execute(`UPDATE companions SET agent_sub = NULL`);
    const deps: CallbackDeps = { db, authenticate: async () => ({ sub: "sub-a", authTime: T0 / 1000 }), execute: vi.fn() };
    const f1 = await startAuthFlow(db, { kind: "bind", ref: "taro", now: T0 });
    expect(await handleAuthCallback({ state: f1.state, code: "c", error: null, now: T0 }, deps)).toMatchObject({ ok: true, kind: "bind" });
    const f2 = await startAuthFlow(db, { kind: "bind", ref: "taro", now: T0 });
    deps.authenticate = async () => ({ sub: "sub-b", authTime: T0 / 1000 });
    expect((await handleAuthCallback({ state: f2.state, code: "c", error: null, now: T0 }, deps)).ok).toBe(false);
    expect((await db.execute(`SELECT agent_sub FROM companions`)).rows[0].agent_sub).toBe("sub-a");
  });
});
