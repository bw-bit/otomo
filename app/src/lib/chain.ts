import "server-only";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { requireEnv } from "./env";
import {
  COMPANION_ROLE_BITMAP,
  ENS_SEPOLIA,
  MOOD_KEY,
  PERSONALITY_KEY,
  companionInitCalls,
  companionResolverInitData,
  dnsEncode,
  erc20Abi,
  registryAbi,
  resolverAbi,
  resolverSalt,
  verifiableFactoryAbi,
  type CompanionRecords,
} from "./ens";

export const USDC_DECIMALS = 6;

export function publicClient() {
  const { SEPOLIA_RPC_URL } = requireEnv("SEPOLIA_RPC_URL");
  return createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
}

function walletFor(envKey: "OPERATOR_PRIVATE_KEY" | "AGENT_PRIVATE_KEY") {
  const e = requireEnv("SEPOLIA_RPC_URL", envKey);
  const account = privateKeyToAccount(e[envKey] as Hex);
  return createWalletClient({ account, chain: sepolia, transport: http(e.SEPOLIA_RPC_URL) });
}

export const agentAddress = () => privateKeyToAccount(requireEnv("AGENT_PRIVATE_KEY").AGENT_PRIVATE_KEY as Hex).address;

export async function resolveName(nameOrAddress: string): Promise<Address | null> {
  if (isAddress(nameOrAddress)) return nameOrAddress;
  try {
    return (await publicClient().getEnsAddress({ name: normalize(nameOrAddress) })) ?? null;
  } catch {
    return null;
  }
}

export async function readText(name: string, key: string): Promise<string | null> {
  try {
    return (await publicClient().getEnsText({ name: normalize(name), key })) ?? null;
  } catch {
    return null;
  }
}

export const isCompanion = async (name: string) => !!(await readText(name, PERSONALITY_KEY));

export async function agentAllowanceUsdc(owner: Address): Promise<number> {
  const raw = await publicClient().readContract({
    address: ENS_SEPOLIA.mockUsdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, agentAddress()],
  });
  return Number(formatUnits(raw, USDC_DECIMALS));
}

export interface IssueResult {
  resolver: Address;
  resolverTx: Hex;
  registerTx: Hex;
  agentGrantedInInit: boolean;
}

/**
 * Operator deploys a companion-only Permissioned Resolver (owner gets ALL_ROLES, operator/agent get nothing),
 * then registers `<label>.<parent>.eth` in the parent's UserRegistry without transfer rights.
 */
export async function issueCompanionName(
  p: { label: string; records: CompanionRecords; grantAgentInInit: boolean },
): Promise<IssueResult> {
  const { ENS_USER_REGISTRY } = requireEnv("ENS_USER_REGISTRY");
  const client = publicClient();
  const operator = walletFor("OPERATOR_PRIVATE_KEY");
  const agent = p.grantAgentInInit ? agentAddress() : null;

  let version = 0n;
  let resolverTx: Hex | undefined;
  for (; version < 20n; version++) {
    const salt = resolverSalt(p.records.owner, version);
    const data = companionResolverInitData(p.records.owner, companionInitCalls(p.records, agent));
    try {
      await client.simulateContract({
        account: operator.account,
        address: ENS_SEPOLIA.verifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "deployProxy",
        args: [ENS_SEPOLIA.permissionedResolverImpl, salt, data],
      });
    } catch {
      continue; // salt already used (or init reverted) — try the next version
    }
    resolverTx = await operator.writeContract({
      address: ENS_SEPOLIA.verifiableFactory,
      abi: verifiableFactoryAbi,
      functionName: "deployProxy",
      args: [ENS_SEPOLIA.permissionedResolverImpl, salt, data],
    });
    break;
  }
  if (!resolverTx) throw new Error("resolver deployment simulation failed for every version");
  const receipt = await client.waitForTransactionReceipt({ hash: resolverTx });
  if (receipt.status !== "success") throw new Error(`resolver deployment reverted: ${resolverTx}`);
  const [log] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!log) throw new Error("ProxyDeployed event not found");
  const resolver = log.args.proxyAddress;

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600);
  const registerTx = await operator.writeContract({
    address: ENS_USER_REGISTRY as Address,
    abi: registryAbi,
    functionName: "register",
    args: [p.label, p.records.owner, "0x0000000000000000000000000000000000000000", resolver, COMPANION_ROLE_BITMAP, expiry],
  });
  const reg = await client.waitForTransactionReceipt({ hash: registerTx });
  if (reg.status !== "success") throw new Error(`subname registration reverted: ${registerTx}`);

  return { resolver, resolverTx, registerTx, agentGrantedInInit: p.grantAgentInInit };
}

/** Agent key: only allowed to write `otomo.mood` on this resolver (scoped via grantSetterRoles). */
export async function agentSetMood(resolver: Address, fullName: string, mood: string): Promise<Hex> {
  const agent = walletFor("AGENT_PRIVATE_KEY");
  const hash = await agent.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "setText",
    args: [dnsEncode(fullName), MOOD_KEY, mood],
  });
  const r = await publicClient().waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`setText reverted: ${hash}`);
  return hash;
}

/** Agent key: moves MockUSDC from the owner within the allowance the owner granted on-chain. */
export async function agentTransferUsdc(owner: Address, to: Address, amountUsdc: number): Promise<Hex> {
  const agent = walletFor("AGENT_PRIVATE_KEY");
  const hash = await agent.writeContract({
    address: ENS_SEPOLIA.mockUsdc,
    abi: erc20Abi,
    functionName: "transferFrom",
    args: [owner, to, parseUnits(String(amountUsdc), USDC_DECIMALS)],
  });
  const r = await publicClient().waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`transferFrom reverted: ${hash}`);
  return hash;
}
