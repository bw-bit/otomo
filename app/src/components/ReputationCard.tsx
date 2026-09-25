"use client";
import { useEffect, useState } from "react";
import type { ReputationSnapshot } from "@/lib/reputation";

export function ReputationCard({ snapshot, managed, preview = false }: { snapshot: ReputationSnapshot; managed: boolean; preview?: boolean }) {
  const [approval, setApproval] = useState<{ actionId: string; snapshot: ReputationSnapshot } | null>(null);
  const [publication, setPublication] = useState<{ status: string; tx_hash: string; published_at: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (preview) return; void fetch("/api/reputation").then(r => r.json()).then(b => setPublication(b.publication ?? null)).catch(() => {}); }, [preview]);
  const prepare = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/reputation", { method: "POST" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setApproval(b);
    } catch (e) { setError(e instanceof Error ? e.message : "公開の準備に失敗しました"); }
    finally { setBusy(false); }
  };
  const recheck = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/reputation", { method: "PATCH" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setPublication(b.publication);
      if (b.publication.error) setError(b.publication.error);
    } catch (e) { setError(e instanceof Error ? e.message : "再確認に失敗しました"); }
    finally { setBusy(false); }
  };
  const shown = approval?.snapshot ?? snapshot;
  return <section className="card" aria-label="相棒の実績">
    <h2>相棒の実績</h2>
    {preview && <p><strong>表示サンプル · 実際の認証・納品・着金実績ではありません</strong></p>}
    <p>{shown.verification.bound ? "人間パートナーと紐付け済み" : "人間パートナーとの紐付け待ち"} · {shown.verification.environment === "production" ? "本番の誕生認証" : `${shown.verification.environment} / テストまたは未確認の誕生認証`}</p>
    <p>承認サービス: {shown.verification.approvalIssuer.includes("sandbox") ? "Sandbox（模擬ID）" : shown.verification.approvalIssuer === "unknown" ? "未確認" : shown.verification.approvalIssuer}</p>
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      {([["納品", shown.delivered], ["検収済み", shown.reviewed], ["報酬受領", shown.paid]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>{value}<small style={{ fontSize: 14 }}> 件</small></dd></div>)}
    </dl>
    <p>Otomoが記録した活動実績です。World IDが発行する信用評価ではありません。報酬はSepoliaのテストトークンです。</p>
    <p>集計日時: {new Date(shown.asOf).toLocaleString("ja-JP")}</p>
    {publication && <p>{publication.status === "verified" ? "ENSへの公開と読み戻しを確認済み" : "ENSへの書き込み後、読み戻しは未確認"} · <a href={`https://sepolia.etherscan.io/tx/${publication.tx_hash}`} target="_blank" rel="noreferrer">公開トランザクション</a></p>}
    {publication && <button className="ghost" onClick={recheck} disabled={busy}>ENSの現在値を再確認</button>}
    {publication?.status === "verified" && <a href={`/profile/${snapshot.name.split(".")[0]}`}>公開プロフィールを見る</a>}
    {managed && !approval && <button onClick={prepare} disabled={busy}>{busy ? "準備中…" : "ENSで公開する内容を確認"}</button>}
    {approval && <div className="card">
      <p>上の実績を {shown.name} の otomo.reputation に公開します。誰でも読める記録として残ります。顔画像・本人識別子・Sybilスコア・依頼内容は含みません。</p>
      <a href={`/api/auth/start?kind=approve&action=${approval.actionId}`}><button>World IDで承認してENSに公開</button></a>
      <button className="ghost" onClick={() => setApproval(null)}>戻る</button>
    </div>}
    {error && <p className="ng" role="alert">{error}</p>}
  </section>;
}
