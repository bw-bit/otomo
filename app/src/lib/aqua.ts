import "server-only";
import { randomBytes } from "node:crypto";
import {
  decodeAbiParameters,
  formatUnits,
  keccak256,
  parseAbi,
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
export const SWAPVM_FEE_PERCENT = SWAPVM_FEE_BPS / 10_000_000;
/** Demo swap size: the agent sells 0.01 mWETH for mUSDC. */
export const DEMO_SWAP_WETH_IN = "0.01";
const SEPOLIA_DEMO_MOCK_WETH = "0xf7A9C97d0DC45A13cd7e3E17406fA61CA72d66FA" as Address;
const DEMO_MAX_USDC = parseUnits("20", USDC_DECIMALS);
const DEMO_MAX_WETH = parseUnits("0.01", WETH_DECIMALS);
const DEMO_TOKEN_INFO_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

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
    // Seed equal USDC/WETH notional at the fixed mock rate (no market oracle).
    wethAmount: p.amountUsdc / MOCK_WETH_USDC_RATE,
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

async function confirmAquaTx(txHash: Hex, expectedEvent: "Shipped" | "Docked"): Promise<{
  strategyHash: Hex;
  maker: Address;
  app: Address;
  from: Address;
}> {
  const env = aquaEnv();
  const client = publicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${txHash}`);
  if (receipt.to?.toLowerCase() !== env.aqua.toLowerCase()) throw new Error("transaction is not addressed to Aqua");
  const [log] = parseEventLogs({ abi: aquaAbi, eventName: expectedEvent, logs: receipt.logs });
  if (!log) throw new Error(`${expectedEvent} event not found in ${txHash}`);
  return {
    strategyHash: log.args.strategyHash,
    maker: log.args.maker,
    app: log.args.app,
    from: receipt.from,
  };
}

/** Verifies a user's ship tx and returns the on-chain strategy hash. */
export async function confirmShip(row: Strategy, txHash: Hex): Promise<Hex> {
  const { strategyHash, maker, app, from } = await confirmAquaTx(txHash, "Shipped");
  if (maker.toLowerCase() !== row.maker.toLowerCase()) throw new Error("Shipped event maker does not match the strategy maker");
  if (app.toLowerCase() !== row.router.toLowerCase()) throw new Error("Shipped event router does not match the strategy router");
  if (from.toLowerCase() !== row.maker.toLowerCase()) throw new Error("ship was not sent by the maker wallet");
  if (strategyHash.toLowerCase() !== computeStrategyHash(row.strategy as Hex).toLowerCase()) throw new Error("Shipped strategyHash does not match the stored strategy");
  return strategyHash;
}

/** Verifies a user's dock tx against the stored strategy hash. */
export async function confirmDock(row: Strategy, txHash: Hex): Promise<void> {
  const { strategyHash, maker, app, from } = await confirmAquaTx(txHash, "Docked");
  if (maker.toLowerCase() !== row.maker.toLowerCase()) throw new Error("Docked event maker does not match the strategy maker");
  if (app.toLowerCase() !== row.router.toLowerCase()) throw new Error("Docked event router does not match the strategy router");
  if (from.toLowerCase() !== row.maker.toLowerCase()) throw new Error("dock was not sent by the maker wallet");
  if (!row.strategy_hash || strategyHash.toLowerCase() !== row.strategy_hash.toLowerCase()) throw new Error("Docked strategyHash does not match");
}

export interface Balances {
  usdc: number;
  weth: number;
}

export interface DemoSwapResult {
  txHash: Hex;
  maker: Address;
  taker: Address;
  amountInWeth: string;
  quotedAmountOutUsdc: string;
  amountOutUsdc: string;
  minAmountOutUsdc: string;
  feePercent: number;
  feeDescription: string;
  mintTxHash: Hex | null;
  approvalTxHash: Hex | null;
  makerWalletBefore: Balances;
  makerWalletAfter: Balances;
  takerWalletBefore: Balances;
  takerWalletAfter: Balances;
  virtualBefore: Balances;
  virtualAfter: Balances;
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

export interface DemoFundingResult {
  account: Address;
  chainId: number;
  required: Balances;
  missingBefore: Balances;
  minted: Balances;
  txHashes: { usdc: Hex | null; weth: Hex | null };
  before: Balances;
  after: Balances;
}

const demoFundingInFlight = new Map<string, Promise<DemoFundingResult>>();

/** Mint only a ready strategy's missing Sepolia mock-token amounts from its own companion wallet. */
export async function fundDemoStrategy(db: Db, label: string, row: Strategy): Promise<DemoFundingResult> {
  const key = `${label.toLowerCase()}:${row.id}`;
  const existing = demoFundingInFlight.get(key);
  if (existing) return existing;

  const funding = (async (): Promise<DemoFundingResult> => {
    if (row.companion !== label || row.status !== "ready" || row.deadline * 1000 <= Date.now()) {
      throw new Error("Only an active ready strategy owned by this companion can be funded");
    }
    const env = requireEnv("MOCK_WETH_ADDRESS", "AQUA_ROUTER_ADDRESS");
    if (env.MOCK_WETH_ADDRESS.toLowerCase() !== SEPOLIA_DEMO_MOCK_WETH.toLowerCase()) {
      throw new Error("Configured mWETH is not the fixed Sepolia demo token");
    }
    if (row.router.toLowerCase() !== env.AQUA_ROUTER_ADDRESS.toLowerCase()) {
      throw new Error("Strategy router does not match the configured Aqua router");
    }
    if (decodeStrategy(row.strategy as Hex).maker.toLowerCase() !== row.maker.toLowerCase()) {
      throw new Error("Strategy maker does not match the strategy owner");
    }

    const usdcTarget = parseUnits(String(row.usdc_amount), USDC_DECIMALS);
    const wethTarget = parseUnits(String(row.weth_amount), WETH_DECIMALS);
    if (usdcTarget <= 0n || usdcTarget > DEMO_MAX_USDC || wethTarget <= 0n || wethTarget > DEMO_MAX_WETH) {
      throw new Error("Strategy funding exceeds the 20 mUSDC-equivalent demo cap");
    }
    const equalValueWeth = (usdcTarget * 10n ** 12n) / BigInt(MOCK_WETH_USDC_RATE);
    if (wethTarget !== equalValueWeth) throw new Error("Strategy mUSDC and mWETH amounts are not equal-value at the fixed demo rate");

    const client = publicClient();
    const chainId = await client.getChainId();
    if (chainId !== 11155111) throw new Error("Sepolia chain 11155111 is required for demo funding");

    const wallet = await companionWallet(db, label);
    const account = wallet.account.address;
    if (account.toLowerCase() !== row.maker.toLowerCase()) throw new Error("Companion wallet does not own this strategy");
    const usdc = ENS_SEPOLIA.mockUsdc;
    const weth = SEPOLIA_DEMO_MOCK_WETH;
    const [usdcCode, wethCode, usdcDecimals, usdcSymbol, wethDecimals, wethSymbol, usdcBalance, wethBalance] = await Promise.all([
      client.getBytecode({ address: usdc }),
      client.getBytecode({ address: weth }),
      client.readContract({ address: usdc, abi: DEMO_TOKEN_INFO_ABI, functionName: "decimals" }),
      client.readContract({ address: usdc, abi: DEMO_TOKEN_INFO_ABI, functionName: "symbol" }),
      client.readContract({ address: weth, abi: DEMO_TOKEN_INFO_ABI, functionName: "decimals" }),
      client.readContract({ address: weth, abi: DEMO_TOKEN_INFO_ABI, functionName: "symbol" }),
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    ]);
    if (!usdcCode || !wethCode || usdcDecimals !== USDC_DECIMALS || usdcSymbol !== "USDC" || wethDecimals !== WETH_DECIMALS || wethSymbol !== "mWETH") {
      throw new Error("Fixed Sepolia demo token contracts failed code, symbol, or decimals checks");
    }

    const missingUsdc = usdcBalance < usdcTarget ? usdcTarget - usdcBalance : 0n;
    const missingWeth = wethBalance < wethTarget ? wethTarget - wethBalance : 0n;
    const before = {
      usdc: Number(formatUnits(usdcBalance, USDC_DECIMALS)),
      weth: Number(formatUnits(wethBalance, WETH_DECIMALS)),
    };
    const pendingMints: { token: "usdc" | "weth"; send: () => Promise<Hex> }[] = [];
    if (missingUsdc > 0n) {
      const simulation = await client.simulateContract({
        account, address: usdc, abi: erc20Abi, functionName: "mint", args: [account, missingUsdc],
      });
      pendingMints.push({
        token: "usdc",
        send: () => wallet.writeContract({ ...simulation.request, account: wallet.account }),
      });
    }
    if (missingWeth > 0n) {
      const simulation = await client.simulateContract({
        account, address: weth, abi: erc20Abi, functionName: "mint", args: [account, missingWeth],
      });
      pendingMints.push({
        token: "weth",
        send: () => wallet.writeContract({ ...simulation.request, account: wallet.account }),
      });
    }

    const txHashes: DemoFundingResult["txHashes"] = { usdc: null, weth: null };
    for (const mint of pendingMints) {
      const hash = await mint.send();
      txHashes[mint.token] = hash;
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${mint.token} demo mint reverted: ${hash}`);
    }

    const [usdcAfter, wethAfter] = await Promise.all([
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    ]);
    if (usdcAfter < usdcTarget || wethAfter < wethTarget) throw new Error("Demo funding did not reach the strategy's required balances");
    return {
      account,
      chainId,
      required: { usdc: Number(formatUnits(usdcTarget, USDC_DECIMALS)), weth: Number(formatUnits(wethTarget, WETH_DECIMALS)) },
      missingBefore: { usdc: Number(formatUnits(missingUsdc, USDC_DECIMALS)), weth: Number(formatUnits(missingWeth, WETH_DECIMALS)) },
      minted: { usdc: Number(formatUnits(missingUsdc, USDC_DECIMALS)), weth: Number(formatUnits(missingWeth, WETH_DECIMALS)) },
      txHashes,
      before,
      after: { usdc: Number(formatUnits(usdcAfter, USDC_DECIMALS)), weth: Number(formatUnits(wethAfter, WETH_DECIMALS)) },
    };
  })();
  demoFundingInFlight.set(key, funding);
  try {
    return await funding;
  } finally {
    if (demoFundingInFlight.get(key) === funding) demoFundingInFlight.delete(key);
  }
}

/** Agent key acts as a third-party taker and returns a before/after receipt summary. */
export async function agentDemoSwapWithResult(row: Strategy): Promise<DemoSwapResult> {
  const env = aquaEnv();
  const client = publicClient();
  if (await client.getChainId() !== 11155111) throw new Error("Sepolia RPC required");
  if (row.status !== "shipped" || !row.strategy_hash) throw new Error("Strategy not shipped");
  if (row.router.toLowerCase() !== env.router.toLowerCase()) throw new Error("Strategy router does not match the configured Aqua router");
  if (computeStrategyHash(row.strategy as Hex).toLowerCase() !== row.strategy_hash.toLowerCase()) throw new Error("Stored strategy hash does not match the strategy");

  const agent = walletFor("AGENT_PRIVATE_KEY");
  const taker = agent.account.address;
  if (taker.toLowerCase() === row.maker.toLowerCase()) throw new Error("Maker and demo taker must be separate wallets");
  const order = decodeStrategy(row.strategy as Hex);
  if (order.maker.toLowerCase() !== row.maker.toLowerCase()) throw new Error("Strategy order maker does not match the strategy maker");
  const amountIn = parseUnits(DEMO_SWAP_WETH_IN, WETH_DECIMALS);
  const [makerWalletBefore, takerWalletBefore, virtualBefore] = await Promise.all([
    walletBalances(row.maker as Address),
    walletBalances(taker),
    virtualBalances(row),
  ]);

  // MockERC20.mint is permissionless — mint only the shortfall for this demo swap.
  const bal = await client.readContract({ address: env.weth, abi: erc20Abi, functionName: "balanceOf", args: [taker] });
  let mintTxHash: Hex | null = null;
  if (bal < amountIn) {
    mintTxHash = await agent.writeContract({ address: env.weth, abi: erc20Abi, functionName: "mint", args: [taker, amountIn - bal] });
    const r = await client.waitForTransactionReceipt({ hash: mintTxHash });
    if (r.status !== "success") throw new Error(`mint reverted: ${mintTxHash}`);
  }
  const allowance = await client.readContract({ address: env.weth, abi: erc20Abi, functionName: "allowance", args: [taker, env.router] });
  let approvalTxHash: Hex | null = null;
  if (allowance < amountIn) {
    approvalTxHash = await agent.writeContract({ address: env.weth, abi: erc20Abi, functionName: "approve", args: [env.router, amountIn] });
    const r = await client.waitForTransactionReceipt({ hash: approvalTxHash });
    if (r.status !== "success") throw new Error(`approve reverted: ${approvalTxHash}`);
  }

  const quoteData = await client.readContract({
    address: env.orderBuilder, abi: orderBuilderAbi, functionName: "buildTakerData", args: [taker, 0n],
  });
  const [quotedAmountIn, quotedAmountOut, quotedOrderHash] = await client.readContract({
    address: env.router, abi: swapVmAbi, functionName: "quote",
    args: [order, env.weth, env.usdc, amountIn, quoteData],
  });
  if (quotedAmountIn !== amountIn) throw new Error("SwapVM quote amountIn does not match the requested amount");
  if (quotedOrderHash.toLowerCase() !== row.strategy_hash.toLowerCase()) throw new Error("SwapVM quote order hash does not match the shipped strategy");
  const minAmountOut = (quotedAmountOut * 99n) / 100n;
  const takerData = await client.readContract({
    address: env.orderBuilder, abi: orderBuilderAbi, functionName: "buildTakerData", args: [taker, minAmountOut],
  });
  const takerUsdcBeforeSwap = await client.readContract({ address: env.usdc, abi: erc20Abi, functionName: "balanceOf", args: [taker] });
  const hash = await agent.writeContract({
    address: env.router, abi: swapVmAbi, functionName: "swap",
    args: [order, env.weth, env.usdc, amountIn, takerData],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`demo swap reverted: ${hash}`);
  if (receipt.to?.toLowerCase() !== env.router.toLowerCase() || receipt.from.toLowerCase() !== taker.toLowerCase()) {
    throw new Error("Demo swap receipt does not match the configured router and taker");
  }

  const [makerWalletAfter, takerWalletAfter, virtualAfter, takerUsdcAfterSwap] = await Promise.all([
    walletBalances(row.maker as Address),
    walletBalances(taker),
    virtualBalances(row),
    client.readContract({ address: env.usdc, abi: erc20Abi, functionName: "balanceOf", args: [taker] }),
  ]);
  const actualAmountOut = takerUsdcAfterSwap - takerUsdcBeforeSwap;
  if (actualAmountOut < minAmountOut) throw new Error("Demo swap output was below its minimum amount");

  return {
    txHash: hash,
    maker: row.maker as Address,
    taker,
    amountInWeth: DEMO_SWAP_WETH_IN,
    quotedAmountOutUsdc: formatUnits(quotedAmountOut, USDC_DECIMALS),
    amountOutUsdc: formatUnits(actualAmountOut, USDC_DECIMALS),
    minAmountOutUsdc: formatUnits(minAmountOut, USDC_DECIMALS),
    feePercent: SWAPVM_FEE_PERCENT,
    feeDescription: "SwapVM uses 0.3% of the mWETH input before pricing; full input is credited to Aqua and the fee remains in the maker's virtual inventory.",
    mintTxHash,
    approvalTxHash,
    makerWalletBefore,
    makerWalletAfter,
    takerWalletBefore,
    takerWalletAfter,
    virtualBefore,
    virtualAfter,
  };
}

/** Agent key acts as a third-party taker: swaps DEMO_SWAP_WETH_IN mWETH -> mUSDC against the shipped strategy. */
export async function agentDemoSwap(row: Strategy): Promise<Hex> {
  return (await agentDemoSwapWithResult(row)).txHash;
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
