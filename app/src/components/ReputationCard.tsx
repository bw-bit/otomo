"use client";

import { useEffect, useState } from "react";
import { LANG_LOCALES, t, type Lang } from "@/lib/i18n";
import { DEMO_COPY } from "@/lib/demo-copy";
import { ProfileDisclosure } from "./ProfileDisclosure";
import type { ReputationSnapshot } from "@/lib/reputation";

export function ReputationCard({ snapshot, managed, preview = false, lang = "en" }: { snapshot: ReputationSnapshot; managed: boolean; preview?: boolean; lang?: Lang }) {
  const [approval, setApproval] = useState<{ actionId: string; snapshot: ReputationSnapshot } | null>(null);
  const [publication, setPublication] = useState<{ status: string; tx_hash: string; published_at: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preview) return;
    void fetch("/api/reputation").then((r) => r.json()).then((b) => setPublication(b.publication ?? null)).catch(() => {});
  }, [preview]);

  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/reputation", { method: "POST" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setApproval(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("preparePublicationFailed", lang));
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/reputation", { method: "PATCH" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setPublication(b.publication);
      if (b.publication.error) setError(b.publication.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("recheckFailed", lang));
    } finally {
      setBusy(false);
    }
  };

  const shown = approval?.snapshot ?? snapshot;
  const counts = [
    [t("delivered", lang), shown.delivered],
    [t("reviewed", lang), shown.reviewed],
    [t("rewardsReceived", lang), shown.paid],
  ] as const;
  const environment = shown.verification.environment === "staging"
    ? t("environmentStaging", lang)
    : shown.verification.environment === "sandbox"
      ? t("environmentSandbox", lang)
      : t("environmentUnknown", lang);

  return <section className="card" aria-label={t("reputationTitle", lang)}>
    <h2>{t("reputationTitle", lang)}</h2>
    {preview && <p><strong>{t("reputationSample", lang)}</strong></p>}
    <p>
      {shown.verification.bound ? t("humanBound", lang) : t("humanUnbound", lang)} · {shown.verification.environment === "production"
        ? t("productionBirthAuth", lang)
        : `${environment} / ${t("testBirthAuth", lang)}`}
    </p>
    <p>{t("approvalService", lang)}: {shown.verification.approvalIssuer.includes("sandbox")
      ? t("sandboxIdentity", lang)
      : shown.verification.approvalIssuer === "unknown"
        ? t("unverified", lang)
        : shown.verification.approvalIssuer}</p>
    <p className="small">{DEMO_COPY[lang].counts}</p>
    <dl className="profile-metrics">
      {counts.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>{value}<small style={{ fontSize: 14 }}> {t("countUnit", lang)}</small></dd>
      </div>)}
    </dl>
    <p>{t("reputationDisclaimer", lang)}</p>
    <p>{t("summaryDate", lang)}: {new Date(shown.asOf).toLocaleString(LANG_LOCALES[lang])}</p>
    {publication && <p>
      {publication.status === "verified" ? t("publicationVerified", lang) : t("publicationUnconfirmed", lang)} · {" "}
      <a href={`https://sepolia.etherscan.io/tx/${publication.tx_hash}`} target="_blank" rel="noreferrer">{t("publicationTx", lang)}</a>
    </p>}
    {publication && <button className="ghost" onClick={recheck} disabled={busy}>{t("recheckEns", lang)}</button>}
    {publication?.status === "verified" && <a href={`/profile/${snapshot.name.split(".")[0]}`}>{t("viewPublicProfile", lang)}</a>}
    <details className="plain" open={Boolean(approval)}><summary>{DEMO_COPY[lang].technical}</summary><ProfileDisclosure lang={lang} /></details>
    {managed && !approval && <button onClick={prepare} disabled={busy}>
      {busy ? t("preparing", lang) : t("reviewPublishContent", lang)}
    </button>}
    {approval && <div className="card">
      <p>{t("publicationDetails", lang, { name: shown.name })}</p>
      <a href={`/api/auth/start?kind=approve&action=${approval.actionId}`}><button>{t("publishWithWorldId", lang)}</button></a>
      <button className="ghost" onClick={() => setApproval(null)}>{t("back", lang)}</button>
    </div>}
    {error && <p className="ng" role="alert">{error}</p>}
  </section>;
}
