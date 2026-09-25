"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { CompanionAvatar } from "@/components/CompanionAvatar";
import { ENS_SEPOLIA, erc20Abi } from "@/lib/ens";

interface Action { id: string; intent: string; amount_usdc: number; status: string; reason: string | null; tx_hash: string | null; expires_at: number }
interface FriendReq { id: string; from_label: string; to_label: string; task: string; reward_usdc: number; status: string }
interface State {
  label: string; fullName: string; owner: string; bound: boolean; agent: `0x${string}`; allowanceUsdc: number;
  ens: { address: string | null; mood: string | null; personality: string | null };
  actions: Action[]; inbox: FriendReq[]; outbox: FriendReq[]; messages: { role: string; content: string }[];
}

const INTENT_LABEL: Record<string, string> = { send_usdc: "送金", request_friend: "友達への依頼", private_task: "個人的な頼みごと" };

export default function CompanionPage() {
  const params = useSearchParams();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = useState("20");
  const { writeContractAsync } = useWriteContract();

  const load = useCallback(async () => {
    const r = await fetch("/api/companion");
    const b = await r.json();
    if (!r.ok) setError(b.error);
    else setS(b);
  }, []);
  useEffect(() => void load(), [load]);

  const authResult = params.get("auth");
  const authReason = params.get("reason");

  const send = async () => {
    if (!input.trim()) return;
    setBusy(true);
    setNote(null);
    const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: input }) });
    const b = await r.json();
    setBusy(false);
    if (!r.ok) return setError(b.error);
    setInput("");
    if (b.decision?.kind === "reject") setNote(`できません: ${b.decision.reason}`);
    if (b.decision?.kind === "auto" && b.txHash) setNote("気分を ENS に書き込みました");
    if (b.decision?.kind === "needs_approval") setNote("顔での承認が必要な依頼です（5分以内）");
    load();
  };

  const approveCap = async () => {
    if (!s) return;
    try {
      await writeContractAsync({ address: ENS_SEPOLIA.mockUsdc, abi: erc20Abi, functionName: "approve", args: [s.agent, parseUnits(cap || "0", 6)] });
      setNote("相棒に預ける上限を更新しました（反映まで数秒）");
      setTimeout(load, 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateReq = async (id: string, status: "accepted" | "done") => {
    const r = await fetch("/api/friend-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (!r.ok) setError((await r.json()).error);
    load();
  };

  if (error && !s) return <main className="stage"><section className="panel"><p className="ng">{error}</p></section></main>;
  if (!s) return <main className="stage"><section className="panel"><p>読み込み中…</p></section></main>;

  const pending = s.actions.filter((a) => a.status === "pending" && a.expires_at > Date.now());

  return (
    <main className="stage" style={{ gridTemplateRows: "38vh auto" }}>
      <CompanionAvatar seed={s.fullName} className="scene" />
      <div style={{ height: "38vh" }} />
      <section className="panel">
        <h1>{s.fullName}</h1>
        <p>ENS から読んだ気分: <b>{s.ens.mood ?? "（未設定）"}</b> ／ 解決先: <span className="mono">{s.ens.address ?? "未解決"}</span></p>
        {authResult === "ok" && <p>承認しました。依頼を実行しました。</p>}
        {authResult === "ng" && <p className="ng">実行しませんでした: {authReason}</p>}
        {!s.bound && (
          <div className="card">
            <p>まだ契りを結んでいません。重要な依頼はこの本人確認に紐付きます。</p>
            <a href="/api/auth/start?kind=bind"><button>World ID で契りを結ぶ</button></a>
          </div>
        )}

        <div className="chat">
          {s.messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
        </div>
        <div className="row">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()} placeholder="相棒にお願いする" />
          <button onClick={send} disabled={busy}>{busy ? "…" : "送る"}</button>
        </div>
        {note && <p>{note}</p>}
        {error && <p className="ng">{error}</p>}

        {pending.map((a) => {
          const intent = JSON.parse(a.intent);
          return (
            <div className="card" key={a.id}>
              <p><b>{INTENT_LABEL[intent.type] ?? intent.type}</b> {a.amount_usdc > 0 && `${a.amount_usdc} USDC`}</p>
              <p className="mono">{JSON.stringify(intent)}</p>
              <a href={`/api/auth/start?kind=approve&action=${a.id}`}><button disabled={!s.bound}>顔で承認する</button></a>
            </div>
          );
        })}

        {s.actions.filter((a) => a.status !== "pending").slice(0, 5).map((a) => (
          <p key={a.id} className={a.status === "executed" ? "" : "ng"}>
            {a.status}: {a.reason ?? ""}{" "}
            {a.tx_hash && <a href={`https://sepolia.etherscan.io/tx/${a.tx_hash}`} target="_blank" rel="noreferrer">tx</a>}
          </p>
        ))}

        {s.inbox.length > 0 && <h1 style={{ fontSize: 16, marginTop: 16 }}>友達の相棒からの依頼</h1>}
        {s.inbox.map((r) => (
          <div className="card" key={r.id}>
            <p>{r.from_label} より: {r.task}（報酬 {r.reward_usdc} USDC）— {r.status}</p>
            {r.status === "open" && <button onClick={() => updateReq(r.id, "accepted")}>引き受ける</button>}
            {r.status === "accepted" && <button onClick={() => updateReq(r.id, "done")}>完了した</button>}
          </div>
        ))}

        <div className="card">
          <p>相棒に預けている上限: {s.allowanceUsdc} USDC（オンチェーンの approve。相棒はこれ以上動かせません）</p>
          <div className="row">
            <input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} />
            <button className="ghost" onClick={approveCap}>上限を設定</button>
          </div>
        </div>
      </section>
    </main>
  );
}
