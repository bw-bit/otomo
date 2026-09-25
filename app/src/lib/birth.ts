import { hashSignal } from "@worldcoin/idkit/hashing";
import type { Db } from "./db";

export const BIRTH_ACTION = "otomo-birth";
/** Deterministic hashed form of BIRTH_ACTION as it appears inside v4 payloads. */
const BIRTH_ACTION_HASH = "0x00b3ad4f6105123548927b72800e30fd398fe0c73063a4ee2b369852b4dc7cf2";

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
  | { ok: true; nullifier: string; sybilScore: number | null; credential: string }
  | { ok: false; code: "verify_failed" | "wrong_action" | "unsupported_credential" | "signal_mismatch" | "duplicate" | "sybil_risk"; reason: string };

/** Accepted World ID credential identifiers: v4 (selfie/passport/mnc/proof_of_human) plus legacy v3 aliases. */
export const ACCEPTED_CREDENTIALS: ReadonlySet<string> = new Set([
  "selfie",
  "passport",
  "mnc",
  "proof_of_human",
  "orb",
  "document",
  "secure_document",
]);

export interface BirthDeps {
  db: Db;
  /** Calls POST {devPortal}/api/v4/verify/{rp_id}. Returns ok=false with the portal's message on failure. */
  verifyWithPortal: (payload: BirthPayload) => Promise<{ ok: boolean; detail: string }>;
  sybilMax?: number;
  allowExisting?: boolean;
}

/** Order matters: portal verification first, then only trust fields of the verified payload. */
export async function checkBirthProof(payload: BirthPayload, signal: string, deps: BirthDeps): Promise<BirthCheck> {
  const verified = await deps.verifyWithPortal(payload);
  if (!verified.ok) return { ok: false, code: "verify_failed", reason: `World ID の検証に失敗しました: ${verified.detail}` };
  if (typeof payload.action === "string" && payload.action !== BIRTH_ACTION && payload.action.toLowerCase() !== BIRTH_ACTION_HASH)
    return { ok: false, code: "wrong_action", reason: "誕生用の認証ではありません" };

  const item = payload.responses?.find((r) => ACCEPTED_CREDENTIALS.has(r.identifier));
  if (!item) return { ok: false, code: "unsupported_credential", reason: "対応する World ID 証明（顔・パスポート・マイナンバー・Orb）が含まれていません" };

  const expected = hashSignal(signal.toLowerCase()).toLowerCase();
  if (!item.signal_hash || item.signal_hash.toLowerCase() !== expected)
    return { ok: false, code: "signal_mismatch", reason: "証明がこの誕生セッションに紐付いていません" };

  const used = (await deps.db.execute({ sql: `SELECT 1 FROM used_nullifiers WHERE nullifier = ?`, args: [item.nullifier] })).rows[0];
  if (used && !deps.allowExisting) return { ok: false, code: "duplicate", reason: "この World ID ではすでに相棒が生まれています（1人1体）" };

  const score = typeof item.sybil_score === "number" ? item.sybil_score : null;
  if (deps.sybilMax !== undefined && score !== null && score > deps.sybilMax)
    return { ok: false, code: "sybil_risk", reason: `重複登録のリスクが高いと判定されました（sybil_score=${score}）` };

  return { ok: true, nullifier: item.nullifier, sybilScore: score, credential: item.identifier };
}

export async function markNullifierUsed(db: Db, nullifier: string, now: number) {
  await db.execute({ sql: `INSERT INTO used_nullifiers VALUES (?, ?)`, args: [nullifier, now] });
}
