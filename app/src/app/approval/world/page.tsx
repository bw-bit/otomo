"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/hooks/useLanguage";
import { LanguageSelect } from "@/components/LanguageSelect";
import { LANG_LOCALES, t } from "@/lib/i18n";
import { intentPlainText, type PendingIntent } from "@/lib/plain";

type Action = { id: string; intent: unknown; amountUsdc: number; resolvedTo: string | null; expiresAt: number };
type Status = { label: string; verified: boolean; environment: string; action: Action | null };

export default function HumanApprovalPage() {
  const { lang, setLang } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    const actionId = new URLSearchParams(location.search).get("action");
    fetch(`/api/world/approval${actionId ? `?action=${encodeURIComponent(actionId)}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw Error(j.error);
        setStatus(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function approve(actionId: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/world/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "approve", actionId }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Approval failed");
      setTxHash(j.txHash ?? null);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  const action = status?.action ?? null;
  return (
    <main className="stage">
      <div />
      <section className="panel">
        <LanguageSelect lang={lang} setLang={setLang} />
        <h1>{t("approvalTitle", lang)}</h1>
        {!status && !error && <p>{t("loading", lang)}</p>}
        {status && <p>{t("approvalIntro", lang, { label: status.label })}</p>}
        {status && !done && (action ? (
          <>
            <div className="card"><b>{intentPlainText(action.intent as PendingIntent, lang)}</b></div>
            <p className="small">
              {t("approvalExpires", lang, { time: new Date(action.expiresAt).toLocaleString(LANG_LOCALES[lang]) })}
            </p>
            <div className="row">
              <button onClick={() => void approve(action.id)} disabled={busy}>
                {busy ? t("approvingNow", lang) : t("approveNow", lang)}
              </button>
            </div>
            <details className="plain">
              <summary>{t("details", lang)}</summary>
              <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(action, null, 2)}</pre>
            </details>
          </>
        ) : (
          <p>{t("approvalNone", lang)}</p>
        ))}
        {done && (
          <>
            <p role="status"><b>{t("approvalDone", lang)}</b></p>
            {txHash && (
              <p>
                <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                  {t("viewTransaction", lang)} ↗
                </a>
              </p>
            )}
          </>
        )}
        {status && (
          <p>
            <a className="linklike" href={`/otomo/${status.label}`}>
              {t("backToCompanion", lang, { label: status.label })}
            </a>
          </p>
        )}
        {error && <p role="alert" className="ng">{error}</p>}
      </section>
    </main>
  );
}
