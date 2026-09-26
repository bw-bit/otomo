"use client";
import { useEffect,useState } from "react";
import { IDKitRequestWidget,proofOfHuman,type RpContext,type IDKitResult } from "@worldcoin/idkit";
type Challenge={id:string;signal:string;worldAction:string;sessionId:`session_${string}`|null;appId:`app_${string}`;rpContext:RpContext;action:unknown;expiresAt:number};
export default function HumanApprovalPage(){
 const [status,setStatus]=useState<{label:string;enrolled:boolean}|null>(null);
 const [challenge,setChallenge]=useState<Challenge|null>(null),[open,setOpen]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[executed,setExecuted]=useState(false);
 const [now,setNow]=useState(Date.now());
 const unavailable=error.includes("world_id_4_not_available");
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const [actionId,setActionId]=useState<string|null>(null);
 useEffect(()=>{setActionId(new URLSearchParams(location.search).get("action"));fetch("/api/world/approval").then(r=>r.json()).then(j=>{if(j.error)throw Error(j.error);setStatus(j)}).catch(e=>setError(e.message))},[]);
 async function request(body:unknown){const r=await fetch("/api/world/approval",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||"Verification failed");return j;}
 async function begin(){setBusy(true);setError("");try{setChallenge(await request({operation:"challenge",actionId:status?.enrolled?actionId:null}));setOpen(false)}catch(e){setError(e instanceof Error?e.message:"Verification failed")}finally{setBusy(false)}}
 async function verify(proof:IDKitResult){if(!challenge)throw Error("Missing challenge");await request({operation:"verify",id:challenge.id,proof});setExecuted(challenge.action!==null);setDone(true);setStatus(s=>s?{...s,enrolled:true}:s);setChallenge(null)}
 return <main style={{maxWidth:720,margin:"60px auto",padding:24,color:"#f4f2ff"}}>
 <h1>World ID · Production human approval</h1>
 <p>This flow uses a production World ID proof — the same credential used at birth (Selfie Check, passport, My Number Card, or Orb). The proof must return the same human identifier as your companion's birth. Sandbox identities are rejected.</p>
 {status&&!done&&!challenge&&<><p>{status.enrolled?"Your production World ID is linked. Each action requires a fresh proof of the same identity.":"Link your World ID to this signed-in account. This enables production approval for all your companions. An existing linked identity cannot be replaced here. Enrollment does not execute any pending action."}</p>
 {!status.enrolled&&<p>Only continue if this is your account and your World App. You must complete verification on your own phone.</p>}
 {status.enrolled&&!actionId?<p>Linked successfully. Return to your companion and approve a new pending action.</p>:<button onClick={begin} disabled={busy||unavailable}>{busy?"Preparing…":status.enrolled?"Review and verify this action":"Link my production World ID"}</button>}</>}
 {challenge&&<><p>Expires: {new Date(challenge.expiresAt).toISOString()}</p>{challenge.action!==null&&<pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(challenge.action,null,2)}</pre>}<button onClick={()=>setOpen(true)} disabled={now>=challenge.expiresAt || unavailable}>Continue in World App</button>{now>=challenge.expiresAt&&<p role="status">This request expired. <button onClick={begin} disabled={busy}>Prepare a new request</button></p>}<IDKitRequestWidget open={open} onOpenChange={setOpen} app_id={challenge.appId} action={challenge.worldAction} rp_context={challenge.rpContext} environment="production" allow_legacy_proofs={true} preset={proofOfHuman({signal:challenge.signal})} handleVerify={verify} onSuccess={()=>setOpen(false)} onError={e=>{setError(String(e));setOpen(false);setChallenge(null)}}/></>}
 {done&&<p role="status">Production World ID verified. {executed?"The approved action was submitted.":"Return to the companion to check the result. Enrollment alone does not execute an action."}</p>}
 {error&&<div role="alert"><p>{unavailable?"World App could not provide a production World ID proof for this approval. No identity was linked and no action was executed. This error does not indicate that you have already verified. Compatibility is unresolved; retrying the same request is not a verified fix.":error}</p>{unavailable&&<details><summary>Error code</summary><code>{error}</code></details>}</div>}
 {status&&<p><a href={`/otomo/${status.label}`}>Back to {status.label}</a></p>}
 <p>Prototype: integration is implemented; live verification is complete only after World App verification and backend acceptance succeed.</p>
 </main>
}
