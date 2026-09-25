"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { maxUint256, parseUnits } from "viem";
import { useAccount, useConnect, usePublicClient, useWriteContract } from "wagmi";
import { CompanionAvatar } from "@/components/CompanionAvatar";
import { ENS_SEPOLIA, erc20Abi } from "@/lib/ens";
import { aquaAbi } from "@/lib/aquaAbi";

interface Action { id: string; intent: string; amount_usdc: number; status: string; reason: string | null; tx_hash: string | null; expires_at: number }
interface FriendReq { id: string; from_label: string; to_label: string; task: string; reward_usdc: number; status: string }
interface State {
  label: string; fullName: string; owner: string; bound: boolean; agent: `0x${string}`; allowanceUsdc: number;
  ens: { address: string | null; mood: string | null; personality: string | null };
  actions: Action[]; inbox: FriendReq[]; outbox: FriendReq[]; messages: { role: string; content: string }[];
}

interface ShipParams {
  aqua: `0x${string}`; router: `0x${string}`; tokens: `0x${string}`[]; amounts: string[]; strategy: `0x${string}`;
  approvals: { token: `0x${string}`; spender: `0x${string}`; amount: string }[];
}
interface StrategyRow {
  id: string; maker: string; router: string; strategy_hash: string | null;
  usdc_amount: number; weth_amount: number; deadline: number;
  status: "ready" | "shipped" | "docked"; ship_tx: string | null; dock_tx: string | null;
  ship?: ShipParams; virtual?: { usdc: number; weth: number }; wallet?: { usdc: number; weth: number };
  paramsError?: string;
}
interface StratState {
  env: { aqua: `0x${string}`; router: `0x${string}`; usdc: `0x${string}`; weth: `0x${string}` } | null;
  strategies: StrategyRow[];
}

const INTENT_LABEL: Record<string, string> = { send_usdc: "送金", request_friend: "友達への依頼", private_task: "個人的な頼みごと", grow_savings: "貯金の運用" };

export default function CompanionPage() {
  const params = useSearchParams();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = useState("20");
  const [strat, setStrat] = useState<StratState | null>(null);
  const { writeContractAsync } = useWriteContract();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const publicClient = usePublicClient();

  const load = useCallback(async () => {
    const r = await fetch("/api/companion");
    const b = await r.json();
    if (!r.ok) setError(b.error);
    else setS(b);
    const sr = await fetch("/api/strategies");
    if (sr.ok) setStrat(await sr.json());
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

  const mintTestUsdc = async () => {
    if (!address) return;
    try {
      await writeContractAsync({ address: ENS_SEPOLIA.mockUsdc, abi: erc20Abi, functionName: "mint", args: [address, parseUnits("1000", 6)] });
      setNote("テスト用 mUSDC 1000 を受け取りました（反映まで数秒）");
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

  const postStrategy = async (id: string, body: object) => {
    const r = await fetch(`/api/strategies/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    return b;
  };

  // Maker ships the strategy herself: approve Aqua for both tokens (only if the
  // current allowance is short), then aqua.ship. The funds stay in her wallet.
  const ship = async (st: StrategyRow) => {
    if (!st.ship || !publicClient || !address) return;
    setBusy(true);
    setError(null);
    try {
      for (const ap of st.ship.approvals) {
        const current = await publicClient.readContract({
          address: ap.token, abi: erc20Abi, functionName: "allowance", args: [address, ap.spender],
        });
        if (current < BigInt(ap.amount)) {
          await writeContractAsync({ address: ap.token, abi: erc20Abi, functionName: "approve", args: [ap.spender, maxUint256] });
        }
      }
      const hash = await writeContractAsync({
        address: st.ship.aqua, abi: aquaAbi, functionName: "ship",
        args: [st.ship.router, st.ship.strategy, st.ship.tokens, st.ship.amounts.map(BigInt)],
      });
      await postStrategy(st.id, { event: "shipped", txHash: hash });
      setNote("運用を開始しました（資金はウォレットに残ったままです）");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const demoSwap = async (st: StrategyRow) => {
    setBusy(true);
    setError(null);
    try {
      const b = await postStrategy(st.id, { event: "demo_swap" });
      setNote(`相棒が第三者としてスワップしました（tx: ${b.txHash}）`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dock = async (st: StrategyRow) => {
    if (!strat?.env || !st.strategy_hash) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: strat.env.aqua, abi: aquaAbi, functionName: "dock",
        args: [st.router as `0x${string}`, st.strategy_hash as `0x${string}`, [strat.env.usdc, strat.env.weth]],
      });
      await postStrategy(st.id, { event: "docked", txHash: hash });
      setNote("運用を終了しました");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

        {(strat?.strategies.length ?? 0) > 0 && (
          <>
            <h1 style={{ fontSize: 16, marginTop: 16 }}>貯金の運用（1inch Aqua）</h1>
            {strat!.strategies.map((st) => (
              <div className="card" key={st.id}>
                <p>
                  <b>{st.usdc_amount} USDC + {st.weth_amount} mWETH</b> の AMM 戦略（手数料 0.3%・期限 {new Date(st.deadline * 1000).toLocaleString("ja-JP")}）
                </p>
                {st.paramsError && <p className="ng">{st.paramsError}</p>}
                {st.status === "ready" && st.ship && (
                  isConnected ? (
                    <button onClick={() => ship(st)} disabled={busy}>{busy ? "…" : "承認して運用を始める（MetaMask）"}</button>
                  ) : (
                    <button onClick={() => connectors[0] && connectAsync({ connector: connectors[0] })} disabled={isConnecting}>
                      {isConnecting ? "ウォレットの確認待ち…" : "ウォレットを接続して運用を始める"}
                    </button>
                  )
                )}
                {st.status === "shipped" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <p style={{ margin: 0 }}>ウォレット残高</p>
                        <p className="mono" style={{ margin: 0 }}>{st.wallet ? `${st.wallet.usdc} USDC / ${st.wallet.weth} mWETH` : "…"}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0 }}>Aqua が預かっている額（仮想）</p>
                        <p className="mono" style={{ margin: 0 }}>{st.virtual ? `${st.virtual.usdc} USDC / ${st.virtual.weth} mWETH` : "…"}</p>
                      </div>
                    </div>
                    <p>お金はウォレットから出ていません。Aqua は残高を記録するだけで、動くのはスワップ成立の瞬間だけです。</p>
                    <div className="row">
                      <button className="ghost" onClick={() => demoSwap(st)} disabled={busy}>相棒に取引を受けさせる（デモ）</button>
                      <button className="ghost" onClick={() => dock(st)} disabled={busy || !isConnected}>運用をやめる（dock）</button>
                    </div>
                  </>
                )}
                {st.status === "docked" && <p>運用終了済み</p>}
                <p>
                  {st.ship_tx && <a href={`https://sepolia.etherscan.io/tx/${st.ship_tx}`} target="_blank" rel="noreferrer">ship tx</a>}
                  {st.ship_tx && st.dock_tx && " / "}
                  {st.dock_tx && <a href={`https://sepolia.etherscan.io/tx/${st.dock_tx}`} target="_blank" rel="noreferrer">dock tx</a>}
                </p>
              </div>
            ))}
          </>
        )}

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
            <button className="ghost" onClick={mintTestUsdc} disabled={!address}>テスト用 mUSDC を受け取る（Sepolia）</button>
          </div>
        </div>
      </section>
    </main>
  );
}
