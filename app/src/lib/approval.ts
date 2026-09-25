import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type { AuthFlow, Companion, Db, PendingAction } from "./db";
import type { Intent } from "./intent";
import { APPROVAL_TTL_MS } from "./policy";
import { randomToken, type VerifiedIdentity } from "./oidc";

export const AUTH_FLOW_TTL_MS = 10 * 60 * 1000;

export function createPendingAction(
  db: Db,
  p: { companion: string; intent: Intent; resolvedTo?: Address; amountUsdc: number; now: number },
): PendingAction {
  const row: PendingAction = {
    id: randomUUID(),
    companion: p.companion,
    intent: JSON.stringify(p.intent),
    resolved_to: p.resolvedTo ?? null,
    amount_usdc: p.amountUsdc,
    status: "pending",
    reason: null,
    tx_hash: null,
    created_at: p.now,
    expires_at: p.now + APPROVAL_TTL_MS,
  };
  db.prepare(
    `INSERT INTO pending_actions VALUES (@id,@companion,@intent,@resolved_to,@amount_usdc,@status,@reason,@tx_hash,@created_at,@expires_at)`,
  ).run(row);
  return row;
}

export function startAuthFlow(db: Db, p: { kind: AuthFlow["kind"]; ref: string; now: number }): AuthFlow {
  const flow: AuthFlow = {
    state: randomToken(),
    kind: p.kind,
    ref: p.ref,
    nonce: randomToken(),
    code_verifier: randomToken(),
    created_at: p.now,
  };
  db.prepare(`INSERT INTO auth_flows VALUES (@state,@kind,@ref,@nonce,@code_verifier,@created_at)`).run(flow);
  return flow;
}

/** Single-use: the flow row is deleted as soon as it is read. */
export function consumeAuthFlow(db: Db, state: string | null, now: number): AuthFlow | null {
  if (!state) return null;
  const flow = db.prepare(`DELETE FROM auth_flows WHERE state = ? RETURNING *`).get(state) as AuthFlow | undefined;
  if (!flow || now - flow.created_at > AUTH_FLOW_TTL_MS) return null;
  return flow;
}

export interface CallbackInput {
  state: string | null;
  code: string | null;
  error: string | null;
  now: number;
}

export interface CallbackDeps {
  db: Db;
  /** Exchanges the code and verifies the ID token (signature, iss, aud, exp, nonce). */
  authenticate: (code: string, flow: AuthFlow) => Promise<VerifiedIdentity>;
  execute: (action: PendingAction, companion: Companion) => Promise<{ txHash?: string }>;
}

export type CallbackResult =
  | { ok: true; kind: "bind"; companion: string }
  | { ok: true; kind: "approve"; actionId: string; txHash?: string }
  | { ok: false; reason: string; actionId?: string; companion?: string };

function closeAction(db: Db, id: string, status: PendingAction["status"], reason: string) {
  db.prepare(`UPDATE pending_actions SET status = ?, reason = ? WHERE id = ? AND status = 'pending'`).run(status, reason, id);
}

export async function handleAuthCallback(input: CallbackInput, deps: CallbackDeps): Promise<CallbackResult> {
  const { db, now } = { db: deps.db, now: input.now };
  const flow = consumeAuthFlow(db, input.state, now);
  if (!flow) return { ok: false, reason: "認証セッションが無効か期限切れです（state 不一致）" };

  const fail = (reason: string, status: PendingAction["status"] = "rejected"): CallbackResult => {
    if (flow.kind === "approve") {
      closeAction(db, flow.ref, status, reason);
      return { ok: false, reason, actionId: flow.ref };
    }
    return { ok: false, reason, companion: flow.ref };
  };

  if (input.error) return fail(`World ID の認証が完了しませんでした（${input.error}）`);
  if (!input.code) return fail("認可コードがありません");

  let identity: VerifiedIdentity;
  try {
    identity = await deps.authenticate(input.code, flow);
  } catch (e) {
    return fail(`本人確認の検証に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (flow.kind === "bind") {
    const res = db
      .prepare(`UPDATE companions SET agent_sub = ? WHERE label = ? AND agent_sub IS NULL`)
      .run(identity.sub, flow.ref);
    if (res.changes !== 1) return fail("この相棒はすでに別の本人と契りを結んでいます");
    return { ok: true, kind: "bind", companion: flow.ref };
  }

  const action = db.prepare(`SELECT * FROM pending_actions WHERE id = ?`).get(flow.ref) as PendingAction | undefined;
  if (!action || action.status !== "pending") return fail("この依頼はすでに処理済みです");
  if (now > action.expires_at) return fail("承認の期限（5分）が切れました", "expired");
  if (identity.authTime * 1000 < action.created_at) return fail("本人確認が依頼より前のものです（再認証が必要）");

  const companion = db.prepare(`SELECT * FROM companions WHERE label = ?`).get(action.companion) as Companion | undefined;
  if (!companion?.agent_sub) return fail("相棒と本人の契りがまだ結ばれていません");
  if (companion.agent_sub !== identity.sub) return fail("相棒の持ち主と別の人が承認しようとしました");

  // Claim the action atomically so it can execute at most once.
  const claimed = db
    .prepare(`UPDATE pending_actions SET status = 'executed', reason = 'executing' WHERE id = ? AND status = 'pending'`)
    .run(action.id);
  if (claimed.changes !== 1) return fail("この依頼はすでに処理済みです");

  try {
    const { txHash } = await deps.execute(action, companion);
    db.prepare(`UPDATE pending_actions SET reason = NULL, tx_hash = ? WHERE id = ?`).run(txHash ?? null, action.id);
    return { ok: true, kind: "approve", actionId: action.id, txHash };
  } catch (e) {
    const reason = `実行に失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    db.prepare(`UPDATE pending_actions SET status = 'rejected', reason = ? WHERE id = ?`).run(reason, action.id);
    return { ok: false, reason, actionId: action.id };
  }
}
