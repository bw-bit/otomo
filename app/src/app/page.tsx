"use client";

import { useState } from "react";
import Link from "next/link";
import { IDKitRequestWidget, CredentialRequest, any, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { BirthScene, type BirthPhase } from "@/components/BirthScene";
import { BIRTH_ACTION } from "@/lib/birth";

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
  const [label, setLabel] = useState("");
  const [hint, setHint] = useState("");
  const [phase, setPhase] = useState<BirthPhase>("idle");
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signal, setSignal] = useState("");
  const [mode, setMode] = useState<"birth" | "login">("birth");
  const [born, setBorn] = useState<Born | null>(null);
  const fail = (msg: string) => {
    setError(msg);
    setPhase("failed");
    setTimeout(() => setPhase((p) => (p === "failed" ? "idle" : p)), 2600);
  };

  const start = async () => {
    setError(null);
    if (!APP_ID) return fail("NEXT_PUBLIC_WORLD_APP_ID が設定されていません");
    const res = await fetch("/api/world/rp-signature", { method: "POST" });
    const sig = await res.json();
    if (!res.ok) return fail(sig.error ?? "RP 署名の取得に失敗しました");
    setSignal(sig.signal);
    setRp({ rp_id: sig.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig });
    setPhase("verifying");
    setOpen(true);
  };

  const handleVerify = async (result: IDKitResult) => {
    setPhase("forming");
    const res = await fetch(mode === "login" ? "/api/login" : "/api/birth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, hint, idkitResult: result }),
    });
    const body = await res.json();
    if (!res.ok) {
      fail(body.error ?? "誕生に失敗しました");
      throw new Error(body.error);
    }
    if (mode === "login") { window.location.href = `/otomo/${body.label}`; return; }
    setBorn(body);
    setPhase("born");
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
            <p>ウォレット接続は不要です。相棒はSepolia上の専用テストウォレットを持ちます。</p>
            <div className="row"><button className="ghost" onClick={() => setMode(mode === "birth" ? "login" : "birth")}>{mode === "birth" ? "すでに相棒がいる方はこちら" : "新しい相棒を迎える"}</button></div>
            {mode === "birth" && <>
                <div className="row">
                  <input placeholder="相棒の名前（英小文字・数字・-）" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} maxLength={20} />
                </div>
                <div className="row">
                  <input placeholder="どんな相棒がいい？（任意）" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={200} />
                </div>
            </>}
                <div className="row">
                  <button onClick={start} disabled={(mode === "birth" && label.length < 3) || phase === "verifying" || phase === "forming"}>
                    {phase === "forming" ? "生まれています…" : mode === "login" ? "World IDで相棒に会う" : "顔で誕生させる"}
                  </button>
                </div>
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
            <div className="row">
              <a href="/api/auth/start?kind=bind"><button>World ID で契りを結ぶ</button></a>
              <Link href={`/otomo/${born.label}`}><button className="ghost">相棒と話す</button></Link>
            </div>
            {error && <p className="ng">{error}</p>}
          </>
        )}
      </section>

      {rp && APP_ID && signal && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={BIRTH_ACTION}
          rp_context={rp}
          allow_legacy_proofs={false}
          environment={WORLD_ENV}
          constraints={any(CredentialRequest("selfie", { signal }))}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code) => fail(`顔の確認が完了しませんでした（${code}）`)}
        />
      )}
    </main>
  );
}
