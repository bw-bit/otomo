"use client";
import { WorkDelivery } from "./WorkDelivery";
import { DEMO_COPY } from "@/lib/demo-copy";
import { ROOM_COPY } from "@/lib/room-copy";
import { rewardNeedsRenewal, rewardPaid, workStage, type DemoRequest } from "@/lib/demo-view";
import { requestStatusText } from "@/lib/plain";
import { t, type Lang } from "@/lib/i18n";

export function DemoWorkCard({ request: r, label, busy, lang, onUpdate }: {
 request: DemoRequest; label: string; busy: boolean; lang: Lang;
 onUpdate: (id: string, status: "accepted" | "delivered" | "done" | "renew_reward") => void;
}) {
 const c = DEMO_COPY[lang], room = ROOM_COPY[lang], paid = rewardPaid(r), stage = workStage(r), outgoing = r.from_label === label;
 const contents = <>
   <details className="plain"><summary>{room.brief}</summary><p>{r.task}</p></details>
   {r.content && <WorkDelivery content={r.content} title={room.delivery} />}
   {paid && <a className="receipt-link" href={`https://sepolia.etherscan.io/tx/${r.reward_tx_hash}`} target="_blank" rel="noreferrer">{c.receipt} ↗</a>}
 </>;
 return <article className="demo-job">
   <div className="demo-job-heading"><strong>{r.from_label} → {r.to_label}</strong><span className={`demo-status ${paid ? "is-done" : ""}`}>{paid ? c.finished : requestStatusText(r.status, lang)}</span></div>
   <p className="demo-reward">{r.reward_usdc} <span>mUSDC · Sepolia</span></p>
   <ol className="demo-steps" aria-label={c.work}>
     {[c.request,c.deliver,c.review,c.reward].map((text,i)=><li key={text} className={stage > i ? "is-complete" : ""}><span aria-hidden="true">{String(i+1).padStart(2,"0")}</span>{text}<span className="sr-only">{stage > i ? " ✓" : " —"}</span></li>)}
   </ol>
   {paid ? <details className="plain demo-result"><summary>{c.result}</summary>{contents}</details> : contents}
   {!outgoing && r.status === "open" && <button disabled={busy} onClick={()=>onUpdate(r.id,"accepted")}>{t("acceptRequest",lang)}</button>}
   {!outgoing && (r.status === "accepted" || r.status === "working") && <button disabled={busy} onClick={()=>onUpdate(r.id,"delivered")}>{t(r.status === "working" ? "retryDelivery" : "deliverRequest",lang)}</button>}
   {outgoing && r.status === "delivered" && <button disabled={busy} onClick={()=>onUpdate(r.id,"done")}>{t("receiveDelivery",lang)}</button>}
   {outgoing && rewardNeedsRenewal(r) && <button disabled={busy} onClick={()=>onUpdate(r.id,"renew_reward")}>{room.renewReward}</button>}
   {r.reward_action_id && !paid && <p className="small">{rewardNeedsRenewal(r) ? room.expiredReward : r.reward_status === "pending" ? room.rewardPending : room.rewardFailed}</p>}
 </article>;
}
