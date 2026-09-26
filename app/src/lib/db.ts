import { createClient, type Client } from "@libsql/client";
import path from "node:path";

export type CompanionRole = "personal" | "work";

export interface Companion {
  label: string;
  full_name: string;
  owner: string;
  resolver: string;
  personality: string;
  world_nullifier: string;
  agent_sub: string | null;
  created_at: number;
  /** Raw World ID nullifier shared by all companions of one human. */
  human: string | null;
  role: CompanionRole;
}

export interface PendingAction {
  id: string;
  companion: string;
  intent: string;
  resolved_to: string | null;
  amount_usdc: number;
  status: "pending" | "executed" | "rejected" | "expired";
  reason: string | null;
  tx_hash: string | null;
  created_at: number;
  expires_at: number;
}

export interface Strategy {
  id: string;
  companion: string;
  action_id: string;
  maker: string;
  router: string;
  /** abi.encode(order) — the `strategy` arg passed to aqua.ship. */
  strategy: string;
  strategy_hash: string | null;
  usdc_amount: number;
  weth_amount: number;
  /** Unix seconds. */
  deadline: number;
  status: "ready" | "shipped" | "docked";
  ship_tx: string | null;
  dock_tx: string | null;
  created_at: number;
}

export interface AuthFlow {
  state: string;
  kind: "bind" | "approve";
  ref: string;
  nonce: string;
  code_verifier: string;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companions (
  label TEXT PRIMARY KEY, full_name TEXT NOT NULL, owner TEXT NOT NULL UNIQUE, resolver TEXT NOT NULL,
  personality TEXT NOT NULL, world_nullifier TEXT NOT NULL UNIQUE, agent_sub TEXT, created_at INTEGER NOT NULL,
  human TEXT, role TEXT NOT NULL DEFAULT 'personal');
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY, companion TEXT NOT NULL, intent TEXT NOT NULL, resolved_to TEXT, amount_usdc REAL NOT NULL,
  status TEXT NOT NULL, reason TEXT, tx_hash TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_flows (
  state TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS used_nullifiers (nullifier TEXT PRIMARY KEY, used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY, from_label TEXT NOT NULL, to_label TEXT NOT NULL, task TEXT NOT NULL, reward_usdc REAL NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, companion TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY, companion TEXT NOT NULL, action_id TEXT NOT NULL, maker TEXT NOT NULL,
  router TEXT NOT NULL, strategy TEXT NOT NULL, strategy_hash TEXT,
  usdc_amount REAL NOT NULL, weth_amount REAL NOT NULL, deadline INTEGER NOT NULL,
  status TEXT NOT NULL, ship_tx TEXT, dock_tx TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS birth_provisioning (
  label TEXT PRIMARY KEY, status TEXT NOT NULL, register_tx TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS identity_bindings (
  label TEXT PRIMARY KEY, issuer TEXT NOT NULL, verified_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS companion_identity (
  label TEXT PRIMARY KEY REFERENCES companions(label), wallet_cipher TEXT NOT NULL,
  sybil_score REAL, verification_environment TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS birth_challenges (
  id TEXT PRIMARY KEY, signal TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_attempts (
  request_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_deliveries (
  request_id TEXT PRIMARY KEY REFERENCES friend_requests(id), content TEXT NOT NULL,
  delivered_at INTEGER NOT NULL, reviewed_at INTEGER, reward_action_id TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS reputation_publications (
  label TEXT PRIMARY KEY, snapshot TEXT NOT NULL, tx_hash TEXT, status TEXT NOT NULL,
  published_at INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS translations (
  hash TEXT PRIMARY KEY, lang TEXT NOT NULL, text TEXT NOT NULL, translated TEXT NOT NULL,
  created_at INTEGER NOT NULL);
`;

/** Additive migration: one human may own several companions, grouped by `human`, each with a role. */
async function migrateCompanions(db: Client) {
  const cols = new Set((await db.execute("PRAGMA table_info(companions)")).rows.map((r) => String(r.name)));
  if (!cols.has("human")) await db.execute("ALTER TABLE companions ADD COLUMN human TEXT");
  if (!cols.has("role")) await db.execute("ALTER TABLE companions ADD COLUMN role TEXT NOT NULL DEFAULT 'personal'");
  await db.execute("UPDATE companions SET human = world_nullifier WHERE human IS NULL");
  await db.execute("CREATE INDEX IF NOT EXISTS companions_human ON companions(human)");
}

export async function openDb(url = process.env.TURSO_DATABASE_URL || `file:${process.env.OTOMO_DB ?? path.join(process.cwd(), "otomo.db")}`): Promise<Client> {
  if (process.env.VERCEL && (!process.env.TURSO_DATABASE_URL || url.startsWith("file:"))) throw new Error("A remote TURSO_DATABASE_URL is required on Vercel");
  if (!url.startsWith("file:") && !process.env.TURSO_AUTH_TOKEN) throw new Error("TURSO_AUTH_TOKEN is required for the remote database");
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  try {
    for (const sql of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await db.execute(sql);
    await migrateCompanions(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export type Db = Client;

let singleton: Promise<Db> | undefined;
export const getDb = () => (singleton ??= openDb().catch((error) => { singleton = undefined; throw error; }));
