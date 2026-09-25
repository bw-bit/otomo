// One-time parent name setup on Sepolia ENSv2 (idempotent). Run: npm run setup:parent
// 1) mint MockUSDC  2) commit-reveal register <ENS_PARENT_LABEL>.eth  3) deploy UserRegistry + setSubregistry
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { randomBytes } from "node:crypto";
import {
  ALL_ROLES,
  ENS_SEPOLIA,
  erc20Abi,
  ethRegistrarAbi,
  labelhash,
  registryAbi,
  userRegistrySalt,
  verifiableFactoryAbi,
} from "../src/lib/ens.ts";

const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};
const rpc = need("SEPOLIA_RPC_URL");
const account = privateKeyToAccount(need("OPERATOR_PRIVATE_KEY") as Hex);
const label = need("ENS_PARENT_LABEL");
const parent = `${label}.eth`;
const client = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const ONE_YEAR = 365n * 24n * 3600n;

async function send(desc: string, hash: Hex) {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${desc} reverted: ${hash}`);
  console.log(`✓ ${desc}: https://sepolia.etherscan.io/tx/${hash}`);
  return r;
}

const owner = (await client.readContract({
  address: ENS_SEPOLIA.ethRegistry, abi: registryAbi, functionName: "getOwner", args: [labelhash(label)],
})) as Address;

if (owner.toLowerCase() === zeroAddress) {
  const available = await client.readContract({ address: ENS_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] });
  if (!available) throw new Error(`${parent} is not available; choose another ENS_PARENT_LABEL`);
  const [base, premium] = await client.readContract({
    address: ENS_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "getRegisterPrice", args: [label, ONE_YEAR, ENS_SEPOLIA.mockUsdc],
  });
  const price = base + premium;
  await send("mint MockUSDC", await wallet.writeContract({ address: ENS_SEPOLIA.mockUsdc, abi: erc20Abi, functionName: "mint", args: [account.address, price * 2n] }));
  await send("approve registrar", await wallet.writeContract({ address: ENS_SEPOLIA.mockUsdc, abi: erc20Abi, functionName: "approve", args: [ENS_SEPOLIA.ethRegistrar, price * 2n] }));
  const secret = toHex(randomBytes(32));
  const commitment = await client.readContract({
    address: ENS_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "makeCommitment",
    args: [label, account.address, secret, zeroAddress, zeroAddress, ONE_YEAR, `0x${"0".repeat(64)}`],
  });
  await send("commit", await wallet.writeContract({ address: ENS_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "commit", args: [commitment] }));
  console.log("… waiting 65s (MIN_COMMITMENT_AGE)");
  await new Promise((r) => setTimeout(r, 65_000));
  await send(`register ${parent}`, await wallet.writeContract({
    address: ENS_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "register",
    args: [label, account.address, secret, zeroAddress, zeroAddress, ONE_YEAR, ENS_SEPOLIA.mockUsdc, `0x${"0".repeat(64)}`],
  }));
} else if (owner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`${parent} is owned by ${owner}, not the operator ${account.address}`);
} else {
  console.log(`✓ ${parent} already owned by operator`);
}

let userRegistry = (await client.readContract({
  address: ENS_SEPOLIA.ethRegistry, abi: registryAbi, functionName: "getSubregistry", args: [label],
})) as Address;

if (userRegistry.toLowerCase() === zeroAddress) {
  const r = await send("deploy UserRegistry", await wallet.writeContract({
    address: ENS_SEPOLIA.verifiableFactory, abi: verifiableFactoryAbi, functionName: "deployProxy",
    args: [ENS_SEPOLIA.userRegistryImpl, userRegistrySalt(parent, 0n), encodeRegistryInit(account.address)],
  }));
  const [log] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: "ProxyDeployed", logs: r.logs });
  userRegistry = log.args.proxyAddress;
  await send("setSubregistry", await wallet.writeContract({
    address: ENS_SEPOLIA.ethRegistry, abi: registryAbi, functionName: "setSubregistry", args: [labelhash(label), userRegistry],
  }));
} else {
  console.log(`✓ UserRegistry already set: ${userRegistry}`);
}

mkdirSync(new URL("../deployments", import.meta.url), { recursive: true });
writeFileSync(new URL("../deployments/sepolia.json", import.meta.url), JSON.stringify({ parent, operator: account.address, userRegistry }, null, 2) + "\n");
console.log(`\nENS_USER_REGISTRY=${userRegistry}  ← add this to .env.local`);

// Operator holds every role (incl. ROLE_REGISTRAR / ROLE_RENEW) on its own companion registry.
function encodeRegistryInit(admin: Address): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [[{ account: admin, roleBitmap: ALL_ROLES }]] });
}
