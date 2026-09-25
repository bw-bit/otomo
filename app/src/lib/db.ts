import Database from "better-sqlite3";
import path from "node:path";

export interface Companion {
  label: string;
  full_name: string;
  owner: string;
  resolver: string;
  personality: string;
  world_nullifier: string;
  agent_sub: string | null;
  created_at: number;
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
  personality TEXT NOT NULL, world_nullifier TEXT NOT NULL UNIQUE, agent_sub TEXT, created_at INTEGER NOT NULL);
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
`;

export function openDb(file = process.env.OTOMO_DB ?? path.join(process.cwd(), "otomo.db")) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export type Db = ReturnType<typeof openDb>;

let singleton: Db | undefined;
export const getDb = () => (singleton ??= openDb());
