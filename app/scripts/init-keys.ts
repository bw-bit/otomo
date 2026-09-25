// Creates .env.local from .env.example with fresh OPERATOR/AGENT keys and APP_SECRET.
// Never prints private keys; prints only the addresses that need Sepolia ETH.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const target = new URL("../.env.local", import.meta.url);
let text = existsSync(target) ? readFileSync(target, "utf8") : readFileSync(new URL("../.env.example", import.meta.url), "utf8");

const setIfEmpty = (key: string, value: string) => {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = text.match(re);
  if (m && m[1].trim()) return false;
  text = m ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  return true;
};

setIfEmpty("OPERATOR_PRIVATE_KEY", generatePrivateKey());
setIfEmpty("AGENT_PRIVATE_KEY", generatePrivateKey());
setIfEmpty("COMPANION_WALLET_KEY", randomBytes(32).toString("hex"));
setIfEmpty("APP_SECRET", randomBytes(32).toString("base64url"));
writeFileSync(target, text, { mode: 0o600 });

const read = (key: string) => text.match(new RegExp(`^${key}=(.*)$`, "m"))![1].trim() as `0x${string}`;
console.log("operator:", privateKeyToAccount(read("OPERATOR_PRIVATE_KEY")).address, "(needs Sepolia ETH)");
console.log("agent:   ", privateKeyToAccount(read("AGENT_PRIVATE_KEY")).address, "(needs a little Sepolia ETH for gas)");
