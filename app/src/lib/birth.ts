import { hashSignal } from "@worldcoin/idkit/hashing";
import type { Db } from "./db";

export const BIRTH_ACTION = "otomo-birth";

export interface SelfieResponseItem {
  identifier: string;
  signal_hash?: string;
  nullifier: string;
  issuer_schema_id: number;
  sybil_score?: number;
}

export interface BirthPayload {
  protocol_version?: string;
  action?: string;
  responses: SelfieResponseItem[];
  [k: string]: unknown;
}

export type BirthCheck =
  | { ok: true; nullifier: string; sybilScore: number | null }
  | { ok: false; code: "verify_failed" | "wrong_action" | "not_selfie" | "signal_mismatch" | "duplicate" | "sybil_risk"; reason: string };

export interface BirthDeps {
  db: Db;
  /** Calls POST {devPortal}/api/v4/verify/{rp_id}. Returns ok=false with the portal's message on failure. */
  verifyWithPortal: (payload: BirthPayload) => Promise<{ ok: boolean; detail: string }>;
  sybilMax?: number;
}

/** Order matters: portal verification first, then only trust fields of the verified payload. */
export async function checkBirthProof(payload: BirthPayload, walletAddress: string, deps: BirthDeps): Promise<BirthCheck> {
  const verified = await deps.verifyWithPortal(payload);
  if (!verified.ok) return { ok: false, code: "verify_failed", reason: `World ID の検証に失敗しました: ${verified.detail}` };
  if (payload.action !== undefined && payload.action !== BIRTH_ACTION)
    return { ok: false, code: "wrong_action", reason: "誕生用の認証ではありません" };

  const item = payload.responses?.find((r) => r.issuer_schema_id === 11 || r.identifier === "selfie");
  if (!item) return { ok: false, code: "not_selfie", reason: "Selfie Check の証明が含まれていません" };

  const expected = hashSignal(walletAddress.toLowerCase()).toLowerCase();
  if (!item.signal_hash || item.signal_hash.toLowerCase() !== expected)
    return { ok: false, code: "signal_mismatch", reason: "証明が接続中のウォレットに紐付いていません" };

  const used = deps.db.prepare(`SELECT 1 FROM used_nullifiers WHERE nullifier = ?`).get(item.nullifier);
  if (used) return { ok: false, code: "duplicate", reason: "この World ID ではすでに相棒が生まれています（1人1体）" };

  const score = typeof item.sybil_score === "number" ? item.sybil_score : null;
  if (deps.sybilMax !== undefined && score !== null && score > deps.sybilMax)
    return { ok: false, code: "sybil_risk", reason: `重複登録のリスクが高いと判定されました（sybil_score=${score}）` };

  return { ok: true, nullifier: item.nullifier, sybilScore: score };
}

export function markNullifierUsed(db: Db, nullifier: string, now: number) {
  db.prepare(`INSERT INTO used_nullifiers VALUES (?, ?)`).run(nullifier, now);
}
