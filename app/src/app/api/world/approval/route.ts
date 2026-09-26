import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Companion, PendingAction } from "@/lib/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { humanSession } from "@/lib/human-approval";
import { executeApprovedAction } from "@/lib/actions";
export const runtime="nodejs";

function publicAction(a: PendingAction) {
 return { id: a.id, intent: JSON.parse(a.intent), amountUsdc: a.amount_usdc, resolvedTo: a.resolved_to, expiresAt: a.expires_at };
}

export async function GET(req:NextRequest) {
 const label=readSession(req.cookies.get(SESSION_COOKIE)?.value);
 if(!label)return NextResponse.json({error:"Sign in to your companion first"},{status:401});
 const db=await getDb();
 const actionId=req.nextUrl.searchParams.get("action");
 let action=null;
 if(actionId){
  const a=(await db.execute({sql:"SELECT * FROM pending_actions WHERE id=? AND companion=?",args:[actionId,label]})).rows[0] as unknown as PendingAction | undefined;
  if(!a || a.status!=="pending" || a.expires_at<=Date.now())return NextResponse.json({error:"Action is missing, expired or already processed"},{status:410});
  action=publicAction(a);
 }
 return NextResponse.json({label,verified:!!await humanSession(db,label),environment:"production",action},{headers:{"Cache-Control":"no-store"}});
}

/** Owner confirmation only — the World ID human proof was already completed at birth. */
export async function POST(req:NextRequest) {
 try {
  if(req.headers.get("origin")!==req.nextUrl.origin)return NextResponse.json({error:"Same-origin request required"},{status:403});
  const label=readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if(!label)return NextResponse.json({error:"Sign in to your companion first"},{status:401});
  const body=await req.json(); const db=await getDb();
  if(body.operation!=="approve" || typeof body.actionId!=="string")throw new Error("Invalid approval request");
  const now=Date.now();
  const tx=await db.transaction("write");
  let action:PendingAction|undefined,companion:Companion|undefined;
  try {
   action=(await tx.execute({sql:"SELECT * FROM pending_actions WHERE id=? AND companion=?",args:[body.actionId,label]})).rows[0] as unknown as PendingAction|undefined;
   if(!action||action.status!=="pending"||action.expires_at<=now)throw new Error("Action is missing, expired or already processed");
   companion=(await tx.execute({sql:"SELECT * FROM companions WHERE label=?",args:[label]})).rows[0] as unknown as Companion|undefined;
   if(!companion)throw new Error("Companion not found");
   await tx.execute({sql:"UPDATE pending_actions SET status='executed',reason='executing' WHERE id=?",args:[action.id]});
   await tx.commit();
  } catch(e){await tx.rollback();throw e} finally{tx.close()}
  try {
   const result=await executeApprovedAction(db,action,companion);
   await db.execute({sql:"UPDATE pending_actions SET reason=NULL,tx_hash=? WHERE id=?",args:[result.txHash??null,action.id]});
   return NextResponse.json({actionId:action.id,txHash:result.txHash,label});
  } catch(e) {
   await db.execute({sql:"UPDATE pending_actions SET status=CASE WHEN tx_hash IS NULL THEN 'rejected' ELSE 'executed' END,reason=CASE WHEN tx_hash IS NULL THEN 'execution_failed' ELSE 'confirmation_pending' END WHERE id=?",args:[action.id]});
   throw e;
  }
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Approval failed"},{status:400});}
}
