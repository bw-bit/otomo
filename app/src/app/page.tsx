"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useWriteContract } from "wagmi";
import { IDKitRequestWidget, CredentialRequest, any, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { BirthScene, type BirthPhase } from "@/components/BirthScene";
import { BIRTH_ACTION } from "@/lib/birth";
import { MOOD_KEY, resolverAbi, textSetterFor } from "@/lib/ens";

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const WORLD_ENV = (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging") as "production" | "staging" | "sandbox";

interface Born {
  label: string;
  fullName: string;
  resolver: `0x${string}`;
  registerTx: string;
  needsAgentGrant: boolean;
  personality: { firstPerson: string; tone: string; strengths: string[]; catchphrase: string };
}

export default function BirthPage() {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const [label, setLabel] = useState("");
  const [hint, setHint] = useState("");
  const [phase, setPhase] = useState<BirthPhase>("idle");
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [born, setBorn] = useState<Born | null>(null);
  const [agentAddr, setAgentAddr] = useState<`0x${string}` | null>(null);
  const [grantTx, setGrantTx] = useState<string | null>(null);

  const fail = (msg: string) => {
    setError(msg);
    setPhase("failed");
    setTimeout(() => setPhase((p) => (p === "failed" ? "idle" : p)), 2600);
  };

  const connectWallet = async () => {
    setWalletError(null);
    const connector = connectors[0];
    if (!connector) {
      setWalletError("EVMウォレットが見つかりません。MetaMaskなどの拡張機能を有効にしてください。");
      return;
    }
    try {
      await connectAsync({ connector });
    } catch (cause) {
      const detail = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
      if (/already pending|already processing|request of type .*pending|-32002/i.test(detail)) {
        setWalletError("ウォレットの接続要求が保留中です。MetaMaskの拡張機能を開き、承認または拒否してください。");
      } else if (/provider not found|no provider|injected.*not found/i.test(detail)) {
        setWalletError("EVMウォレットが見つかりません。MetaMaskなどの拡張機能を有効にしてください。");
      } else if (/user rejected|user denied|4001/i.test(detail)) {
        setWalletError("ウォレットで接続がキャンセルされました。");
      } else {
        setWalletError("接続できませんでした。ウォレット拡張機能の画面とロック状態を確認してください。");
      }
    }
  };

  const start = async () => {
    setError(null);
    if (!APP_ID) return fail("NEXT_PUBLIC_WORLD_APP_ID が設定されていません");
    const res = await fetch("/api/world/rp-signature", { method: "POST" });
    const sig = await res.json();
    if (!res.ok) return fail(sig.error ?? "RP 署名の取得に失敗しました");
    setRp({ rp_id: sig.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig });
    setPhase("verifying");
    setOpen(true);
  };

  const handleVerify = async (result: IDKitResult) => {
    setPhase("forming");
    const res = await fetch("/api/birth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, hint, wallet: address, idkitResult: result }),
    });
    const body = await res.json();
    if (!res.ok) {
      fail(body.error ?? "誕生に失敗しました");
      throw new Error(body.error);
    }
    setBorn(body);
    setPhase("born");
    fetch("/api/companion").then((r) => r.json()).then((c) => c.agent && setAgentAddr(c.agent)).catch(() => {});
  };

  const grantMood = async () => {
    if (!born || !agentAddr) return;
    try {
      const hash = await writeContractAsync({
        address: born.resolver,
        abi: resolverAbi,
        functionName: "grantSetterRoles",
        args: [textSetterFor(MOOD_KEY), agentAddr],
      });
      setGrantTx(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="stage">
      <BirthScene className="scene" phase={phase} seed={born?.fullName ?? (phase === "forming" ? `${label}` : null)} />
      <div />
      <section className="panel">
        {!born ? (
          <>
            <h1>世界に一人の相棒を迎える</h1>
            <p>顔の確認（World ID Selfie Check）で、1人に1体だけ相棒が生まれます。顔の画像や個人情報はこのアプリに届きません。</p>
            {!isConnected ? (
              <>
                <div className="row">
                  <button onClick={connectWallet} disabled={isConnecting}>{isConnecting ? "ウォレットの確認待ち…" : "ウォレットを接続"}</button>
                </div>
                <p>MetaMaskなどのEVMウォレットを開き、接続を承認してください。</p>
                {walletError && <p className="ng" role="alert">{walletError}</p>}
              </>
            ) : (
              <>
                <p className="mono">{address}</p>
                <div className="row">
                  <input placeholder="相棒の名前（英小文字・数字・-）" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} maxLength={20} />
                </div>
                <div className="row">
                  <input placeholder="どんな相棒がいい？（任意）" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={200} />
                </div>
                <div className="row">
                  <button onClick={start} disabled={label.length < 3 || phase === "verifying" || phase === "forming"}>
                    {phase === "forming" ? "生まれています…" : "顔で誕生させる"}
                  </button>
                </div>
              </>
            )}
            {error && <p className="ng">{error}</p>}
          </>
        ) : (
          <>
            <h1>{born.fullName}</h1>
            <p>「{born.personality.catchphrase}」 — 一人称「{born.personality.firstPerson}」、{born.personality.tone}</p>
            <p>得意なこと: {born.personality.strengths.join("、")}</p>
            <p>
              この名前は譲渡できません。
              <a href={`https://sepolia.etherscan.io/tx/${born.registerTx}`} target="_blank" rel="noreferrer">登録トランザクション</a>
            </p>
            {born.needsAgentGrant && (
              <div className="card">
                <p>相棒に「気分」だけを書き換える権限を渡します（他のレコードには触れません）。</p>
                <button onClick={grantMood} disabled={!agentAddr || !!grantTx}>{grantTx ? "渡しました" : "権限を渡す"}</button>
              </div>
            )}
            <div className="row">
              <a href="/api/auth/start?kind=bind"><button>World ID で契りを結ぶ</button></a>
              <Link href={`/otomo/${born.label}`}><button className="ghost">相棒と話す</button></Link>
            </div>
            {error && <p className="ng">{error}</p>}
          </>
        )}
      </section>

      {rp && APP_ID && address && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={BIRTH_ACTION}
          rp_context={rp}
          allow_legacy_proofs={false}
          environment={WORLD_ENV}
          constraints={any(CredentialRequest("selfie", { signal: address.toLowerCase() }))}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code) => fail(`顔の確認が完了しませんでした（${code}）`)}
        />
      )}
    </main>
  );
}
