import { createHash, randomUUID } from "node:crypto";
import { hashSignal } from "@worldcoin/idkit/hashing";
import type { IDKitResultSession } from "@worldcoin/idkit";
import type { Db, Companion, PendingAction } from "./db";

export async function ensureHumanApproval(db: Db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS human_sessions (human TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, verified_at INTEGER NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS human_challenges (id TEXT PRIMARY KEY, label TEXT NOT NULL, human TEXT NOT NULL, action_id TEXT, digest TEXT NOT NULL, signal TEXT NOT NULL, nonce TEXT NOT NULL, session_id TEXT, expires_at INTEGER NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS human_proofs (proof_key TEXT PRIMARY KEY, challenge_id TEXT NOT NULL, used_at INTEGER NOT NULL)`);
}
export async function humanSession(db: Db, label: string) {
  await ensureHumanApproval(db);
  const row = (await db.execute({sql:`SELECT h.session_id FROM companions c JOIN human_sessions h ON h.human=COALESCE(c.human,c.world_nullifier) WHERE c.label=?`,args:[label]})).rows[0];
  return row ? String(row.session_id) : null;
}
function digest(a: PendingAction) { return createHash("sha256").update(JSON.stringify([a.id,a.companion,a.intent,a.resolved_to,a.amount_usdc,a.expires_at])).digest("hex"); }
export async function createHumanChallenge(db: Db, label: string, actionId: string | null, nonce: string, now: number) {
  await ensureHumanApproval(db);
  const c=(await db.execute({sql:"SELECT * FROM companions WHERE label=?",args:[label]})).rows[0] as unknown as Companion | undefined;
  if (!c) throw new Error("Companion not found");
  const sessionId=await humanSession(db,label);
  if (!actionId && sessionId) throw new Error("A production identity is already linked; replacement is not supported");
  if (actionId && !sessionId) throw new Error("Link your production World ID first");
  let action: PendingAction | undefined;
  if (actionId) {
    action=(await db.execute({sql:"SELECT * FROM pending_actions WHERE id=? AND companion=?",args:[actionId,label]})).rows[0] as unknown as PendingAction | undefined;
    if (!action || action.status!=="pending" || now>=action.expires_at) throw new Error("Action is missing, expired or already processed");
  }
  const id=randomUUID(), signal=createHash("sha256").update(`${id}:${label}:${action?digest(action):"enroll"}`).digest("hex");
  const expires=Math.min(now+300000,action?.expires_at??Infinity);
  await db.execute({sql:"INSERT INTO human_challenges VALUES (?,?,?,?,?,?,?,?,?)",args:[id,label,c.human??c.world_nullifier,actionId,action?digest(action):"enroll",signal,nonce,sessionId,expires]});
  return {id,signal,sessionId,expiresAt:expires,action:action?{intent:JSON.parse(action.intent),amountUsdc:action.amount_usdc,resolvedTo:action.resolved_to}:null};
}
/** Portal validates the cryptography; local checks bind the proof to owner, action, environment and nonce. */
export async function completeHumanChallenge(db: Db, label: string, id: string, proof: IDKitResultSession, now: number, deps: {
  verify: (proof: IDKitResultSession)=>Promise<boolean>;
  execute: (action: PendingAction,companion: Companion)=>Promise<{txHash?:string}>;
}) {
  await ensureHumanApproval(db);
  const ch=(await db.execute({sql:"SELECT * FROM human_challenges WHERE id=? AND label=?",args:[id,label]})).rows[0];
  if (!ch || now>=Number(ch.expires_at)) throw new Error("Verification challenge expired or already used");
  if (proof.protocol_version!=="4.0" || proof.environment!=="production" || proof.nonce!==ch.nonce || !/^session_.+/.test(proof.session_id)) throw new Error("Production proof does not match this challenge");
  if (ch.session_id && proof.session_id!==ch.session_id) throw new Error("A different World ID cannot approve this action");
  const expected=hashSignal(String(ch.signal)).toLowerCase();
  if (!proof.responses?.length || proof.responses.some(r=>r.signal_hash?.toLowerCase()!==expected || r.session_nullifier?.length!==2 || ![1,11,9303,9310].includes(r.issuer_schema_id))) throw new Error("A fresh production credential proof bound to this action is required");
  const keys=proof.responses.map(r=>`${proof.session_id}:${r.issuer_schema_id}:${r.session_nullifier.map(v=>BigInt(v).toString()).join(":")}`);
  if (!await deps.verify(proof)) throw new Error("World ID production verification failed");
  const tx=await db.transaction("write");
  let action: PendingAction | undefined, companion: Companion | undefined;
  try {
    // Recheck time and single-use state after network verification and inside the write lock.
    const consumed=await tx.execute({sql:"DELETE FROM human_challenges WHERE id=? AND label=? AND expires_at>? RETURNING *",args:[id,label,Math.max(now,Date.now())]});
    if (consumed.rows.length!==1) throw new Error("Verification challenge expired or already used");
    for (const key of keys) await tx.execute({sql:"INSERT INTO human_proofs VALUES (?,?,?)",args:[key,id,now]});
    if (!ch.action_id) {
      await tx.execute({sql:"INSERT INTO human_sessions VALUES (?,?,?)",args:[String(ch.human),proof.session_id,now]});
      await tx.execute({sql:"INSERT INTO identity_bindings (label,issuer,verified_at) SELECT label,'https://developer.world.org',? FROM companions WHERE COALESCE(human,world_nullifier)=? ON CONFLICT(label) DO UPDATE SET issuer=excluded.issuer,verified_at=excluded.verified_at",args:[now,String(ch.human)]});
    } else {
      const bound=(await tx.execute({sql:"SELECT session_id FROM human_sessions WHERE human=?",args:[String(ch.human)]})).rows[0];
      if (bound?.session_id!==proof.session_id) throw new Error("World ID binding changed");
      action=(await tx.execute({sql:"SELECT * FROM pending_actions WHERE id=? AND companion=?",args:[String(ch.action_id),label]})).rows[0] as unknown as PendingAction | undefined;
      if (!action || action.status!=="pending" || action.expires_at<=Math.max(now,Date.now()) || digest(action)!==ch.digest) throw new Error("Action changed, expired or already processed");
      companion=(await tx.execute({sql:"SELECT * FROM companions WHERE label=?",args:[label]})).rows[0] as unknown as Companion;
      if ((companion.human??companion.world_nullifier)!==ch.human) throw new Error("Owner changed");
      await tx.execute({sql:"UPDATE pending_actions SET status='executed',reason='executing' WHERE id=?",args:[action.id]});
    }
    await tx.commit();
  } catch(e) { await tx.rollback(); throw e; } finally { tx.close(); }
  if (!action || !companion) return {enrolled:true};
  try {
    const result=await deps.execute(action,companion);
    await db.execute({sql:"UPDATE pending_actions SET reason=NULL,tx_hash=? WHERE id=?",args:[result.txHash??null,action.id]});
    return {enrolled:false,actionId:action.id,txHash:result.txHash};
  } catch(e) {
    await db.execute({sql:"UPDATE pending_actions SET status=CASE WHEN tx_hash IS NULL THEN 'rejected' ELSE 'executed' END,reason=CASE WHEN tx_hash IS NULL THEN 'execution_failed' ELSE 'confirmation_pending' END WHERE id=?",args:[action.id]});
    throw e;
  }
}
