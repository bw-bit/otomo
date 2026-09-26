"use client";

import { useState } from "react";
import Link from "next/link";
import { IDKitErrorCodes, IDKitRequestWidget, mnc, passport, proofOfHuman, selfieCheck, setDebug, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { BirthScene, type BirthPhase } from "@/components/BirthScene";
import { BIRTH_ACTION } from "@/lib/birth";

setDebug(true);

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const WORLD_ENV = (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging") as "production" | "staging" | "sandbox";
type BirthCredential = "human" | "passport" | "mnc" | "selfie";

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
  const [credential, setCredential] = useState<BirthCredential>("human");
  const [role, setRole] = useState<"personal" | "work">("personal");
  const [phase, setPhase] = useState<BirthPhase>("idle");
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signal, setSignal] = useState("");
  const [mode, setMode] = useState<"birth" | "login">("birth");
  const [reservedLabel, setReservedLabel] = useState<string | null>(null);
  const [born, setBorn] = useState<Born | null>(null);
  const fail = (msg: string) => {
    setError(msg);
    setPhase("failed");
    setTimeout(() => setPhase((p) => (p === "failed" ? "idle" : p)), 2600);
  };

  const start = async () => {
    setError(null);
    if (!APP_ID) return fail("NEXT_PUBLIC_WORLD_APP_ID が設定されていません");
    setPhase("verifying");
    try {
      const res = await fetch("/api/world/rp-signature", { method: "POST" });
      const sig = await res.json();
      if (!res.ok) return fail(sig.error ?? "RP 署名の取得に失敗しました");
      setSignal(sig.signal);
      setRp({ rp_id: sig.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig });
      setOpen(true);
    } catch { fail("認証の準備に接続できませんでした。もう一度お試しください"); }
  };

  const handleVerify = async (result: IDKitResult) => {
    setPhase("forming");
    const res = await fetch(mode === "login" ? "/api/login" : "/api/birth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, hint, role, idkitResult: result }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 503 && typeof body.label === "string") setReservedLabel(body.label);
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
            <p>World ID の本人確認（Proof of Human・Orb・Selfie・パスポート・マイナンバーカードのいずれか）で相棒が生まれます。同じ認証識別子で作れる相棒は最大3体です（個人・仕事など役割ごとに）。画像や文書の中身は受け取らず、検証結果と重複防止用の識別子だけを保存します。</p>
            <p>ウォレット接続は不要です。相棒はSepolia上の専用テストウォレットを持ちます。</p>
            <div className="row"><button className="ghost" disabled={phase === "verifying" || phase === "forming"} onClick={() => setMode(mode === "birth" ? "login" : "birth")}>{mode === "birth" ? "すでに相棒がいる方はこちら" : "新しい相棒を迎える"}</button></div>
            {mode === "birth" && <>
                <div className="row">
                  <input placeholder="相棒の名前（英小文字・数字・-）" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} maxLength={20} />
                </div>
                <div className="row">
                  <input placeholder="どんな相棒がいい？（任意）" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={200} />
                </div>
                <div className="row">
                  <select className="credential-select" aria-label="相棒の役割" value={role} onChange={(e) => setRole(e.target.value === "work" ? "work" : "personal")} disabled={phase === "verifying" || phase === "forming"}>
                    <option value="personal">個人（秘書・会話・支払い）</option>
                    <option value="work">仕事（依頼を受けて納品）</option>
                  </select>
                </div>
            </>}
            <div className="row">
              <select className="credential-select" aria-label="World IDの資格情報" value={credential} onChange={(e) => setCredential(e.target.value as BirthCredential)} disabled={phase === "verifying" || phase === "forming"}>
                <option value="human">Proof of Human / Orb</option>
                <option value="passport">パスポート</option>
                <option value="mnc">マイナンバーカード</option>
                <option value="selfie">Selfie Check</option>
              </select>
            </div>
                <div className="row">
                  <button onClick={start} disabled={(mode === "birth" && label.length < 3) || phase === "verifying" || phase === "forming"}>
                    {phase === "forming" ? "生まれています…" : mode === "login" ? "World IDで相棒に会う" : "World IDで相棒を迎える"}
                  </button>
                </div>
            {error && <p className="ng">{error}</p>}
            {reservedLabel && <Link href={`/otomo/${reservedLabel}`}>保存された相棒の状態を確認する</Link>}
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
          onOpenChange={(value) => { setOpen(value); if (!value) setPhase(p => p === "verifying" ? "idle" : p); }}
          app_id={APP_ID}
          action={BIRTH_ACTION}
          rp_context={rp}
          allow_legacy_proofs={credential !== "selfie"}
          environment={WORLD_ENV}
          preset={credential === "human" ? proofOfHuman({ signal }) : credential === "passport" ? passport({ signal }) : credential === "mnc" ? mnc({ signal }) : selfieCheck({ signal })}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code, report) => {
            console.error("[idkit] error", code, report);
            setOpen(false);
            if (code === IDKitErrorCodes.FailedByHostApp) {
              setError((previous) => previous ?? `World IDの確認を完了できませんでした（code: ${code}）`);
            } else {
              fail(`World IDの確認を完了できませんでした（code: ${code}）`);
            }
          }}
        />
      )}
    </main>
  );
}
