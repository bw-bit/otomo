import { parseAbi } from "viem";

// Minimal ABIs for the Otomo Aqua stack (contracts/script/DeploySepolia.s.sol).
// Client-safe: used by both the server (src/lib/aqua.ts) and the page's wagmi writes.

export const aquaAbi = parseAbi([
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32 strategyHash)",
  "function dock(address app, bytes32 strategyHash, address[] tokens)",
  "function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)",
  "event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)",
  "event Docked(address maker, address app, bytes32 strategyHash)",
]);

// ISwapVM.Order = (address maker, uint256 traits, bytes data)
// `quote` is non-view in Solidity but only ever invoked via eth_call.
export const swapVmAbi = parseAbi([
  "function quote((address maker, uint256 traits, bytes data) order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
  "function swap((address maker, uint256 traits, bytes data) order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
]);

export const orderBuilderAbi = parseAbi([
  "function buildOrder(address maker, uint40 deadline, uint32 feeBps, uint256 salt) view returns ((address maker, uint256 traits, bytes data) order, bytes strategy)",
  "function buildTakerData(address taker, uint256 minAmountOut) view returns (bytes takerData)",
]);
