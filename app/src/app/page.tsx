"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IDKitErrorCodes, IDKitRequestWidget, proofOfHuman, setDebug, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { BirthScene, type BirthPhase } from "@/components/BirthScene";
import { BIRTH_ACTION } from "@/lib/birth";
import { birthStageProgress, birthStageText } from "@/lib/plain";

setDebug(true);

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const WORLD_ENV = (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging") as "production" | "staging" | "sandbox";
const PARENT = "otomo.eth";
const LABEL_RE = /^[a-z0-9-]{3,20}$/;

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
  const [role, setRole] = useState<"personal" | "work">("personal");
  const [phase, setPhase] = useState<BirthPhase>("idle");
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signal, setSignal] = useState("");
  const [mode, setMode] = useState<"birth" | "login">("birth");
  const [reservedLabel, setReservedLabel] = useState<string | null>(null);
  const [born, setBorn] = useState<Born | null>(null);
  const [verifiedCompanion, setVerifiedCompanion] = useState<string | null>(null);
  const [birthStage, setBirthStage] = useState("preparing");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pokeNonce, setPokeNonce] = useState(0);
  useEffect(() => {
    fetch("/api/companions/mine").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (typeof data.current === "string") setVerifiedCompanion(data.current);
      }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (phase !== "forming") return;
    const started = Date.now();
    setBirthStage("preparing");
    setElapsedSeconds(0);
    let active = true;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    const poll = async () => {
      if (!verifiedCompanion || mode !== "birth") return;
      try {
        const res = await fetch(`/api/birth/status?label=${encodeURIComponent(label)}`, { cache: "no-store" });
        if (res.ok && active) {
          const data = await res.json();
          if (typeof data.status === "string") setBirthStage(data.status);
        }
      } catch { /* The request can continue while a progress poll fails. */ }
    };
    void poll();
    const timer = window.setInterval(() => { updateElapsed(); void poll(); }, 3000);
    const clock = window.setInterval(updateElapsed, 1000);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(clock); };
  }, [phase, label, mode, verifiedCompanion]);
  const fail = (msg: string) => {
    setError(msg);
    setPhase("failed");
    setTimeout(() => setPhase((p) => (p === "failed" ? "idle" : p)), 2600);
  };

  const start = async () => {
    setError(null);
    if (mode === "birth" && verifiedCompanion) {
      try { await submitBirth(undefined, true); }
      catch { fail("相棒の追加に接続できませんでした。もう一度お試しください"); }
      return;
    }
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

  const submitBirth = async (result: IDKitResult | undefined, reuseVerifiedHuman: boolean) => {
    setPhase("forming");
    const res = await fetch(mode === "login" ? "/api/login" : "/api/birth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, hint, role, idkitResult: result, reuseVerifiedHuman }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 503 && typeof body.label === "string") setReservedLabel(body.label);
      fail(body.error ?? "誕生に失敗しました");
      if (!reuseVerifiedHuman) throw new Error(body.error);
      return;
    }
    if (mode === "login") { window.location.href = `/otomo/${body.label}`; return; }
    setBorn(body);
    setPhase("born");
  };
  const handleVerify = (result: IDKitResult) => submitBirth(result, false);

  const goExisting = async () => {
    if (verifiedCompanion) {
      window.location.href = `/otomo/${verifiedCompanion}`;
      return;
    }
    setMode("login");
    setError(null);
  };

  const validLabel = LABEL_RE.test(label);
  const previewSeed = mode === "birth" && validLabel ? `${label}.${PARENT}` : null;
  const working = phase === "verifying" || phase === "forming";

  return (
    <main className="stage">
      <BirthScene className="scene" phase={phase} seed={born?.fullName ?? previewSeed} previewSeed={previewSeed} pokeNonce={pokeNonce} />
      <div />
      <section className="panel">
        {!born ? (
          mode === "birth" ? (
            <>
              <h1>あなただけの相棒が生まれます</h1>
              <p>スマホの World App でかんたん本人確認。</p>
              {verifiedCompanion && <p>{verifiedCompanion} と一緒に暮らす仲間を迎えます（本人確認は不要）</p>}
              <div className="row">
                <input
                  placeholder="名前（英小文字・数字）"
                  value={label}
                  onChange={(e) => { setLabel(e.target.value.toLowerCase()); setPokeNonce((n) => n + 1); }}
                  maxLength={20}
                  disabled={working}
                />
              </div>
              {previewSeed && <p className="small">名前で姿が変わるよ</p>}
              <div className="row">
                <input
                  placeholder="どんな子がいい？（例: のんびり、しっかり者）"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  maxLength={200}
                  disabled={working}
                />
              </div>
              <div className="row" role="radiogroup" aria-label="相棒の役割">
                <button type="button" className={`rolecard${role === "personal" ? " selected" : ""}`} onClick={() => setRole("personal")} disabled={working} aria-pressed={role === "personal"}>
                  <b>くらしの相棒</b>
                  <small>話し相手・秘書・おさいふ番</small>
                </button>
                <button type="button" className={`rolecard${role === "work" ? " selected" : ""}`} onClick={() => setRole("work")} disabled={working} aria-pressed={role === "work"}>
                  <b>しごとの相棒</b>
                  <small>頼まれた仕事をして届ける</small>
                </button>
              </div>
              {phase === "verifying" && <p role="status">スマホの World App で確認してね</p>}
              {phase === "forming" && (
                <div role="status" aria-live="polite">
                  <p>{birthStageText(birthStage)}</p>
                  <div className="progress"><div style={{ width: `${Math.round(birthStageProgress(birthStage) * 100)}%` }} /></div>
                  <p className="small">{elapsedSeconds} 秒経過</p>
                </div>
              )}
              <div className="row">
                <button onClick={start} disabled={!validLabel || working}>
                  {phase === "forming" ? "生まれています…" : verifiedCompanion ? "仲間を迎える" : "サインアップ"}
                </button>
              </div>
              {error && (
                <div>
                  <p className="ng">うまくいきませんでした。もう一度ためしてね</p>
                  <details className="plain"><summary>くわしく</summary><p className="mono">{error}</p></details>
                </div>
              )}
              {reservedLabel && <Link href={`/otomo/${reservedLabel}`}>保存された相棒の状態を確認する</Link>}
              <p className="small" style={{ marginTop: 18 }}>
                <button className="linklike" onClick={() => void goExisting()}>作成済みの方はこちら</button>
              </p>
            </>
          ) : (
            <>
              <h1>おかえりなさい</h1>
              <p>World ID でログインすると、あなたの相棒に会えます。</p>
              {phase === "verifying" && <p role="status">スマホの World App で確認してね</p>}
              {phase === "forming" && (
                <div role="status" aria-live="polite">
                  <p>おうちを探しています…</p>
                  <div className="progress"><div style={{ width: "70%" }} /></div>
                  <p className="small">{elapsedSeconds} 秒経過</p>
                </div>
              )}
              <div className="row">
                <button onClick={start} disabled={working}>{phase === "forming" ? "まっています…" : "World IDでログイン"}</button>
              </div>
              {error && (
                <div>
                  <p className="ng">うまくいきませんでした。もう一度ためしてね</p>
                  <details className="plain"><summary>くわしく</summary><p className="mono">{error}</p></details>
                </div>
              )}
              {reservedLabel && <Link href={`/otomo/${reservedLabel}`}>保存された相棒の状態を確認する</Link>}
              <p className="small" style={{ marginTop: 18 }}>
                <button className="linklike" onClick={() => { setMode("birth"); setError(null); }}>新しく作る</button>
              </p>
            </>
          )
        ) : (
          <>
            <h1>{born.label}</h1>
            <div className="roombubble show" style={{ position: "relative", transform: "none", maxWidth: "100%" }}>{born.personality.catchphrase}</div>
            <p>{born.personality.tone}</p>
            <div className="row">
              <Link href={`/otomo/${born.label}`}><button>会いにいく</button></Link>
            </div>
            <details className="plain" style={{ marginTop: 14 }}>
              <summary>くわしく</summary>
              <p className="small">
                {born.fullName} — この名前は譲渡できません。
                {born.registerTx && (
                  <a href={`https://sepolia.etherscan.io/tx/${born.registerTx}`} target="_blank" rel="noreferrer">登録トランザクション</a>
                )}
              </p>
            </details>
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
          allow_legacy_proofs={true}
          environment={WORLD_ENV}
          preset={proofOfHuman({ signal })}
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
