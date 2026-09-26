import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  readSession: vi.fn(),
  hasCompanionWallet: vi.fn(),
  fundDemoStrategy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({ SESSION_COOKIE: "session", readSession: mocks.readSession }));
vi.mock("@/lib/companion-wallet", () => ({ hasCompanionWallet: mocks.hasCompanionWallet }));
vi.mock("@/lib/aqua", () => ({
  agentDemoSwapWithResult: vi.fn(),
  confirmDock: vi.fn(),
  confirmShip: vi.fn(),
  fundDemoStrategy: mocks.fundDemoStrategy,
}));
vi.mock("@/lib/approval", () => ({ createPendingAction: vi.fn() }));

import { POST } from "@/app/api/strategies/[id]/route";

const db = { execute: vi.fn() };
const readyStrategy = {
  id: "strategy-1",
  companion: "sora",
  action_id: "action-1",
  maker: "0x00000000000000000000000000000000000000aa",
  router: "0x00000000000000000000000000000000000000b1",
  strategy: "0xdeadbeef",
  strategy_hash: null,
  usdc_amount: 10,
  weth_amount: 0.005,
  deadline: 1_900_000_000,
  status: "ready",
  ship_tx: null,
  dock_tx: null,
  created_at: 1,
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/strategies/strategy-1", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "session=signed" },
    body: JSON.stringify(body),
  });
}

describe("strategy fund_demo endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSession.mockReturnValue("sora");
    mocks.getDb.mockResolvedValue(db);
    db.execute.mockResolvedValue({ rows: [readyStrategy] });
    mocks.hasCompanionWallet.mockResolvedValue(true);
    mocks.fundDemoStrategy.mockResolvedValue({ chainId: 11155111, txHashes: { usdc: null, weth: null } });
  });

  it("funds only after an authenticated owner's explicit fund_demo POST", async () => {
    const response = await POST(request({ event: "fund_demo" }), { params: Promise.resolve({ id: "strategy-1" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, chainId: 11155111 });
    expect(mocks.fundDemoStrategy).toHaveBeenCalledWith(db, "sora", readyStrategy);
  });

  it("requires a signed-in managed companion and a ready strategy", async () => {
    mocks.readSession.mockReturnValueOnce(null);
    const anonymous = await POST(request({ event: "fund_demo" }), { params: Promise.resolve({ id: "strategy-1" }) });
    expect(anonymous.status).toBe(401);

    mocks.hasCompanionWallet.mockResolvedValueOnce(false);
    const unmanaged = await POST(request({ event: "fund_demo" }), { params: Promise.resolve({ id: "strategy-1" }) });
    expect(unmanaged.status).toBe(403);

    db.execute.mockResolvedValueOnce({ rows: [{ ...readyStrategy, status: "shipped" }] });
    const shipped = await POST(request({ event: "fund_demo" }), { params: Promise.resolve({ id: "strategy-1" }) });
    expect(shipped.status).toBe(409);
    expect(mocks.fundDemoStrategy).not.toHaveBeenCalled();
  });
});
