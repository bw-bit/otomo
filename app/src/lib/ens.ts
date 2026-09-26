import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { namehash, normalize, packetToBytes } from "viem/ens";

// Sepolia ENSv2 beta — https://docs.ens.domains/learn/deployments (see docs/research.md)
export const ENS_SEPOLIA = {
  ethRegistrar: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
  ethRegistry: "0x657ea849311d3d5823348dded7c2aaafb3ede09e",
  verifiableFactory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c",
  permissionedResolverImpl: "0x14f09fd05d4585759e54844dc9b00147131cf243",
  userRegistryImpl: "0xa80338aaa8d23831cea25e858d1774534abb0263",
  mockUsdc: "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e",
} as const satisfies Record<string, Address>;

// contracts-v2 RegistryRolesLib
export const RegistryRoles = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_SUBREGISTRY: 1n << 20n,
  ROLE_SET_RESOLVER: 1n << 24n,
  ROLE_SET_RESOLVER_ADMIN: (1n << 24n) << 128n,
  ROLE_CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
} as const;

// Permissioned Resolver roles
export const ResolverRoles = { ROLE_SET_TEXT: 1n << 4n } as const;

export const ALL_ROLES = BigInt("0x" + "1".repeat(64));

/** Companion subnames: owner may change resolver, but may NOT transfer the name (no ROLE_CAN_TRANSFER_ADMIN). */
export const COMPANION_ROLE_BITMAP = RegistryRoles.ROLE_SET_RESOLVER | RegistryRoles.ROLE_SET_RESOLVER_ADMIN;

export const MOOD_KEY = "otomo.mood";
export const PERSONALITY_KEY = "otomo.personality";
export const ROLE_KEY = "otomo.role";
export const SKILLS_KEY = "otomo.skills";
export const SIBLINGS_KEY = "otomo.siblings";

export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const resolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
]);

export const registryAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants)",
  "function register(string label, address owner, address subregistry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function setSubregistry(uint256 anyId, address subregistry)",
  "function getResolver(string label) view returns (address)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getSubregistry(string label) view returns (address)",
]);

export const ethRegistrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) view returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const labelhash = (label: string) => BigInt(keccak256(stringToHex(label)));

export const dnsEncode = (name: string): Hex => toHex(packetToBytes(normalize(name)));

const LABEL_RE = /^[a-z0-9-]{3,20}$/;
export function normalizeCompanionLabel(input: string): string {
  const label = normalize(input.trim());
  if (!LABEL_RE.test(label) || label.startsWith("-") || label.endsWith("-")) {
    throw new Error("Label must be 3-20 chars of a-z, 0-9 or '-'");
  }
  return label;
}

export const resolverSalt = (owner: Address, version: bigint) =>
  BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(stringToHex("OwnedResolver")), owner, version],
      ),
    ),
  );

export const userRegistrySalt = (parentName: string, version: bigint) =>
  BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [keccak256(stringToHex("UserRegistry")), namehash(normalize(parentName)), version],
      ),
    ),
  );

/** Calldata that scopes ROLE_SET_TEXT to a single key via grantSetterRoles (name/value are ignored by the resolver). */
export const textSetterFor = (key: string): Hex =>
  encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: ["0x", key, ""] });

export const grantMoodSetterCall = (agent: Address): Hex =>
  encodeFunctionData({ abi: resolverAbi, functionName: "grantSetterRoles", args: [textSetterFor(MOOD_KEY), agent] });

export interface CompanionRecords {
  fullName: string;
  owner: Address;
  description: string;
  personalityJson: string;
  mood: string;
  /** Discovery records: role ("personal" | "work"), skills (JSON array), siblings (comma-separated full names). */
  role?: string;
  skills?: string;
  siblings?: string;
}

export function companionInitCalls(r: CompanionRecords, agentGrantInInit: Address | null): Hex[] {
  const name = dnsEncode(r.fullName);
  const set = (key: string, value: string) =>
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [name, key, value] });
  const calls: Hex[] = [
    encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [name, 60n, r.owner] }),
    set("description", r.description),
    set(PERSONALITY_KEY, r.personalityJson),
    set(MOOD_KEY, r.mood),
  ];
  if (r.role !== undefined) calls.push(set(ROLE_KEY, r.role));
  if (r.skills !== undefined) calls.push(set(SKILLS_KEY, r.skills));
  if (r.siblings !== undefined) calls.push(set(SIBLINGS_KEY, r.siblings));
  if (agentGrantInInit) calls.push(grantMoodSetterCall(agentGrantInInit));
  return calls;
}

export function companionResolverInitData(owner: Address, calls: Hex[]): Hex {
  return encodeFunctionData({
    abi: resolverAbi,
    functionName: "initialize",
    args: [[{ account: owner, roleBitmap: ALL_ROLES }], calls],
  });
}
