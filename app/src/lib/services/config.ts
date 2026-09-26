import { isAddress } from "viem";
import type { Db } from "../db";
import { DEFAULT_SOURCE_HOSTS, INPUT_EXAMPLE, INPUT_SCHEMA, NETWORKS, OUTPUT_EXAMPLE, OUTPUT_SCHEMA, REPORT_DESCRIPTION, REPORT_PRICE, type ServiceCatalog, type ServiceNetwork } from "./catalog";

export function serviceConfig(env: Record<string,string|undefined> = process.env) {
  const network = env.X402_NETWORK ?? "eip155:84532";
  if (!(network in NETWORKS)) throw new Error("X402_NETWORK must be Base Sepolia or Base");
  const dailyJobLimit = Number(env.X402_DAILY_JOB_LIMIT ?? 20);
  if (!Number.isInteger(dailyJobLimit) || dailyJobLimit < 1 || dailyJobLimit > 1000) throw new Error("Invalid X402_DAILY_JOB_LIMIT");
  const hosts = (env.X402_SOURCE_HOSTS ?? DEFAULT_SOURCE_HOSTS.join(",")).split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length || hosts.some(v => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v))) throw new Error("X402_SOURCE_HOSTS must contain exact DNS hostnames");
  const labels = (env.X402_SELLER_LABELS ?? "").split(",").map(v => v.trim()).filter(Boolean);
  if (labels.some(v => !/^[a-z0-9-]{3,20}$/.test(v))) throw new Error("Invalid X402_SELLER_LABELS");
  const enabled = env.X402_ENABLED === "true";
  const ready = enabled && Boolean(env.CDP_API_KEY_ID?.trim() && env.CDP_API_KEY_SECRET?.trim() && env.LLM_BASE_URL?.trim() && env.LLM_API_KEY?.trim() && env.LLM_MODEL?.trim()) && labels.length > 0;
  const bazaarVerifiedAt = env.X402_BAZAAR_VERIFIED_AT && !Number.isNaN(Date.parse(env.X402_BAZAAR_VERIFIED_AT)) ? new Date(env.X402_BAZAAR_VERIFIED_AT).toISOString() : null;
  return { network: network as ServiceNetwork, dailyJobLimit, hosts, labels, enabled, ready, cacheSeconds: 600, bazaarVerifiedAt };
}
export type ServiceConfig = ReturnType<typeof serviceConfig>;
export async function getServiceSeller(db: Db, label: string, config: ServiceConfig) {
  if (!config.labels.includes(label)) return null;
  const row = (await db.execute({ sql: "SELECT c.label,c.full_name,c.owner FROM companions c JOIN birth_provisioning b ON b.label=c.label WHERE c.label=? AND c.role='work' AND b.status='ready'", args: [label] })).rows[0];
  if (!row || !isAddress(String(row.owner)) || /^0x0{40}$/i.test(String(row.owner))) return null;
  return { label: String(row.label), name: String(row.full_name), payTo: String(row.owner) as `0x${string}` };
}
export async function serviceCatalog(db: Db, config = serviceConfig()): Promise<ServiceCatalog> {
  const sellers = (await Promise.all(config.labels.map(label => getServiceSeller(db, label, config)))).filter(v => v !== null);
  const indexed = config.ready && NETWORKS[config.network].testnet && sellers.length > 0 && config.bazaarVerifiedAt !== null;
  return {
    service: "page-report", description: REPORT_DESCRIPTION, price: REPORT_PRICE, currency: "USDC", network: config.network, networkName: NETWORKS[config.network].name,
    testnet: NETWORKS[config.network].testnet, enabled: config.ready && sellers.length > 0,
    allowedHosts: config.hosts, dailyJobLimit: config.dailyJobLimit, cacheSeconds: config.cacheSeconds,
    bazaarStatus: indexed ? "observed-testnet" : "not-verified", bazaarVerifiedAt: indexed ? config.bazaarVerifiedAt : null,
    sellers: sellers.map(s => ({ ...s, endpoint: `/api/services/${s.label}/page-report` })),
    inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA, exampleInput: INPUT_EXAMPLE, exampleOutput: OUTPUT_EXAMPLE,
  };
}
