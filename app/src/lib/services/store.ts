import type { Db } from "../db";

export async function initServiceStore(db: Db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS service_payments (
    payment_key TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
    seller TEXT NOT NULL, network TEXT NOT NULL, asset TEXT NOT NULL, amount INTEGER NOT NULL,
    status TEXT NOT NULL, result TEXT, settlement TEXT, tx_hash TEXT, created_at INTEGER NOT NULL,
    input_tokens INTEGER, output_tokens INTEGER, UNIQUE(network,tx_hash))`);
  await db.execute("CREATE INDEX IF NOT EXISTS service_payments_seller_time ON service_payments(seller,created_at)");
  await db.execute("CREATE TABLE IF NOT EXISTS service_report_cache (cache_key TEXT PRIMARY KEY, result TEXT NOT NULL, expires_at INTEGER NOT NULL)");
}
export interface PaymentRecord { key: string; proofHash: string; requestHash: string; seller: string; network: string; asset: string; amount: number }
export async function reserveJob(db: Db, payment: PaymentRecord, limit: number, now: number) {
  const tx = await db.transaction("write");
  try {
    const used = Number((await tx.execute({ sql: "SELECT COUNT(*) AS n FROM service_payments WHERE seller=? AND created_at>=?", args: [payment.seller, now-86_400_000] })).rows[0].n);
    if (used >= limit) throw new Error("daily_job_limit");
    const r = await tx.execute({ sql: "INSERT OR IGNORE INTO service_payments (payment_key,proof_hash,request_hash,seller,network,asset,amount,status,created_at) VALUES (?,?,?,?,?,?,?,'processing',?)", args: [payment.key,payment.proofHash,payment.requestHash,payment.seller,payment.network,payment.asset,payment.amount,now] });
    if (r.rowsAffected !== 1) throw new Error("payment_already_used");
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; } finally { tx.close(); }
}

export async function serviceEarnings(db: Db, seller: string, now = Date.now()) {
  await initServiceStore(db);
  const rows = (await db.execute({ sql: `SELECT network,asset,COUNT(*) AS jobs,SUM(amount) AS gross,
    SUM(CASE WHEN created_at>=? THEN amount ELSE 0 END) AS today,
    SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens
    FROM service_payments WHERE seller=? AND status='settled' GROUP BY network,asset`, args: [now-86_400_000,seller] })).rows;
  const recent = (await db.execute({ sql: "SELECT network,amount,tx_hash,created_at FROM service_payments WHERE seller=? AND status='settled' ORDER BY created_at DESC LIMIT 10", args: [seller] })).rows;
  return { balances: rows.map(r => ({ network: String(r.network), asset: String(r.asset), paidJobs: Number(r.jobs), grossUsdc: Number(r.gross)/1e6, last24hUsdc: Number(r.today)/1e6, inputTokens: r.input_tokens === null ? null : Number(r.input_tokens), outputTokens: r.output_tokens === null ? null : Number(r.output_tokens) })), recent: recent.map(r => ({network: String(r.network), amountUsdc: Number(r.amount)/1e6, txHash: String(r.tx_hash), createdAt: Number(r.created_at)})), netProfitUsdc: null, costStatus: "not-configured" };
}
