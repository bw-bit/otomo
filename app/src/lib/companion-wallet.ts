import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { requireEnv } from "./env";
import type { Db } from "./db";

function encryptionKey() {
  const { COMPANION_WALLET_KEY } = requireEnv("COMPANION_WALLET_KEY");
  if (!/^[a-fA-F0-9]{64}$/.test(COMPANION_WALLET_KEY)) throw new Error("COMPANION_WALLET_KEY must be 32 bytes of hex");
  return Buffer.from(COMPANION_WALLET_KEY, "hex");
}

/** Testnet hot wallets, separately generated and authenticated to their companion label. */
export function createCompanionWallet(label: string) {
  const key = generatePrivateKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(label));
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return { address: privateKeyToAccount(key).address, ciphertext: [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".") };
}

export async function companionWallet(db: Db, label: string) {
  const row = (await db.execute({ sql: "SELECT i.wallet_cipher, c.owner FROM companion_identity i JOIN companions c ON c.label = i.label WHERE i.label = ?", args: [label] })).rows[0];
  if (!row) throw new Error("この相棒は専用ウォレットに移行していません");
  const [iv, tag, body] = String(row.wallet_cipher).split(".").map(s => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(tag);
  const key = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8") as Hex;
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== String(row.owner).toLowerCase()) throw new Error("Companion wallet address mismatch");
  return createWalletClient({ account, chain: sepolia, transport: http(requireEnv("SEPOLIA_RPC_URL").SEPOLIA_RPC_URL) });
}

export async function hasCompanionWallet(db: Db, label: string) {
  return Boolean((await db.execute({ sql: "SELECT 1 FROM companion_identity WHERE label = ?", args: [label] })).rows[0]);
}
