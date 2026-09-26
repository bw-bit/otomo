"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IDKitErrorCodes, IDKitRequestWidget, proofOfHuman, setDebug, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { BirthScene, type BirthPhase } from "@/components/BirthScene";
import { LanguageSelect } from "@/components/LanguageSelect";
import { useLanguage } from "@/hooks/useLanguage";
import { BIRTH_ACTION } from "@/lib/birth";
import { t } from "@/lib/i18n";
import { birthStageProgress, birthStageText } from "@/lib/plain";

setDebug(true);

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const WORLD_ENV = (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging") as "production" | "staging" | "sandbox";
const PARENT = "otomo.eth";
const LABEL_RE = /^[a-z0-9-]{3,20}$/;
const JAPANESE_KANA = /[\u3040-\u30ff]/u;

interface Born {
  label: string;
  fullName: string;
  resolver: `0x${string}`;
  registerTx: string;
  needsAgentGrant: boolean;
  personality: { firstPerson: string; tone: string; strengths: string[]; catchphrase: string };
}

export default function BirthPage() {
  const { lang, setLang } = useLanguage();
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
  const [worldIdDuplicate, setWorldIdDuplicate] = useState(false);
  const [verifiedCompanion, setVerifiedCompanion] = useState<string | null>(null);
  const [birthStage, setBirthStage] = useState("preparing");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pokeNonce, setPokeNonce] = useState(0);
  const bornTranslations = useRef(new Map<string, [string, string] | null>());
  const bornTranslationsPending = useRef(new Set<string>());
  const [, setBornTranslationVersion] = useState(0);
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
  useEffect(() => {
    if (!born || lang === "ja") return;
    const key = `${lang}:${born.fullName}`;
    if (bornTranslations.current.has(key) || bornTranslationsPending.current.has(key)) return;
    bornTranslationsPending.current.add(key);
    void (async () => {
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ texts: [born.personality.catchphrase, born.personality.tone], target: lang }),
        });
        const data = await response.json().catch(() => null);
        const translated = response.ok && Array.isArray(data?.translations) ? data.translations as string[] : null;
        const usable = translated?.length === 2 && translated.every((text, index) =>
          typeof text === "string" && text.trim().length > 0 &&
          !(text === [born.personality.catchphrase, born.personality.tone][index] && JAPANESE_KANA.test(text)),
        );
        bornTranslations.current.set(key, usable ? [translated![0]!, translated![1]!] : null);
      } catch {
        bornTranslations.current.set(key, null);
      } finally {
        bornTranslationsPending.current.delete(key);
        setBornTranslationVersion((version) => version + 1);
      }
    })();
  }, [born, lang]);
  const fail = (msg: string) => {
    setError(msg);
    setPhase("failed");
    setTimeout(() => setPhase((p) => (p === "failed" ? "idle" : p)), 2600);
  };

  const start = async () => {
    setError(null);
    setWorldIdDuplicate(false);
    if (mode === "birth" && verifiedCompanion) {
      try { await submitBirth(undefined, true); }
      catch { fail(t("addCompanionConnectionFailed", lang)); }
      return;
    }
    if (!APP_ID) return fail(t("worldAppMissing", lang));
    setPhase("verifying");
    try {
      const res = await fetch("/api/world/rp-signature", { method: "POST" });
      const sig = await res.json();
      if (!res.ok) return fail(sig.error ?? t("rpSignatureFailed", lang));
      setSignal(sig.signal);
      setRp({ rp_id: sig.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig });
      setOpen(true);
    } catch { fail(t("authPrepareFailed", lang)); }
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
      fail(body.error ?? t("birthFailed", lang));
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
    setWorldIdDuplicate(false);
  };

  const validLabel = LABEL_RE.test(label);
  const previewSeed = mode === "birth" && validLabel ? `${label}.${PARENT}` : null;
  const working = phase === "verifying" || phase === "forming";
  const bornTranslationKey = born ? `${lang}:${born.fullName}` : null;
  const bornTranslation = bornTranslationKey ? bornTranslations.current.get(bornTranslationKey) : undefined;
  const bornTranslationText = lang === "ja"
    ? null
    : bornTranslation ?? (bornTranslationKey && bornTranslations.current.has(bornTranslationKey)
      ? [t("translationUnavailable", lang), t("translationUnavailable", lang)] as [string, string]
      : [t("translationLoading", lang), t("translationLoading", lang)] as [string, string]);

  return (
    <main className="stage">
      <BirthScene className="scene" phase={phase} seed={born?.fullName ?? previewSeed} previewSeed={previewSeed} pokeNonce={pokeNonce} />
      <div />
      <section className="panel">
        <LanguageSelect lang={lang} setLang={setLang} />
        {!born ? (
          mode === "birth" ? (
            <>
              <h1>{t("signupTitle", lang)}</h1>
              <p>{t("signupIntro", lang)}</p>
              {verifiedCompanion && <p>{t("existingCompanionInfo", lang, { label: verifiedCompanion })}</p>}
              <div className="row">
                <input
                  placeholder={t("namePlaceholder", lang)}
                  aria-label={t("namePlaceholder", lang)}
                  value={label}
                  onChange={(e) => { setLabel(e.target.value.toLowerCase()); setPokeNonce((n) => n + 1); }}
                  maxLength={20}
                  disabled={working}
                />
              </div>
              {previewSeed && <p className="small">{t("namePreview", lang)}</p>}
              <div className="row">
                <input
                  placeholder={t("personalityPlaceholder", lang)}
                  aria-label={t("personalityPlaceholder", lang)}
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  maxLength={200}
                  disabled={working}
                />
              </div>
              <div className="row" role="radiogroup" aria-label={t("roleGroup", lang)}>
                <button type="button" className={`rolecard${role === "personal" ? " selected" : ""}`} onClick={() => setRole("personal")} disabled={working} aria-pressed={role === "personal"}>
                  <b>{t("rolePersonalTitle", lang)}</b>
                  <small>{t("rolePersonalDesc", lang)}</small>
                </button>
                <button type="button" className={`rolecard${role === "work" ? " selected" : ""}`} onClick={() => setRole("work")} disabled={working} aria-pressed={role === "work"}>
                  <b>{t("roleWorkTitle", lang)}</b>
                  <small>{t("roleWorkDesc", lang)}</small>
                </button>
              </div>
              {phase === "verifying" && <p role="status">{t("verifyPrompt", lang)}</p>}
              {phase === "forming" && (
                <div role="status" aria-live="polite">
                  <p>{birthStageText(birthStage, lang)}</p>
                  <div className="progress"><div style={{ width: `${Math.round(birthStageProgress(birthStage) * 100)}%` }} /></div>
                  <p className="small">{t("elapsedSeconds", lang, { seconds: elapsedSeconds })}</p>
                </div>
              )}
              <div className="row">
                <button onClick={start} disabled={!validLabel || working}>
                  {phase === "forming" ? t("birthCreating", lang) : verifiedCompanion ? t("inviteCompanion", lang) : t("signup", lang)}
                </button>
              </div>
              {error && (
                <div>
                  <p className="ng">{worldIdDuplicate ? t("worldIdAlreadyHasCompanions", lang) : t("signupError", lang)}</p>
                  <details className="plain"><summary>{t("details", lang)}</summary><p className="mono">{error}</p></details>
                </div>
              )}
              {reservedLabel && <Link href={`/otomo/${reservedLabel}`}>{t("savedCompanionStatus", lang)}</Link>}
              <p className="small" style={{ marginTop: 18 }}>
                <button className="linklike" onClick={() => void goExisting()}>{t("existingUser", lang)}</button>
              </p>
            </>
          ) : (
            <>
              <h1>{t("loginTitle", lang)}</h1>
              <p>{t("loginIntro", lang)}</p>
              {phase === "verifying" && <p role="status">{t("verifyPrompt", lang)}</p>}
              {phase === "forming" && (
                <div role="status" aria-live="polite">
                  <p>{t("findingHome", lang)}</p>
                  <div className="progress"><div style={{ width: "70%" }} /></div>
                  <p className="small">{t("elapsedSeconds", lang, { seconds: elapsedSeconds })}</p>
                </div>
              )}
              <div className="row">
                <button onClick={start} disabled={working}>{phase === "forming" ? t("waiting", lang) : t("login", lang)}</button>
              </div>
              {error && (
                <div>
                  <p className="ng">{t("signupError", lang)}</p>
                  <details className="plain"><summary>{t("details", lang)}</summary><p className="mono">{error}</p></details>
                </div>
              )}
              {reservedLabel && <Link href={`/otomo/${reservedLabel}`}>{t("savedCompanionStatus", lang)}</Link>}
              <p className="small" style={{ marginTop: 18 }}>
                <button className="linklike" onClick={() => { setMode("birth"); setError(null); setWorldIdDuplicate(false); }}>{t("createNew", lang)}</button>
              </p>
            </>
          )
        ) : (
          <>
            <h1>{born.label}</h1>
            <div className="roombubble show" style={{ position: "relative", transform: "none", maxWidth: "100%" }}>{bornTranslationText?.[0] ?? born.personality.catchphrase}</div>
            <p>{bornTranslationText?.[1] ?? born.personality.tone}</p>
            <div className="row">
              <Link href={`/otomo/${born.label}`}><button>{t("visitCompanion", lang)}</button></Link>
            </div>
            <details className="plain" style={{ marginTop: 14 }}>
              <summary>{t("details", lang)}</summary>
              <p className="small">
                {born.fullName} — {t("nonTransferableName", lang)}
                {born.registerTx && (
                  <a href={`https://sepolia.etherscan.io/tx/${born.registerTx}`} target="_blank" rel="noreferrer">{t("registrationTx", lang)}</a>
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
            if (code === IDKitErrorCodes.NullifierReplayed) {
              setWorldIdDuplicate(true);
              setError(t("worldIdFailed", lang, { code }));
              setPhase("idle");
            } else if (code === IDKitErrorCodes.FailedByHostApp) {
              setError((previous) => previous ?? t("worldIdFailed", lang, { code }));
            } else {
              fail(t("worldIdFailed", lang, { code }));
            }
          }}
        />
      )}
    </main>
  );
}
