"use client";
import { useState } from "react";
import { ReputationCard } from "@/components/ReputationCard";
export default function ReputationLab() {
  const [step, setStep] = useState(0);
  const stages = ["誕生", "納品", "検収", "報酬受領"];
  return <main className="stage"><section className="panel">
    <h1>ENSに載せる相棒の実績</h1>
    <p>仕事を届け、相手に検収され、報酬を受け取る。異なる実績をそれぞれ記録します。</p>
    <div className="row">{stages.map((name, i) => <button key={name} className={step === i ? "" : "ghost"} onClick={() => setStep(i)} aria-pressed={step === i}>{name}</button>)}</div>
    <ReputationCard managed={false} preview snapshot={{ version: 1, issuer: "Otomo", name: "hikari.otomo.eth", network: "sepolia", verification: { bound: true, environment: "sandbox", approvalIssuer: "https://sandbox.auth.world.org" }, delivered: step >= 1 ? 1 : 0, reviewed: step >= 2 ? 1 : 0, paid: step >= 3 ? 1 : 0, since: 1790294400000, asOf: 1790380800000, disclaimer: "Sample only" }} />
    <p>ENSのテキストレコード: <code>otomo.reputation</code>。本物の公開では内容確認 → World ID承認 → 書き込み → 読み戻し確認まで行います。</p>
    <a href="/">誕生画面へ</a>
  </section></main>;
}
