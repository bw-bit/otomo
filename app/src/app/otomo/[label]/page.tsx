"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { maxUint256, parseUnits } from "viem";
import { useAccount, useConnect, usePublicClient, useWriteContract } from "wagmi";
import { ReputationCard } from "@/components/ReputationCard";
import { LiveTalk } from "@/components/LiveTalk";
import type { ReputationSnapshot } from "@/lib/reputation";
import { CompanionRoom } from "@/components/CompanionRoom";
import { ENS_SEPOLIA, erc20Abi } from "@/lib/ens";
import { aquaAbi } from "@/lib/aquaAbi";
import { LANG_LABELS, LANG_LOCALES, SUPPORTED_LANGS, isLang, t, type Lang } from "@/lib/i18n";
import { intentPlainText, requestStatusText } from "@/lib/plain";

interface Action { id: string; intent: string; amount_usdc: number; status: string; reason: string | null; tx_hash: string | null; expires_at: number }
interface FriendReq { content?: string; reviewed_at?: number; reward_action_id?: string; id: string; from_label: string; to_label: string; task: string; reward_usdc: number; status: string }
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
  paramsError?: string;
}
interface StratState {
  env: { aqua: `0x${string}`; router: `0x${string}`; usdc: `0x${string}`; weth: `0x${string}` } | null;
  strategies: StrategyRow[];
}

const subKey = (lang: Lang, content: string) => `${lang}:${content}`;

interface PeerCompanion { label: string; full_name: string; role: "personal" | "work"; skills?: string[] }
const ROLE_LABEL = { personal: "個人", work: "仕事" } as const;

export default function CompanionPage() {
  const params = useSearchParams();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = useState("20");
  const [strat, setStrat] = useState<StratState | null>(null);
  const [mine, setMine] = useState<PeerCompanion[]>([]);
  const [network, setNetwork] = useState<PeerCompanion[]>([]);
  const [lang, setLang] = useState<Lang>("ja");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [, setSubsTick] = useState(0);
  const subsMap = useRef(new Map<string, string>());
  const subsPending = useRef(new Set<string>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);
  const langRef = useRef(lang);
  const autoSpeakRef = useRef(autoSpeak);
  const prevMsgCount = useRef(-1);
  const speakRef = useRef<((content: string) => Promise<void>) | null>(null);
  const { writeContractAsync } = useWriteContract();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const publicClient = usePublicClient();

  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);
  useEffect(() => {
    const storedLang = localStorage.getItem("otomo.lang");
    if (isLang(storedLang)) setLang(storedLang);
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

  /** Speaks the message in the currently selected language (translating first if needed). */
  const speak = useCallback(async (content: string, idx: number) => {
    try {
      setSpeaking(idx);
      const l = langRef.current;
      let text = content;
      if (l !== "ja") {
        const key = subKey(l, content);
        let translated = subsMap.current.get(key);
        if (translated === undefined) {
          const arr = await fetchTranslations([content], l);
          translated = arr?.[0];
          if (translated !== undefined) {
            subsMap.current.set(key, translated);
            setSubsTick((n) => n + 1);
          }
        }
        if (translated) text = translated;
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
      const url = URL.createObjectURL(await r.blob());
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
  }, [fetchTranslations]);
  speakRef.current = (content: string) => speak(content, -1);

  const load = useCallback(async () => {
    const r = await fetch("/api/companion");
    const b = await r.json();
    if (!r.ok) setError(b.error);
    else {
      setS(b);
      const msgs = (b.messages ?? []) as { role: string; content: string }[];
      const last = msgs.at(-1);
      // Skip the very first load: only read replies that arrive while the page is open.
      if (autoSpeakRef.current && prevMsgCount.current >= 0 && msgs.length > prevMsgCount.current && last?.role === "assistant") {
        void speakRef.current?.(last.content);
      }
      prevMsgCount.current = msgs.length;
    }
    const sr = await fetch("/api/strategies");
    if (sr.ok) setStrat(await sr.json());
    const [mr, nr] = await Promise.all([fetch("/api/companions/mine"), fetch("/api/companions")]);
    if (mr.ok) setMine((await mr.json()).companions ?? []);
    if (nr.ok) setNetwork((await nr.json()).companions ?? []);
  }, []);

  const switchTo = async (to: string) => {
    const r = await fetch("/api/session/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: to }) });
    if (!r.ok) return setError((await r.json().catch(() => null))?.error ?? "切り替えできませんでした");
    window.location.href = `/otomo/${to}`;
  };
  useEffect(() => void load(), [load]);

  // Lazily translate assistant messages into the selected language for subtitles.
  useEffect(() => {
    if (!s || lang === "ja") return;
    const missing = [...new Set(
      s.messages
        .filter((m) => m.role === "assistant")
        .map((m) => m.content)
        .filter((c) => !subsMap.current.has(subKey(lang, c)) && !subsPending.current.has(subKey(lang, c))),
    )];
    if (missing.length === 0) return;
    for (const c of missing) subsPending.current.add(subKey(lang, c));
    void (async () => {
      try {
        const translated = await fetchTranslations(missing, lang);
        if (translated) missing.forEach((c, i) => subsMap.current.set(subKey(lang, c), translated[i] ?? c));
      } finally {
        for (const c of missing) subsPending.current.delete(subKey(lang, c));
        setSubsTick((n) => n + 1);
      }
    })();
  }, [s, lang, fetchTranslations]);

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
    if (b.decision?.kind === "reject") setNote(`${t("cannot", langRef.current)}: ${b.decision.reason}`);
    if (b.decision?.kind === "auto" && b.txHash) setNote(t("noteMood", langRef.current));
    if (b.decision?.kind === "needs_approval") setNote(t("noteApproval", langRef.current));
    load();
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

  const updateReq = async (id: string, status: "accepted" | "delivered" | "done") => {
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

  const prepareStrategy = async (st: StrategyRow, operation: "ship" | "dock" | "demo_swap") => {
    setBusy(true);
    try { await postStrategy(st.id, { event: "prepare", operation }); await load(); setNote("操作を承認待ちに追加しました。内容を確認してWorld IDで承認してください。"); }
    catch (e) { setError(e instanceof Error ? e.message : "操作を準備できませんでした"); }
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
  const openDetails = () => {
    setMenuOpen(false);
    setDetailsOpen(true);
    setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  };

  return (
    <main className="stage" style={{ gridTemplateRows: "52vh auto" }}>
      <CompanionRoom
        className="roomscene"
        companions={roomCompanions}
        current={s.label}
        onSelect={(l) => void switchTo(l)}
        bubble={lastAssistant}
        thinking={busy}
      />
      {mine.length < 3 && <a className="plusbtn" href="/" aria-label="新しい相棒を迎える" style={{ top: "calc(52vh - 66px)" }}>＋</a>}
      <div className="menuwrap">
        <button className="menubtn" aria-label="メニュー" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>≡</button>
        {menuOpen && (
          <div className="menupop">
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {t("language", lang)}
              <select
                className="langsel"
                value={lang}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isLang(next)) {
                    setLang(next);
                    localStorage.setItem("otomo.lang", next);
                  }
                }}
              >
                {SUPPORTED_LANGS.map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={(e) => {
                  setAutoSpeak(e.target.checked);
                  localStorage.setItem("otomo.autospeak", e.target.checked ? "1" : "0");
                }}
              />
              返事を読み上げる
            </label>
            <button className="ghost small" onClick={openDetails}>くわしく</button>
            <a href={`/profile/${s.label}`}><button className="ghost small" style={{ width: "100%" }}>公開プロフィール</button></a>
            <button className="ghost small" onClick={async () => { await fetch("/api/logout", { method: "POST" }); window.location.href = "/"; }}>ログアウト</button>
          </div>
        )}
      </div>
      <div />
      <section className="panel">
        <h1>{s.label} <small className="small">· {ROLE_LABEL[s.role]}</small></h1>
        {s.provisioning && s.provisioning.status !== "ready" && <p className="ng">準備中です: {s.provisioning.status}</p>}
        {authResult === "ok" && <p>{t("approved", lang)}</p>}
        {authResult === "ng" && <p className="ng">{t("rejected", lang)}: {authReason}</p>}
        {!s.bound && (
          <div className="card">
            <p>大事なお願い（お金や外部への依頼）を聞けるように、あなたと約束しよう</p>
            <a href="/api/auth/start?kind=bind"><button>約束する</button></a>
          </div>
        )}

        <div className="chat">
          {s.messages.map((m, i) => {
            if (m.role !== "assistant") return <div key={i} className="msg user">{m.content}</div>;
            return (
              <div key={i} className="msgwrap">
                <div className="msg assistant">
                  {m.content}
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
                {lang !== "ja" && <div className="subtitle">{subsMap.current.get(subKey(lang, m.content)) ?? "…"}</div>}
              </div>
            );
          })}
        </div>
        <div className="row">
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()} placeholder={t("placeholder", lang)} />
          <button onClick={send} disabled={busy}>{busy ? "…" : t("send", lang)}</button>
        </div>
        <LiveTalk label={s.label} lang={lang} />
        {note && <p>{note}</p>}
        {error && <p className="ng">{error}</p>}

        {pending.map((a) => {
          const intent = JSON.parse(a.intent);
          return (
            <div className="card" key={a.id}>
              <p><b>{intentPlainText(intent)}</b></p>
              <a href={`/api/auth/start?kind=approve&action=${a.id}`}><button disabled={!s.bound}>いいよ（本人確認）</button></a>
              <details className="plain"><summary>くわしく</summary><p className="mono">{JSON.stringify(intent)}</p></details>
            </div>
          );
        })}

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
                {st.status === "ready" && st.ship && (
                  (s.managed || isConnected) ? (
                    <button onClick={() => ship(st)} disabled={busy}>{busy ? "…" : t("ship", lang)}</button>
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
                        <p style={{ margin: 0 }}>{t("walletBalance", lang)}</p>
                        <p className="mono" style={{ margin: 0 }}>{st.wallet ? `${st.wallet.usdc} USDC / ${st.wallet.weth} mWETH` : "…"}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0 }}>{t("aquaHolds", lang)}</p>
                        <p className="mono" style={{ margin: 0 }}>{st.virtual ? `${st.virtual.usdc} USDC / ${st.virtual.weth} mWETH` : "…"}</p>
                      </div>
                    </div>
                    <p>{s.managed ? "相棒専用のテストウォレットで運用中です。鍵はサーバーが管理します。" : t("nonCustodial", lang)}</p>
                    <div className="row">
                      <button className="ghost" onClick={() => demoSwap(st)} disabled={busy}>{t("demoSwap", lang)}</button>
                      <button className="ghost" onClick={() => dock(st)} disabled={busy || (!s.managed && !isConnected)}>{t("dock", lang)}</button>
                    </div>
                  </>
                )}
                {st.status === "docked" && <p>{t("closed", lang)}</p>}
              </div>
            ))}
          </>
        )}

        {s.inbox.length > 0 && s.role === "work" && <h1 style={{ fontSize: 16, marginTop: 16 }}>お仕事の依頼</h1>}
        {s.role === "work" && s.inbox.map((r) => (
          <div className="card" key={r.id}>
            <p>{r.from_label} からのお仕事: {r.task}（お礼 {r.reward_usdc} ドル）</p>
            {r.status === "open" && <button onClick={() => updateReq(r.id, "accepted")}>引き受ける</button>}
            {r.status === "accepted" && <button onClick={() => updateReq(r.id, "delivered")}>作って届ける</button>}
            {r.status === "working" && <div><p>成果物を作成中です。5分以上応答がない場合は再試行できます。</p><button onClick={() => updateReq(r.id, "delivered")}>納品処理を再試行</button></div>}
            {r.content && <pre style={{ whiteSpace: "pre-wrap" }}>{r.content}</pre>}
          </div>
        ))}

        {s.outbox.map(r => <div className="card" key={r.id}>
          <p>{r.to_label} にお願い中: {r.task} ・ {requestStatusText(r.status)}</p>
          {r.content && <pre style={{ whiteSpace: "pre-wrap" }}>{r.content}</pre>}
          {r.status === "delivered" && <button onClick={() => updateReq(r.id, "done")}>受け取る（お礼は本人確認のあと）</button>}
          {r.reward_action_id && <p className="small">お礼の承認が必要です。</p>}
        </div>)}

        {network.some((p) => p.role === "work" && p.label !== s.label) && (
          <div className="card">
            <p><b>頼める仲間</b></p>
            {network.filter((p) => p.role === "work" && p.label !== s.label).map((p) => (
              <p key={p.label}>
                {p.full_name}{p.skills?.length ? ` · ${p.skills.join("、")}` : ""}{" "}
                <button className="small" onClick={() => { setInput(`${p.full_name} に `); inputRef.current?.focus(); }}>この子に頼む</button>
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

        <details className="plain" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)} ref={(el) => { detailsRef.current = el; }}>
          <summary>くわしく</summary>
          <p className="small">
            ENS: {s.fullName}
            <br />{t("moodLabel", lang)}: <b>{s.ens.mood ?? t("unset", lang)}</b>
            <br />{t("resolveTo", lang)}: <span className="mono">{s.ens.address ?? t("unresolved", lang)}</span>
          </p>
          <ReputationCard snapshot={s.reputation} managed={s.managed} />
          {s.actions.filter((a) => a.status !== "pending").slice(0, 5).map((a) => (
            <p key={a.id} className={a.status === "executed" ? "small" : "ng"}>
              {a.reason === "executing" ? "処理中" : a.reason === "confirmation_pending" ? "チェーンでの確定を確認中" : a.status}: {a.reason === "executing" || a.reason === "confirmation_pending" ? "" : a.reason ?? ""}{" "}
              {a.tx_hash && <a href={`https://sepolia.etherscan.io/tx/${a.tx_hash}`} target="_blank" rel="noreferrer">tx</a>}
            </p>
          ))}
          {strat?.strategies.map((st) => (
            <p key={st.id} className="small">
              {st.ship_tx && <a href={`https://sepolia.etherscan.io/tx/${st.ship_tx}`} target="_blank" rel="noreferrer">ship tx</a>}
              {st.ship_tx && st.dock_tx && " / "}
              {st.dock_tx && <a href={`https://sepolia.etherscan.io/tx/${st.dock_tx}`} target="_blank" rel="noreferrer">dock tx</a>}
            </p>
          ))}
        </details>
      </section>
    </main>
  );
}
