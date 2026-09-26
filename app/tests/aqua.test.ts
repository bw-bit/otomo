import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Address, type Hex, type Log } from "viem";

const mocks = vi.hoisted(() => ({
  publicClient: vi.fn(),
  walletFor: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getChainId: vi.fn(),
  getBytecode: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  companionWallet: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  requireEnv: () => ({
    AQUA_ADDRESS: "0x00000000000000000000000000000000000000a1",
    AQUA_ROUTER_ADDRESS: "0x00000000000000000000000000000000000000b1",
    OTOMO_ORDER_BUILDER_ADDRESS: "0x00000000000000000000000000000000000000c1",
    MOCK_WETH_ADDRESS: "0xf7A9C97d0DC45A13cd7e3E17406fA61CA72d66FA",
  }),
}));
vi.mock("@/lib/chain", () => ({
  USDC_DECIMALS: 6,
  publicClient: mocks.publicClient,
  walletFor: mocks.walletFor,
}));
vi.mock("@/lib/ens", () => ({
  ENS_SEPOLIA: { mockUsdc: "0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e" },
  erc20Abi: [],
}));
vi.mock("@/lib/companion-wallet", () => ({ companionWallet: mocks.companionWallet }));

import { aquaAbi } from "@/lib/aquaAbi";
import { computeStrategyHash, confirmDock, confirmShip, fundDemoStrategy, shipTxParams } from "@/lib/aqua";

const AQUA = "0x00000000000000000000000000000000000000a1" as Address;
const ROUTER = "0x00000000000000000000000000000000000000b1" as Address;
const MAKER = "0x00000000000000000000000000000000000000aa" as Address;
const OTHER = "0x00000000000000000000000000000000000000ab" as Address;
const USDC = "0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e" as Address;
const WETH = "0xf7A9C97d0DC45A13cd7e3E17406fA61CA72d66FA" as Address;
const TX_HASH = `0x${"11".repeat(32)}` as Hex;
const STRATEGY = "0xdeadbeef" as Hex;
const STRATEGY_HASH = computeStrategyHash(STRATEGY);

function eventLog(eventName: "Shipped" | "Docked", maker = MAKER, app = ROUTER, strategyHash = STRATEGY_HASH): Log {
  const topics = encodeEventTopics({ abi: aquaAbi, eventName });
  const data = eventName === "Shipped"
    ? encodeAbiParameters(parseAbiParameters("address maker, address app, bytes32 strategyHash, bytes strategy"), [maker, app, strategyHash, STRATEGY])
    : encodeAbiParameters(parseAbiParameters("address maker, address app, bytes32 strategyHash"), [maker, app, strategyHash]);
  return {
    address: AQUA,
    topics,
    data,
    blockHash: `0x${"22".repeat(32)}`,
    blockNumber: 1n,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as Log;
}

const row = {
  id: "strategy-1",
  companion: "sora",
  action_id: "action-1",
  maker: MAKER,
  router: ROUTER,
  strategy: STRATEGY,
  strategy_hash: STRATEGY_HASH,
  usdc_amount: 10,
  weth_amount: 0.005,
  deadline: 1_900_000_000,
  status: "shipped" as const,
  ship_tx: TX_HASH,
  dock_tx: null,
  created_at: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicClient.mockReturnValue({
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    getChainId: mocks.getChainId,
    getBytecode: mocks.getBytecode,
    readContract: mocks.readContract,
    simulateContract: mocks.simulateContract,
  });
  mocks.getChainId.mockResolvedValue(11155111);
  mocks.getBytecode.mockResolvedValue("0x6000");
  mocks.simulateContract.mockImplementation(async (request: unknown) => ({ request }));
  mocks.companionWallet.mockResolvedValue({ account: { address: MAKER }, writeContract: mocks.writeContract });
  mocks.waitForTransactionReceipt.mockResolvedValue({
    status: "success",
    to: AQUA,
    from: MAKER,
    logs: [eventLog("Shipped")],
  });
});

describe("Aqua transaction boundaries", () => {
  it("prepares exact mUSDC/mWETH amounts and Aqua allowances", () => {
    const ship = shipTxParams({ ...row, status: "ready", strategy_hash: null });
    expect(ship.amounts).toEqual(["10000000", "5000000000000000"]);
    expect(ship.tokens).toEqual([
      USDC,
      WETH,
    ]);
    expect(ship.approvals).toEqual([
      { token: ship.tokens[0], spender: AQUA, amount: ship.amounts[0] },
      { token: ship.tokens[1], spender: AQUA, amount: ship.amounts[1] },
    ]);
  });

  it("mints only missing fixed-token amounts to the authenticated companion wallet", async () => {
    const balances = new Map<string, bigint>([[USDC.toLowerCase(), 3_000_000n], [WETH.toLowerCase(), 2_000_000_000_000_000n]]);
    mocks.readContract.mockImplementation(async ({ address, functionName, args }: any) => {
      if (functionName === "decimals") return address.toLowerCase() === USDC.toLowerCase() ? 6 : 18;
      if (functionName === "symbol") return address.toLowerCase() === USDC.toLowerCase() ? "USDC" : "mWETH";
      if (functionName === "balanceOf") return balances.get(address.toLowerCase()) ?? 0n;
      throw new Error(`unexpected read ${functionName}`);
    });
    let nonce = 0;
    mocks.writeContract.mockImplementation(async (request: any) => {
      balances.set(request.address.toLowerCase(), (balances.get(request.address.toLowerCase()) ?? 0n) + request.args[1]);
      nonce += 1;
      return `0x${String(nonce).padStart(64, "0")}`;
    });
    const fundStrategy = encodeAbiParameters([
      { type: "tuple", components: [
        { name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" },
      ] },
    ], [{ maker: MAKER, traits: 0n, data: "0x" }]);
    const ready = { ...row, strategy: fundStrategy, strategy_hash: null, status: "ready" as const };

    const result = await fundDemoStrategy({} as never, "sora", ready);

    expect(mocks.companionWallet).toHaveBeenCalledWith({}, "sora");
    expect(mocks.simulateContract).toHaveBeenCalledTimes(2);
    expect(mocks.writeContract).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      account: MAKER,
      chainId: 11155111,
      missingBefore: { usdc: 7, weth: 0.003 },
      minted: { usdc: 7, weth: 0.003 },
      txHashes: { usdc: `0x${"0".repeat(63)}1`, weth: `0x${"0".repeat(63)}2` },
      before: { usdc: 3, weth: 0.002 },
      after: { usdc: 10, weth: 0.005 },
    });
    expect(mocks.simulateContract.mock.calls.map(([call]) => [call.address, call.args])).toEqual([
      [USDC, [MAKER, 7_000_000n]],
      [WETH, [MAKER, 3_000_000_000_000_000n]],
    ]);
    expect(mocks.writeContract.mock.calls.map(([call]) => call.account)).toEqual([
      { address: MAKER },
      { address: MAKER },
    ]);
  });

  it("rejects another chain, a different companion wallet, and over-cap or unbalanced plans before minting", async () => {
    const fundStrategy = encodeAbiParameters([
      { type: "tuple", components: [
        { name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" },
      ] },
    ], [{ maker: MAKER, traits: 0n, data: "0x" }]);
    const ready = { ...row, strategy: fundStrategy, strategy_hash: null, status: "ready" as const };
    mocks.getChainId.mockResolvedValueOnce(1);
    await expect(fundDemoStrategy({} as never, "sora", ready)).rejects.toThrow("Sepolia chain 11155111");
    expect(mocks.companionWallet).not.toHaveBeenCalled();

    mocks.companionWallet.mockResolvedValueOnce({ account: { address: OTHER }, writeContract: mocks.writeContract });
    mocks.readContract.mockImplementation(async ({ functionName, address }: any) => functionName === "decimals"
      ? address.toLowerCase() === USDC.toLowerCase() ? 6 : 18
      : functionName === "symbol" ? address.toLowerCase() === USDC.toLowerCase() ? "USDC" : "mWETH" : 0n);
    await expect(fundDemoStrategy({} as never, "sora", ready)).rejects.toThrow("Companion wallet does not own this strategy");

    await expect(fundDemoStrategy({} as never, "sora", { ...ready, usdc_amount: 20.000001, weth_amount: 0.0100000005 }))
      .rejects.toThrow("20 mUSDC-equivalent demo cap");
    await expect(fundDemoStrategy({} as never, "sora", { ...ready, weth_amount: 0.004 }))
      .rejects.toThrow("not equal-value");
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("accepts ship only when maker, router, sender, and strategy hash all match", async () => {
    await expect(confirmShip(row, TX_HASH)).resolves.toBe(STRATEGY_HASH);

    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "success", to: AQUA, from: MAKER, logs: [eventLog("Shipped", MAKER, OTHER)],
    });
    await expect(confirmShip(row, TX_HASH)).rejects.toThrow("router does not match");

    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "success", to: AQUA, from: MAKER, logs: [eventLog("Shipped", MAKER, ROUTER, `0x${"33".repeat(32)}` as Hex)],
    });
    await expect(confirmShip(row, TX_HASH)).rejects.toThrow("strategyHash does not match");
  });

  it("accepts dock only for the same maker, router, sender, and shipped hash", async () => {
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "success", to: AQUA, from: MAKER, logs: [eventLog("Docked")],
    });
    await expect(confirmDock(row, TX_HASH)).resolves.toBeUndefined();

    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "success", to: AQUA, from: MAKER, logs: [eventLog("Docked", MAKER, OTHER)],
    });
    await expect(confirmDock(row, TX_HASH)).rejects.toThrow("router does not match");
  });
});
