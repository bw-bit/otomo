"use client";
import { useEffect,useState } from "react";
type Action={id:string;intent:unknown;amountUsdc:number;resolvedTo:string|null;expiresAt:number};
type Status={label:string;verified:boolean;environment:string;action:Action|null};
export default function HumanApprovalPage(){
 const [status,setStatus]=useState<Status|null>(null);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[txHash,setTxHash]=useState<string|null>(null);
 useEffect(()=>{
  const actionId=new URLSearchParams(location.search).get("action");
  fetch(`/api/world/approval${actionId?`?action=${encodeURIComponent(actionId)}`:""}`).then(r=>r.json()).then(j=>{if(j.error)throw Error(j.error);setStatus(j)}).catch(e=>setError(e.message));
 },[]);
 async function approve(actionId:string){
  setBusy(true);setError("");
  try {
   const r=await fetch("/api/world/approval",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"approve",actionId})});
   const j=await r.json();
   if(!r.ok)throw Error(j.error||"Approval failed");
   setTxHash(j.txHash??null);setDone(true);
  } catch(e){setError(e instanceof Error?e.message:"Approval failed")} finally{setBusy(false)}
 }
 return <main style={{maxWidth:720,margin:"60px auto",padding:24,color:"#f4f2ff"}}>
 <h1>Human approval</h1>
 <p>This approval uses the World ID verified at your companion's birth. No new verification in World App is needed — the signed-in owner only reviews and confirms the action.</p>
 {status&&!done&&<>
  {status.action?<><p>Review and approve this pending action for <strong>{status.label}</strong>:</p><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(status.action,null,2)}</pre><p>Expires: {new Date(status.action.expiresAt).toISOString()}</p><button onClick={()=>approve(status.action!.id)} disabled={busy}>{busy?"Approving…":"Approve as the verified owner"}</button></>
  :<p>Your birth-verified identity is linked. There is no pending action to approve here — return to your companion.</p>}
 </>}
 {done&&<p role="status">Approved. The action was submitted.{txHash&&<> Transaction: <code>{txHash}</code></>}</p>}
 {error&&<div role="alert"><p>{error}</p></div>}
 {status&&<p><a href={`/otomo/${status.label}`}>Back to {status.label}</a></p>}
 <p>Prototype: approval is implemented; live execution is complete only after the backend transaction succeeds.</p>
 </main>
}
