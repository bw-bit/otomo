import "server-only";
import { randomBytes } from "node:crypto";
import {
  decodeAbiParameters,
  formatUnits,
  keccak256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { requireEnv } from "./env";
import { publicClient, walletFor, USDC_DECIMALS } from "./chain";
import { ENS_SEPOLIA, erc20Abi } from "./ens";
import { aquaAbi, orderBuilderAbi, swapVmAbi } from "./aquaAbi";
import type { Strategy, Db, Companion } from "./db";
import { companionWallet } from "./companion-wallet";

export const WETH_DECIMALS = 18;
/** Sepolia mocks have no market price; the demo seeds the pair at a fixed 2000 USDC per WETH. */
export const MOCK_WETH_USDC_RATE = 2000;
/** 0.3% flat fee on amountIn — FeeArgsBuilder.buildFlatFee, 1e9 = 100% (swap-vm). */
export const SWAPVM_FEE_BPS = 3_000_000;
/** Demo swap size: the agent sells 0.01 mWETH for mUSDC. */
export const DEMO_SWAP_WETH_IN = "0.01";

export interface SwapVmOrder {
  maker: Address;
  traits: bigint;
  data: Hex;
}

export interface AquaEnv {
  aqua: Address;
  router: Address;
  orderBuilder: Address;
  weth: Address;
  usdc: Address;
}

function aquaEnv(): AquaEnv {
  const e = requireEnv("AQUA_ADDRESS", "AQUA_ROUTER_ADDRESS", "OTOMO_ORDER_BUILDER_ADDRESS", "MOCK_WETH_ADDRESS");
  return {
    aqua: e.AQUA_ADDRESS as Address,
    router: e.AQUA_ROUTER_ADDRESS as Address,
    orderBuilder: e.OTOMO_ORDER_BUILDER_ADDRESS as Address,
    weth: e.MOCK_WETH_ADDRESS as Address,
    usdc: ENS_SEPOLIA.mockUsdc,
  };
}

const ORDER_TUPLE = {
  type: "tuple",
  components: [
    { name: "maker", type: "address" },
    { name: "traits", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

export function decodeStrategy(strategy: Hex): SwapVmOrder {
  const [order] = decodeAbiParameters([ORDER_TUPLE], strategy);
  return order;
}

/** Aqua's ship() computes strategyHash = keccak256(abi.encode(order)) — verified against the contract in OtomoOrderBuilder.t.sol. */
export const computeStrategyHash = (strategy: Hex): Hex => keccak256(strategy);

const humanAmount = (amount: number, decimals: number) => parseUnits(String(amount), decimals);

export interface StrategyPlan {
  router: Address;
  strategy: Hex;
  deadline: number;
  usdcAmount: number;
  wethAmount: number;
}

/** Builds the Aqua order on-chain via OtomoOrderBuilder (no trait packing in TS). */
export async function planStrategy(p: { maker: Address; amountUsdc: number; days: number }): Promise<StrategyPlan> {
  const env = aquaEnv();
  const deadline = Math.floor(Date.now() / 1000) + p.days * 24 * 3600;
  const salt = BigInt(`0x${randomBytes(16).toString("hex")}`);
  const [, strategy] = await publicClient().readContract({
    address: env.orderBuilder,
    abi: orderBuilderAbi,
    functionName: "buildOrder",
    args: [p.maker, deadline, SWAPVM_FEE_BPS, salt],
  });
  return {
    router: env.router,
    strategy,
    deadline,
    usdcAmount: p.amountUsdc,
    // Seed the WETH leg at half the USDC leg's notional at the fixed mock rate.
    wethAmount: p.amountUsdc / (MOCK_WETH_USDC_RATE * 2),
  };
}

export interface ShipTxParams {
  aqua: Address;
  router: Address;
  tokens: [Address, Address];
  /** Raw (smallest-unit) amounts as decimal strings — BigInt() them client-side. */
  amounts: [string, string];
  strategy: Hex;
  approvals: { token: Address; spender: Address; amount: string }[];
}

export function shipTxParams(row: Strategy): ShipTxParams {
  const env = aquaEnv();
  const amounts: [string, string] = [
    humanAmount(row.usdc_amount, USDC_DECIMALS).toString(),
    humanAmount(row.weth_amount, WETH_DECIMALS).toString(),
  ];
  return {
    aqua: env.aqua,
    router: row.router as Address,
    tokens: [env.usdc, env.weth],
    amounts,
    strategy: row.strategy as Hex,
    approvals: [
      { token: env.usdc, spender: env.aqua, amount: amounts[0] },
      { token: env.weth, spender: env.aqua, amount: amounts[1] },
    ],
  };
}

async function confirmAquaTx(txHash: Hex, expectedEvent: "Shipped" | "Docked"): Promise<{ strategyHash: Hex; from: Address }> {
  const env = aquaEnv();
  const client = publicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${txHash}`);
  if (receipt.to?.toLowerCase() !== env.aqua.toLowerCase()) throw new Error("transaction is not addressed to Aqua");
  const [log] = parseEventLogs({ abi: aquaAbi, eventName: expectedEvent, logs: receipt.logs });
  if (!log) throw new Error(`${expectedEvent} event not found in ${txHash}`);
  return { strategyHash: log.args.strategyHash, from: receipt.from };
}

/** Verifies a user's ship tx and returns the on-chain strategy hash. */
export async function confirmShip(row: Strategy, txHash: Hex): Promise<Hex> {
  const { strategyHash, from } = await confirmAquaTx(txHash, "Shipped");
  if (from.toLowerCase() !== row.maker.toLowerCase()) throw new Error("ship was not sent by the maker wallet");
  if (strategyHash !== computeStrategyHash(row.strategy as Hex)) throw new Error("Shipped strategyHash does not match the stored strategy");
  return strategyHash;
}

/** Verifies a user's dock tx against the stored strategy hash. */
export async function confirmDock(row: Strategy, txHash: Hex): Promise<void> {
  const { strategyHash, from } = await confirmAquaTx(txHash, "Docked");
  if (from.toLowerCase() !== row.maker.toLowerCase()) throw new Error("dock was not sent by the maker wallet");
  if (!row.strategy_hash || strategyHash !== row.strategy_hash) throw new Error("Docked strategyHash does not match");
}

export interface Balances {
  usdc: number;
  weth: number;
}

export async function virtualBalances(row: Strategy): Promise<Balances> {
  if (!row.strategy_hash) throw new Error("strategy has not shipped yet");
  const env = aquaEnv();
  const client = publicClient();
  const [usdc, weth] = await Promise.all([
    client.readContract({ address: env.aqua, abi: aquaAbi, functionName: "rawBalances",
      args: [row.maker as Address, row.router as Address, row.strategy_hash as Hex, env.usdc] }),
    client.readContract({ address: env.aqua, abi: aquaAbi, functionName: "rawBalances",
      args: [row.maker as Address, row.router as Address, row.strategy_hash as Hex, env.weth] }),
  ]);
  return {
    usdc: Number(formatUnits(usdc[0], USDC_DECIMALS)),
    weth: Number(formatUnits(weth[0], WETH_DECIMALS)),
  };
}

export async function walletBalances(maker: Address): Promise<Balances> {
  const env = aquaEnv();
  const client = publicClient();
  const [usdc, weth] = await Promise.all([
    client.readContract({ address: env.usdc, abi: erc20Abi, functionName: "balanceOf", args: [maker] }),
    client.readContract({ address: env.weth, abi: erc20Abi, functionName: "balanceOf", args: [maker] }),
  ]);
  return {
    usdc: Number(formatUnits(usdc, USDC_DECIMALS)),
    weth: Number(formatUnits(weth, WETH_DECIMALS)),
  };
}

/** Agent key acts as a third-party taker: swaps DEMO_SWAP_WETH_IN mWETH -> mUSDC against the shipped strategy. */
export async function agentDemoSwap(row: Strategy): Promise<Hex> {
  const env = aquaEnv();
  const client = publicClient();
  const agent = walletFor("AGENT_PRIVATE_KEY");
  const taker = agent.account.address;
  if (taker.toLowerCase() === row.maker.toLowerCase()) throw new Error("Maker and demo taker must be separate wallets");
  const order = decodeStrategy(row.strategy as Hex);
  const amountIn = parseUnits(DEMO_SWAP_WETH_IN, WETH_DECIMALS);

  // MockERC20.mint is permissionless — top the agent up if needed.
  const bal = await client.readContract({ address: env.weth, abi: erc20Abi, functionName: "balanceOf", args: [taker] });
  if (bal < amountIn) {
    const mintTx = await agent.writeContract({ address: env.weth, abi: erc20Abi, functionName: "mint", args: [taker, parseUnits("0.05", WETH_DECIMALS)] });
    const r = await client.waitForTransactionReceipt({ hash: mintTx });
    if (r.status !== "success") throw new Error(`mint reverted: ${mintTx}`);
  }
  const allowance = await client.readContract({ address: env.weth, abi: erc20Abi, functionName: "allowance", args: [taker, env.router] });
  if (allowance < amountIn) {
    const approveTx = await agent.writeContract({ address: env.weth, abi: erc20Abi, functionName: "approve", args: [env.router, amountIn] });
    const r = await client.waitForTransactionReceipt({ hash: approveTx });
    if (r.status !== "success") throw new Error(`approve reverted: ${approveTx}`);
  }

  const quoteData = await client.readContract({
    address: env.orderBuilder, abi: orderBuilderAbi, functionName: "buildTakerData", args: [taker, 0n],
  });
  const [, amountOut] = await client.readContract({
    address: env.router, abi: swapVmAbi, functionName: "quote",
    args: [order, env.weth, env.usdc, amountIn, quoteData],
  });
  const takerData = await client.readContract({
    address: env.orderBuilder, abi: orderBuilderAbi, functionName: "buildTakerData", args: [taker, (amountOut * 99n) / 100n],
  });
  const hash = await agent.writeContract({
    address: env.router, abi: swapVmAbi, functionName: "swap",
    args: [order, env.weth, env.usdc, amountIn, takerData],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`demo swap reverted: ${hash}`);
  return hash;
}

/** Called only after a fresh World ID approval, with the strategy bound to the current companion. */
export async function executeManagedStrategy(db: Db, c: Companion, id: string, operation: "ship" | "dock" | "demo_swap"): Promise<Hex> {
  const row = (await db.execute({ sql: "SELECT * FROM strategies WHERE id = ? AND companion = ?", args: [id, c.label] })).rows[0] as unknown as Strategy | undefined;
  if (!row || row.maker.toLowerCase() !== c.owner.toLowerCase()) throw new Error("Strategy ownership mismatch");
  const client = publicClient();
  if (await client.getChainId() !== 11155111) throw new Error("Sepolia RPC required");
  if (operation === "demo_swap") {
    if (row.status !== "shipped") throw new Error("Strategy not shipped");
    return agentDemoSwap(row);
  }
  const wallet = await companionWallet(db, c.label);
  const env = aquaEnv();
  if (operation === "ship") {
    if (row.status !== "ready" || row.deadline * 1000 <= Date.now()) throw new Error("Strategy not ready or expired");
    const args = shipTxParams(row);
    for (const a of args.approvals) {
      const current = await client.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [wallet.account.address, a.spender] });
      if (current < BigInt(a.amount)) {
        const hash = await wallet.writeContract({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.spender, BigInt(a.amount)] });
        if ((await client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error("Approval reverted");
      }
    }
    const hash = await wallet.writeContract({ address: args.aqua, abi: aquaAbi, functionName: "ship", args: [args.router, args.strategy, args.tokens, args.amounts.map(BigInt)] });
    const strategyHash = await confirmShip(row, hash);
    await db.execute({ sql: "UPDATE strategies SET status='shipped', strategy_hash=?, ship_tx=? WHERE id=? AND status='ready'", args: [strategyHash, hash, id] });
    return hash;
  }
  if (row.status !== "shipped" || !row.strategy_hash) throw new Error("Strategy not shipped");
  const hash = await wallet.writeContract({ address: env.aqua, abi: aquaAbi, functionName: "dock", args: [row.router as Address, row.strategy_hash as Hex, [env.usdc, env.weth]] });
  await confirmDock(row, hash);
  await db.execute({ sql: "UPDATE strategies SET status='docked', dock_tx=? WHERE id=? AND status='shipped'", args: [hash, id] });
  return hash;
}
