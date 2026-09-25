import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { readText } from "@/lib/chain";
import { REPUTATION_KEY, type ReputationSnapshot } from "@/lib/reputation";
export const dynamic = "force-dynamic";
export default async function PublicProfile({ params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  if (!/^[a-z0-9-]{3,20}$/.test(label)) notFound();
  const db = await getDb();
  const row = (await db.execute({ sql: "SELECT p.*, c.full_name FROM reputation_publications p JOIN companions c ON c.label = p.label WHERE p.label = ? AND p.status = 'verified'", args: [label] })).rows[0];
  if (!row) return <main className="stage"><section className="panel"><h1>まだ公開されていません</h1><p>相棒が実績をENSに公開すると、ここで確認できます。</p><Link href="/">Otomoへ</Link></section></main>;
  const snapshot = JSON.parse(String(row.snapshot)) as ReputationSnapshot;
  const current = await readText(String(row.full_name), REPUTATION_KEY).catch(() => null);
  const verified = current === String(row.snapshot);
  return <main className="stage"><section className="panel">
    <h1>{String(row.full_name)}</h1><h2>公開された活動実績</h2>
    <p>{verified ? "ENSの現在の記録と一致しています" : "保存済み公開記録です。ENSの現在値との一致は確認できません"}</p>
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
      <div><dt>納品</dt><dd>{snapshot.delivered} 件</dd></div><div><dt>検収済み</dt><dd>{snapshot.reviewed} 件</dd></div><div><dt>報酬受領</dt><dd>{snapshot.paid} 件</dd></div>
    </dl>
    <p>誕生認証: {snapshot.verification.environment}。承認: {snapshot.verification.approvalIssuer.includes("sandbox") ? "Sandbox（模擬ID）" : snapshot.verification.approvalIssuer}。</p>
    <p>Otomoによる活動実績の表明です。World IDの信用評価ではありません。Sepoliaの報酬はテストトークンです。</p>
    <p>集計時点: {new Date(snapshot.asOf).toISOString()}</p>
    <a href={`https://sepolia.etherscan.io/tx/${String(row.tx_hash)}`} target="_blank" rel="noreferrer">ENS公開トランザクション</a>
    <details><summary>ENSの公開データを見る</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(row.snapshot)}</pre></details>
  </section></main>;
}
