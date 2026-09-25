import type { Db } from "./db";

export const REPUTATION_KEY = "otomo.reputation";

/** Counts are application attestations, not a World-issued credit rating. */
export async function reputationSnapshot(db: Db, label: string, now = Date.now()) {
  const c = (await db.execute({ sql: "SELECT full_name, agent_sub, created_at FROM companions WHERE label = ?", args: [label] })).rows[0];
  if (!c) throw new Error("相棒が見つかりません");
  const identity = (await db.execute({ sql: "SELECT verification_environment FROM companion_identity WHERE label = ?", args: [label] })).rows[0];
  const binding = (await db.execute({ sql: "SELECT issuer FROM identity_bindings WHERE label = ?", args: [label] })).rows[0];
  const metrics = (await db.execute({ sql: `SELECT
    COUNT(*) AS delivered,
    COALESCE(SUM(CASE WHEN d.reviewed_at IS NOT NULL THEN 1 ELSE 0 END),0) AS reviewed,
    COALESCE(SUM(CASE WHEN a.status = 'executed' AND a.reason IS NULL AND a.tx_hash IS NOT NULL THEN 1 ELSE 0 END),0) AS paid
    FROM work_deliveries d JOIN friend_requests f ON f.id = d.request_id
    LEFT JOIN pending_actions a ON a.id = d.reward_action_id
    WHERE f.to_label = ?`, args: [label] })).rows[0];
  return {
    version: 1,
    issuer: "Otomo",
    name: String(c.full_name),
    network: "sepolia",
    verification: { bound: Boolean(c.agent_sub), environment: String(identity?.verification_environment ?? "unknown"), approvalIssuer: binding ? String(binding.issuer) : "unknown" },
    delivered: Number(metrics.delivered),
    reviewed: Number(metrics.reviewed),
    paid: Number(metrics.paid),
    since: Number(c.created_at),
    asOf: now,
    disclaimer: "Application-attested activity; not a World ID trust score. Testnet payments only.",
  };
}

export type ReputationSnapshot = Awaited<ReturnType<typeof reputationSnapshot>>;

/** Recheck the exact saved publication; never overwrite a newer concurrent publication. */
export async function recheckPublication(db: Db, label: string, read: (name: string, key: string) => Promise<string | null>) {
  const row = (await db.execute({ sql: "SELECT p.snapshot,p.tx_hash,c.full_name FROM reputation_publications p JOIN companions c ON c.label=p.label WHERE p.label=?", args: [label] })).rows[0];
  if (!row) throw new Error("公開記録がありません");
  let actual: string | null = null;
  let error: string | null = null;
  try { actual = await read(String(row.full_name), REPUTATION_KEY); }
  catch { error = "ENSに接続できません。時間をおいて再確認してください"; }
  const matched = actual === String(row.snapshot);
  error = matched ? null : error ?? "ENSの現在値と保存済み公開内容が一致しません";
  await db.execute({ sql: "UPDATE reputation_publications SET status=?,error=? WHERE label=? AND snapshot=? AND tx_hash=?", args: [matched ? "verified" : "unverified", error, label, String(row.snapshot), String(row.tx_hash)] });
  return (await db.execute({ sql: "SELECT snapshot,tx_hash,status,published_at,error FROM reputation_publications WHERE label=?", args: [label] })).rows[0];
}
