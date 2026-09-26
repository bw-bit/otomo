"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { maxUint256, parseUnits } from "viem";
import { useAccount, useConnect, usePublicClient, useWriteContract } from "wagmi";
import { LanguageSelect } from "@/components/LanguageSelect";
import { AQUA_COPY } from "@/lib/aqua-copy";
import { ROOM_COPY } from "@/lib/room-copy";
import { WorkDelivery } from "@/components/WorkDelivery";
import { ReputationCard } from "@/components/ReputationCard";
import { LiveTalk } from "@/components/LiveTalk";
import { useLanguage } from "@/hooks/useLanguage";
import type { ReputationSnapshot } from "@/lib/reputation";
import { CompanionRoom } from "@/components/CompanionRoom";
import { ENS_SEPOLIA, erc20Abi } from "@/lib/ens";
import { aquaAbi } from "@/lib/aquaAbi";
import { LANG_LOCALES, t, type Lang } from "@/lib/i18n";
import { birthStageText, intentPlainText, requestStatusText } from "@/lib/plain";

interface Action { id: string; intent: string; amount_usdc: number; status: string; reason: string | null; tx_hash: string | null; expires_at: number }
interface FriendReq { reward_expires_at?: number; reward_status?: string; reward_reason?: string | null; reward_tx_hash?: string | null; content?: string; reviewed_at?: number; reward_action_id?: string; id: string; from_label: string; to_label: string; task: string; reward_usdc: number; status: string }
interface State {
  provisioning?: { status: string; error: string | null };
  managed: boolean; reputation: ReputationSnapshot;
  label: string; fullName: string; role: "personal" | "work"; owner: string; bound: boolean; agent: `0x${string}`; allowanceUsdc: number;
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
  funding?: { ready: boolean; missing: { usdc: number; weth: number } };
  paramsError?: string;
}
interface StratState {
  env: { aqua: `0x${string}`; router: `0x${string}`; usdc: `0x${string}`; weth: `0x${string}` } | null;
  strategies: StrategyRow[];
}

const subKey = (lang: Lang, content: string) => `${lang}:${content}`;
const JAPANESE_KANA = /[\u3040-\u30ff]/u;

interface PeerCompanion { label: string; full_name: string; role: "personal" | "work"; skills?: string[] }

export default function CompanionPage() {
  const params = useSearchParams();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchLock = useRef(false);
  const loadVersion = useRef(0);
  const speechVersion = useRef(0);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = useState("20");
  const [strat, setStrat] = useState<StratState | null>(null);
  const [mine, setMine] = useState<PeerCompanion[]>([]);
  const [network, setNetwork] = useState<PeerCompanion[]>([]);
  const { lang, setLang } = useLanguage();
  const roomCopy = ROOM_COPY[lang];
  const aquaCopy = AQUA_COPY[lang];
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [, setSubsTick] = useState(0);
  const subsMap = useRef(new Map<string, string>());
  const subsPending = useRef(new Set<string>());
  const subsFailed = useRef(new Set<string>());
  const subsRequests = useRef(new Map<string, Promise<void>>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);
  const langRef = useRef(lang);
  const autoSpeakRef = useRef(autoSpeak);
  const prevMsgCount = useRef(-1);
  const speakRef = useRef<((content: string) => Promise<void>) | null>(null);
  const { writeContractAsync } = useWriteContract();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const publicClient = usePublicClient();

  useEffect(() => { langRef.current = lang; speechVersion.current++; audioRef.current?.pause(); setSpeaking(null); }, [lang]);
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);
  useEffect(() => {
    if (localStorage.getItem("otomo.autospeak") === "1") setAutoSpeak(true);
    return () => audioRef.current?.pause();
  }, []);

  const fetchTranslations = useCallback(async (texts: string[], target: Lang): Promise<string[] | null> => {
    const r = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts, target }),
    });
    const b = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(b?.translations)) return null;
    return b.translations as string[];
  }, []);

  const ensureTranslations = useCallback(async (texts: string[], target: Lang): Promise<(string | null)[]> => {
    const unique = [...new Set(texts)];
    const missing = unique.filter((content) => {
      const key = subKey(target, content);
      return !subsMap.current.has(key) && !subsPending.current.has(key) && !subsFailed.current.has(key);
    });

    if (missing.length) {
      const keys = missing.map((content) => subKey(target, content));
      keys.forEach((key) => subsPending.current.add(key));
      const request = (async () => {
        try {
          const translations = await fetchTranslations(missing, target);
          for (const [index, content] of missing.entries()) {
            const key = keys[index]!;
            const translated = translations?.[index]?.trim();
            if (translated && !(translated === content && JAPANESE_KANA.test(content))) {
              subsMap.current.set(key, translated);
            } else {
              subsFailed.current.add(key);
            }
          }
        } catch {
          keys.forEach((key) => subsFailed.current.add(key));
        } finally {
          keys.forEach((key) => subsPending.current.delete(key));
          setSubsTick((n) => n + 1);
        }
      })();
      keys.forEach((key) => subsRequests.current.set(key, request));
    }

    await Promise.all(unique
      .map((content) => subsRequests.current.get(subKey(target, content)))
      .filter((request): request is Promise<void> => request !== undefined));
    return texts.map((content) => subsMap.current.get(subKey(target, content)) ?? null);
  }, [fetchTranslations]);

  /** Speaks the message in the currently selected language (translating first if needed). */
  const speak = useCallback(async (content: string, idx: number) => {
    const version = ++speechVersion.current;
    try {
      setSpeaking(idx);
      const l = langRef.current;
      let text = content;
      if (l !== "ja") {
        subsFailed.current.delete(subKey(l, content));
        const translated = (await ensureTranslations([content], l))[0];
        if (!translated) {
          setNote(t("translationUnavailable", l));
          setSpeaking(null);
          return;
        }
        text = translated;
      }
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, lang: l }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      if (version !== speechVersion.current) return;
      const url = URL.createObjectURL(blob);
      audioRef.current?.pause();
      if (audioRef.current) URL.revokeObjectURL(audioRef.current.src);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = audio.onerror = () => { setSpeaking(null); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (e) {
      setSpeaking(null);
      setNote(`${t("speakFail", langRef.current)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [ensureTranslations]);
  speakRef.current = (content: string) => speak(content, -1);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [companion, strategies, household, peers] = await Promise.allSettled([
        fetch("/api/companion").then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b as State; }),
        fetch("/api/strategies").then(async r => r.ok ? r.json() : null),
        fetch("/api/companions/mine").then(async r => r.ok ? r.json() : null),
        fetch("/api/companions").then(async r => r.ok ? r.json() : null),
      ]);
      if (version !== loadVersion.current) return false;
      if (companion.status === "rejected") throw companion.reason;
      const b = companion.value;
      setS(b); setError(null);
      if (strategies.status === "fulfilled") setStrat(strategies.value);
      if (household.status === "fulfilled" && household.value) setMine(household.value.companions ?? []);
      if (peers.status === "fulfilled" && peers.value) setNetwork(peers.value.companions ?? []);
      const last = b.messages.at(-1);
      if (autoSpeakRef.current && prevMsgCount.current >= 0 && b.messages.length > prevMsgCount.current && last?.role === "assistant") void speakRef.current?.(last.content);
      prevMsgCount.current = b.messages.length;
      return true;
    } catch (e) {
      if (version === loadVersion.current) setError(e instanceof Error ? e.message : t("loading", langRef.current));
      return false;
    }
  }, []);

  const switchTo = async (to: string) => {
    if (switchLock.current || busy || to === s?.label) return;
    switchLock.current = true; setSwitching(true); loadVersion.current++;
    speechVersion.current++; audioRef.current?.pause(); setSpeaking(null);
    try {
      const r = await fetch("/api/session/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: to }) });
      if (!r.ok) throw Error((await r.json().catch(() => null))?.error ?? t("switchFailed", langRef.current));
      prevMsgCount.current = -1;
      if (!await load()) { window.location.assign(`/otomo/${to}`); return; }
      window.history.replaceState(window.history.state, "", `/otomo/${to}`);
      setInput(""); setNote(null); setMenuOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : t("switchFailed", langRef.current)); }
    finally { switchLock.current = false; setSwitching(false); }
  };
  useEffect(() => { void load(); }, [load]);

  // Lazily translate assistant messages into the selected language for subtitles.
  useEffect(() => {
    if (!s || lang === "ja") return;
    void ensureTranslations(s.messages.filter((message) => message.role === "assistant").map((message) => message.content), lang);
  }, [s, lang, ensureTranslations]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [s?.label, s?.messages.length]);

  const authResult = params.get("auth");
  const authReason = params.get("reason");

  const send = async () => {
    if (!input.trim() || busy || switchLock.current) return;
    setBusy(true);
    setNote(null);
    setError(null);
    const message = input;
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setInput(current => current === message ? "" : current);
      if (b.decision?.kind === "reject") setNote(`${t("cannot", langRef.current)}: ${b.decision.reason}`);
      if (b.decision?.kind === "auto" && b.txHash) setNote(t("noteMood", langRef.current));
      if (b.decision?.kind === "needs_approval") setNote(t("noteApproval", langRef.current));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const approveCap = async () => {
    if (!s) return;
    try {
      await writeContractAsync({ address: ENS_SEPOLIA.mockUsdc, abi: erc20Abi, functionName: "approve", args: [s.agent, parseUnits(cap || "0", 6)] });
      setNote(t("noteCap", langRef.current));
      setTimeout(load, 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const mintTestUsdc = async () => {
    if (!address) return;
    try {
      await writeContractAsync({ address: ENS_SEPOLIA.mockUsdc, abi: erc20Abi, functionName: "mint", args: [address, parseUnits("1000", 6)] });
      setNote(t("noteMint", langRef.current));
      setTimeout(load, 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateReq = async (id: string, status: "accepted" | "delivered" | "done" | "renew_reward") => {
    if (busy || switchLock.current) return;
    setBusy(true); setError(null);
    if (status === "delivered") setS(prev => prev ? { ...prev, inbox: prev.inbox.map(r => r.id === id ? { ...r, status: "working" } : r) } : prev);
    try {
      const r = await fetch("/api/friend-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
      const b = await r.json();
      await load();
      if (!r.ok) setError(b.error);
    } catch (e) { await load(); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const postStrategy = async (id: string, body: object) => {
    const r = await fetch(`/api/strategies/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    return b;
  };

  const prepareStrategy = async (st: StrategyRow, operation: "ship" | "dock" | "demo_swap") => {
    setBusy(true);
    try { await postStrategy(st.id, { event: "prepare", operation }); await load(); setNote(t("operationQueued", langRef.current)); }
    catch (e) { setError(e instanceof Error ? e.message : t("operationPrepareFailed", langRef.current)); }
    finally { setBusy(false); }
  };

  // Maker ships the strategy herself: approve Aqua for both tokens (only if the
  // current allowance is short), then aqua.ship. The funds stay in her wallet.
  const ship = async (st: StrategyRow) => {
    if (s?.managed) { await prepareStrategy(st, "ship"); return; }
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
      setNote(t("noteShipped", langRef.current));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const demoSwap = async (st: StrategyRow) => {
    if (s?.managed) { await prepareStrategy(st, "demo_swap"); return; }
    setBusy(true);
    setError(null);
    try {
      const b = await postStrategy(st.id, { event: "demo_swap" });
      setNote(t("noteDemo", langRef.current, { tx: b.txHash }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dock = async (st: StrategyRow) => {
    if (s?.managed) { await prepareStrategy(st, "dock"); return; }
    if (!strat?.env || !st.strategy_hash) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: strat.env.aqua, abi: aquaAbi, functionName: "dock",
        args: [st.router as `0x${string}`, st.strategy_hash as `0x${string}`, [strat.env.usdc, strat.env.weth]],
      });
      await postStrategy(st.id, { event: "docked", txHash: hash });
      setNote(t("noteDocked", langRef.current));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !s) return <main className="stage"><section className="panel"><p className="ng">{error}</p></section></main>;
  if (!s) return <main className="stage"><section className="panel"><p>{t("loading", lang)}</p></section></main>;

  const pending = s.actions.filter((a) => a.status === "pending" && a.expires_at > Date.now());
  const roomCompanions = (mine.length ? mine : [{ label: s.label, full_name: s.fullName, role: s.role }]).map((m) => ({ label: m.label, full_name: m.full_name, role: m.role }));
  const lastAssistant = [...s.messages].reverse().find((m) => m.role === "assistant")?.content;
  const lastAssistantKey = lastAssistant ? subKey(lang, lastAssistant) : null;
  const roomBubble = !lastAssistant
    ? undefined
    : lang === "ja"
      ? lastAssistant
      : subsMap.current.get(lastAssistantKey!) ?? (subsFailed.current.has(lastAssistantKey!) ? t("translationUnavailable", lang) : t("translationLoading", lang));
  const openDetails = () => {
    setMenuOpen(false);
    setDetailsOpen(true);
    setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  };

  return (
    <main className="stage" style={{ gridTemplateRows: "var(--room-height) auto" }}>
      <CompanionRoom
        className="roomscene"
        companions={roomCompanions}
        current={s.label}
        onSelect={switchTo}
        bubble={roomBubble}
        thinking={busy}
        lang={lang}
      />
      {switching && <div className="room-progress" role="status">{roomCopy.switching}</div>}
      {mine.length < 3 && <a className="plusbtn" href="/" aria-label={t("newCompanion", lang)} style={{ top: "calc(var(--room-height) - 66px)" }}>＋</a>}
      <div className="menuwrap">
        <button className="menubtn" aria-label={t("menu", lang)} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>≡</button>
        {menuOpen && (
          <div className="menupop">
            <LanguageSelect lang={lang} setLang={setLang} />
            <button className="ghost small" onClick={openDetails}>{roomCopy.details}</button>
            <a href={`/profile/${s.label}`}><button className="ghost small" style={{ width: "100%" }}>{t("publicProfile", lang)}</button></a>
            <button className="ghost small" onClick={async () => { await fetch("/api/logout", { method: "POST" }); window.location.href = "/"; }}>{t("logout", lang)}</button>
          </div>
        )}
      </div>
      <div />
      <section className="panel" inert={switching}>
        <div className="room-toolbar"><h1>{s.label} <small className="small">· {t(s.role === "personal" ? "roleTagPersonal" : "roleTagWork", lang)}</small></h1>
        <button className="audio-toggle" aria-pressed={autoSpeak} title={roomCopy.voiceHint} onClick={() => {
          const next = !autoSpeak; setAutoSpeak(next); autoSpeakRef.current = next;
          try { localStorage.setItem("otomo.autospeak", next ? "1" : "0"); } catch { /* Toggle works without persistence. */ }
          if (!next) { speechVersion.current++; audioRef.current?.pause(); setSpeaking(null); }
        }}>{autoSpeak ? "🔊" : "🔇"} {autoSpeak ? roomCopy.voiceOn : roomCopy.voiceOff}</button></div>
        {s.provisioning && s.provisioning.status !== "ready" && <p className="ng">{t("provisioningStatus", lang, { status: birthStageText(s.provisioning.status, lang) })}</p>}
        {authResult === "ok" && <p>{t("approved", lang)}</p>}
        {authResult === "ng" && <p className="ng">{t("rejected", lang)}: {authReason}</p>}
        {!s.bound && (
          <div className="card">
            <p>{t("bindIntro", lang)}</p>
            <a href="/api/auth/start?kind=bind"><button>{t("bindingAction", lang)}</button></a>
          </div>
        )}

        <div className="chat" ref={chatRef}>
          {s.messages.map((m, i) => {
            if (m.role !== "assistant") return <div key={i} className="msg user">{m.content}</div>;
            return (
              <div key={i} className="msgwrap">
                <div className="msg assistant">
                  {lang === "ja"
                    ? m.content
                    : subsMap.current.get(subKey(lang, m.content)) ?? (subsFailed.current.has(subKey(lang, m.content)) ? t("translationUnavailable", lang) : t("translationLoading", lang))}
                  {subsFailed.current.has(subKey(lang, m.content)) && <button className="linklike" onClick={() => {
                    subsFailed.current.delete(subKey(lang, m.content)); setSubsTick(n => n + 1);
                    void ensureTranslations([m.content], lang);
                  }}>{t("retryTranslation", lang)}</button>}
                  <button
                    className="speakbtn"
                    onClick={() => void speak(m.content, i)}
                    disabled={speaking === i}
                    title={t("speak", lang)}
                    aria-label={t("speak", lang)}
                  >
                    {speaking === i ? "…" : "🔊"}
                  </button>
                </div>
                {lang !== "ja" && <details className="plain subtitle"><summary>{t("originalText", lang)}</summary><p>{m.content}</p></details>}
              </div>
            );
          })}
        </div>
        <div className="chat-composer">
          <input ref={inputRef} aria-label={t("placeholder", lang)} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()} placeholder={t("placeholder", lang)} />
          <LiveTalk label={s.label} lang={lang} compact />
          <button className="composer-send" onClick={send} disabled={busy}>{busy ? "…" : t("send", lang)}</button>
        </div>
        {note && <p>{note}</p>}
        {error && <p className="ng">{error}</p>}

        {pending.map((a) => {
          const intent = JSON.parse(a.intent);
          return (
            <div className="card" key={a.id}>
              <p><b>{intentPlainText(intent, lang)}</b></p>
              <a href={`/api/auth/start?kind=approve&action=${a.id}`}><button disabled={!s.bound}>{t("pendingApproval", lang)}</button></a>
              <details className="plain"><summary>{t("details", lang)}</summary><p className="mono">{JSON.stringify(intent)}</p></details>
            </div>
          );
        })}

        {s.role === "personal" && strat?.env && <section className="card aqua-intro">
          <h2>{aquaCopy.title}</h2><p>{aquaCopy.intro}</p><p className="small">{aquaCopy.facts}</p>
          {!strat.strategies.some(st => st.status !== "docked") && <button className="ghost small" onClick={() => { setInput(aquaCopy.prompt); inputRef.current?.focus(); }}>{aquaCopy.prepare}</button>}
        </section>}
        {(strat?.strategies.length ?? 0) > 0 && (
          <>
            <h1 style={{ fontSize: 16, marginTop: 16 }}>{t("savings", lang)}</h1>
            {strat!.strategies.map((st) => (
              <div className="card" key={st.id}>
                <p>
                  <b>{t("strategyAmounts", lang, { usdc: st.usdc_amount, weth: st.weth_amount })}</b>{" "}
                  {t("strategyDesc", lang, { deadline: new Date(st.deadline * 1000).toLocaleString(LANG_LOCALES[lang]) })}
                </p>
                {st.paramsError && <p className="ng">{st.paramsError}</p>}
                {st.status === "ready" && st.funding && !st.funding.ready && <div>
                  <p>{aquaCopy.missing}: {st.funding.missing.usdc.toFixed(6)} mUSDC / {st.funding.missing.weth.toFixed(6)} mWETH</p>
                  {s.managed && <button className="ghost small" disabled={busy} onClick={async () => {
                    setBusy(true); setError(null);
                    try { await postStrategy(st.id, { event: "fund_demo" }); await load(); setNote(aquaCopy.funded); }
                    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                    finally { setBusy(false); }
                  }}>{aquaCopy.fund}</button>}
                </div>}
                {st.status === "ready" && st.ship && (
                  (s.managed || isConnected) ? (
                    <button onClick={() => ship(st)} disabled={busy || st.funding?.ready === false}>{busy ? "…" : t("ship", lang)}</button>
                  ) : (
                    <button onClick={() => connectors[0] && connectAsync({ connector: connectors[0] })} disabled={isConnecting}>
                      {isConnecting ? t("walletWait", lang) : t("connectWallet", lang)}
                    </button>
                  )
                )}
                {st.status === "shipped" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <p style={{ margin: 0 }}>{aquaCopy.wallet}</p>
                        <p className="mono" style={{ margin: 0 }}>{st.wallet ? `${st.wallet.usdc} USDC / ${st.wallet.weth} mWETH` : "…"}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0 }}>{aquaCopy.virtual}</p>
                        <p className="mono" style={{ margin: 0 }}>{st.virtual ? `${st.virtual.usdc} USDC / ${st.virtual.weth} mWETH` : "…"}</p>
                      </div>
                    </div>
                    <p>{s.managed ? t("managedWalletDescription", lang) : t("nonCustodial", lang)}</p>
                    <div className="row">
                      <button className="ghost" onClick={() => demoSwap(st)} disabled={busy}>{t("demoSwap", lang)}</button>
                      <button className="ghost" onClick={() => dock(st)} disabled={busy || (!s.managed && !isConnected)}>{t("dock", lang)}</button>
                    </div>
                  </>
                )}
                {st.status === "docked" && <><p>{aquaCopy.stopped}</p>{st.wallet && <p className="mono">{aquaCopy.wallet}: {st.wallet.usdc} mUSDC / {st.wallet.weth} mWETH</p>}</>}
              </div>
            ))}
          </>
        )}

        {s.inbox.length > 0 && s.role === "work" && <h1 style={{ fontSize: 16, marginTop: 16 }}>{t("workRequests", lang)}</h1>}
        {s.role === "work" && s.inbox.map((r) => (
          <div className="card" key={r.id}>
            <p><b>{r.from_label} → {s.label}</b> · {r.reward_usdc} mUSDC · {requestStatusText(r.status, lang)}</p><details className="plain"><summary>{roomCopy.brief}</summary><p>{r.task}</p></details>
            {r.status === "open" && <button disabled={busy} onClick={() => updateReq(r.id, "accepted")}>{t("acceptRequest", lang)}</button>}
            {r.status === "accepted" && <button disabled={busy} onClick={() => updateReq(r.id, "delivered")}>{t("deliverRequest", lang)}</button>}
            {r.status === "working" && <div><p>{t("workInProgress", lang)}</p><button disabled={busy} onClick={() => updateReq(r.id, "delivered")}>{t("retryDelivery", lang)}</button></div>}
            {r.content && <WorkDelivery content={r.content} title={roomCopy.delivery} /> }
            {r.reward_action_id && <p className="small">{r.reward_status === "executed" && !r.reward_reason && r.reward_tx_hash ? roomCopy.rewardPaid : r.reward_status === "pending" ? (Number(r.reward_expires_at) < Date.now() ? roomCopy.expiredReward : roomCopy.rewardPending) : roomCopy.rewardFailed}</p>}
          </div>
        ))}

        {s.outbox.map(r => <div className="card" key={r.id}>
          <p><b>{s.label} → {r.to_label}</b> · {r.reward_usdc} mUSDC · {requestStatusText(r.status, lang)}</p><details className="plain"><summary>{roomCopy.brief}</summary><p>{r.task}</p></details>
          {r.content && <WorkDelivery content={r.content} title={roomCopy.delivery} /> }
          {r.status === "delivered" && <button disabled={busy} onClick={() => updateReq(r.id, "done")}>{t("receiveDelivery", lang)}</button>}
          {r.reward_action_id && !r.reward_tx_hash && (r.reward_status === "expired" || r.reward_status === "rejected" || (r.reward_status === "pending" && Number(r.reward_expires_at) < Date.now())) && <button className="ghost small" disabled={busy} onClick={() => updateReq(r.id, "renew_reward")}>{roomCopy.renewReward}</button>}
          {r.reward_action_id && <p className="small">{r.reward_status === "executed" && !r.reward_reason && r.reward_tx_hash ? roomCopy.rewardPaid : r.reward_status === "pending" ? (Number(r.reward_expires_at) < Date.now() ? roomCopy.expiredReward : roomCopy.rewardPending) : roomCopy.rewardFailed}</p>}
        </div>)}

        {s.role === "personal" && network.some(p => p.role === "work" && p.label !== s.label) && <div className="card">
          <button className="ghost small" onClick={() => { const peer = network.find(p => p.role === "work" && p.label !== s.label)!; setInput(roomCopy.demoPrompt.replace("{name}", peer.full_name)); inputRef.current?.focus(); }}>{roomCopy.demo}</button>
          <p className="small">{roomCopy.demoHint}</p>
        </div>}
        {network.some((p) => p.role === "work" && p.label !== s.label) && (
          <div className="card">
            <p><b>{t("workCompanions", lang)}</b></p>
            {network.filter((p) => p.role === "work" && p.label !== s.label).map((p) => (
              <p key={p.label}>
                {p.full_name}{p.skills?.length ? ` · ${p.skills.join("、")}` : ""}{" "}
                <button className="small" onClick={() => { setInput(t("companionMention", lang, { name: p.full_name })); inputRef.current?.focus(); }}>{t("askThisCompanion", lang)}</button>
              </p>
            ))}
          </div>
        )}

        {!s.managed && <div className="card">
          <p>{t("allowanceInfo", lang, { amount: s.allowanceUsdc })}</p>
          <div className="row">
            <input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} />
            <button className="ghost" onClick={approveCap}>{t("setCap", lang)}</button>
            <button className="ghost" onClick={mintTestUsdc} disabled={!address}>{t("mint", lang)}</button>
          </div>
        </div>}

        <details className="plain details-entry" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)} ref={(el) => { detailsRef.current = el; }}>
          <summary>{roomCopy.details}</summary>
          <p>{roomCopy.detailsHint}</p>
          <p className="small">
            ENS: {s.fullName}
            <br />{t("moodLabel", lang)}: <b>{s.ens.mood ?? t("unset", lang)}</b>
            <br />{t("resolveTo", lang)}: <span className="mono">{s.ens.address ?? t("unresolved", lang)}</span>
          </p>
          <ReputationCard key={s.label} snapshot={s.reputation} managed={s.managed} lang={lang} />
          {s.actions.filter((a) => a.status !== "pending").slice(0, 5).map((a) => (
            <p key={a.id} className={a.status === "executed" ? "small" : "ng"}>
              {a.reason === "executing" ? t("statusExecuting", lang) : a.reason === "confirmation_pending" ? t("statusConfirming", lang) : a.status}: {a.reason === "executing" || a.reason === "confirmation_pending" ? "" : a.reason ?? ""}{" "}
              {a.tx_hash && <a href={`https://sepolia.etherscan.io/tx/${a.tx_hash}`} target="_blank" rel="noreferrer">tx</a>}
            </p>
          ))}
          {strat?.strategies.map((st) => (
            <p key={st.id} className="small">
              {st.ship_tx && <a href={`https://sepolia.etherscan.io/tx/${st.ship_tx}`} target="_blank" rel="noreferrer">{t("shipTx", lang)}</a>}
              {st.ship_tx && st.dock_tx && " / "}
              {st.dock_tx && <a href={`https://sepolia.etherscan.io/tx/${st.dock_tx}`} target="_blank" rel="noreferrer">{t("dockTx", lang)}</a>}
            </p>
          ))}
        </details>
      </section>
    </main>
  );
}
