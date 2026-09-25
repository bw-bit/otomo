"use client";

import { useEffect, useState } from "react";
import { BirthScene, type BirthPhase } from "@/components/BirthScene";

const PHASES: BirthPhase[] = ["idle", "verifying", "forming", "born", "failed"];

/** Dev-only lab: step through the birth effect without World ID / chain credentials. */
export default function BirthLab() {
  const [phase, setPhase] = useState<BirthPhase>("idle");
  const [seed, setSeed] = useState("taro.otomo.eth");
  const [run, setRun] = useState(0);

  // ?phase=born&seed=... lets headless screenshots capture a specific state.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("phase") as BirthPhase | null;
    if (q.get("seed")) setSeed(q.get("seed")!);
    if (p && PHASES.includes(p)) setPhase(p);
  }, []);

  const playAll = async () => {
    setPhase("idle");
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(600);
    setPhase("verifying");
    await wait(2200);
    setPhase("forming");
    await wait(1800);
    setPhase("born");
  };

  return (
    <main className="stage">
      <BirthScene key={run} className="scene" phase={phase} seed={seed} />
      <div />
      <section className="panel">
        <h1>誕生エフェクト ラボ</h1>
        <p>フェーズ: {phase}（seed を変えると色と形が変わります）</p>
        <div className="row">
          <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="seed" />
          <button className="ghost" onClick={() => setRun((r) => r + 1)}>リセット</button>
        </div>
        <div className="row">
          {PHASES.map((p) => (
            <button key={p} className={p === phase ? "" : "ghost"} onClick={() => setPhase(p)}>
              {p}
            </button>
          ))}
          <button onClick={playAll}>通しで再生</button>
        </div>
      </section>
    </main>
  );
}
