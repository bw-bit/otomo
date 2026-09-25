import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db, type PendingAction } from "@/lib/db";
import { createPendingAction, handleAuthCallback, startAuthFlow, type CallbackDeps } from "@/lib/approval";
import { APPROVAL_TTL_MS } from "@/lib/policy";

const T0 = 1_800_000_000_000;
let db: Db;

function seedCompanion(sub: string | null = "sub-owner") {
  db.prepare(`INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)`).run("taro", "taro.otomo.eth", "0xowner", "0xres", "{}", "n1", sub, T0);
}

function setup(authTimeSec = Math.floor(T0 / 1000) + 10, sub = "sub-owner") {
  const action = createPendingAction(db, { companion: "taro", intent: { type: "private_task", summary: "s" }, amountUsdc: 0, now: T0 });
  const flow = startAuthFlow(db, { kind: "approve", ref: action.id, now: T0 });
  const execute = vi.fn(async () => ({ txHash: "0xtx" }));
  const deps: CallbackDeps = { db, authenticate: vi.fn(async () => ({ sub, authTime: authTimeSec })), execute };
  return { action, flow, execute, deps };
}
const statusOf = (id: string) => (db.prepare(`SELECT * FROM pending_actions WHERE id = ?`).get(id) as PendingAction).status;

beforeEach(() => {
  db = openDb(":memory:");
  seedCompanion();
});

describe("approval callback", () => {
  it("executes exactly once after a fresh, matching verification", async () => {
    const { action, flow, execute, deps } = setup();
    const r = await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps);
    expect(r).toMatchObject({ ok: true, kind: "approve", txHash: "0xtx" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(statusOf(action.id)).toBe("executed");
    // Replaying the same state must not execute again.
    const again = await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 2000 }, deps);
    expect(again.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not execute when the user cancels at the IdP", async () => {
    const { action, flow, execute, deps } = setup();
    const r = await handleAuthCallback({ state: flow.state, code: null, error: "access_denied", now: T0 + 1000 }, deps);
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(statusOf(action.id)).toBe("rejected");
  });

  it("does not execute after the 5 minute window", async () => {
    const { action, flow, execute, deps } = setup();
    const r = await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + APPROVAL_TTL_MS + 1 }, deps);
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(statusOf(action.id)).toBe("expired");
  });

  it("does not execute when a different human approves", async () => {
    const { action, flow, execute, deps } = setup(undefined, "sub-stranger");
    expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(statusOf(action.id)).toBe("rejected");
  });

  it("does not execute on a stale authentication (auth_time before the request)", async () => {
    const { flow, execute, deps } = setup(Math.floor(T0 / 1000) - 60);
    expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute on unknown state or token verification failure", async () => {
    const { action, flow, execute, deps } = setup();
    expect((await handleAuthCallback({ state: "forged", code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    deps.authenticate = vi.fn(async () => { throw new Error("nonce mismatch"); });
    expect((await handleAuthCallback({ state: flow.state, code: "c", error: null, now: T0 + 1000 }, deps)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(statusOf(action.id)).toBe("rejected");
  });

  it("binds the World ID subject once and refuses to rebind", async () => {
    db.prepare(`UPDATE companions SET agent_sub = NULL`).run();
    const deps: CallbackDeps = { db, authenticate: async () => ({ sub: "sub-a", authTime: T0 / 1000 }), execute: vi.fn() };
    const f1 = startAuthFlow(db, { kind: "bind", ref: "taro", now: T0 });
    expect(await handleAuthCallback({ state: f1.state, code: "c", error: null, now: T0 }, deps)).toMatchObject({ ok: true, kind: "bind" });
    const f2 = startAuthFlow(db, { kind: "bind", ref: "taro", now: T0 });
    deps.authenticate = async () => ({ sub: "sub-b", authTime: T0 / 1000 });
    expect((await handleAuthCallback({ state: f2.state, code: "c", error: null, now: T0 }, deps)).ok).toBe(false);
    expect((db.prepare(`SELECT agent_sub FROM companions`).get() as { agent_sub: string }).agent_sub).toBe("sub-a");
  });
});
