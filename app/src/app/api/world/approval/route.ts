import { NextRequest, NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import type { IDKitResultSession } from "@worldcoin/idkit";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE,readSession } from "@/lib/session";
import { createHumanChallenge,completeHumanChallenge,humanSession } from "@/lib/human-approval";
import { executeApprovedAction } from "@/lib/actions";
import { requireEnv } from "@/lib/env";
import { verifyWorldSession } from "@/lib/world-verifier";
export const runtime="nodejs";
export async function GET(req:NextRequest) {
 const label=readSession(req.cookies.get(SESSION_COOKIE)?.value);
 if(!label)return NextResponse.json({error:"Sign in to your companion first"},{status:401});
 return NextResponse.json({label,enrolled:!!await humanSession(await getDb(),label),environment:"production"},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:NextRequest) {
 try {
  if(req.headers.get("origin")!==req.nextUrl.origin)return NextResponse.json({error:"Same-origin request required"},{status:403});
  const label=readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if(!label)return NextResponse.json({error:"Sign in to your companion first"},{status:401});
  const body=await req.json(); const db=await getDb();
  const env=requireEnv("WORLD_RP_SIGNING_KEY","WORLD_RP_ID","NEXT_PUBLIC_WORLD_APP_ID");
  if(body.operation==="challenge") {
   if(body.actionId!==null && typeof body.actionId!=="string")throw new Error("actionId must be a string or null");
   const signed=signRequest({signingKeyHex:env.WORLD_RP_SIGNING_KEY,ttl:300});
   const challenge=await createHumanChallenge(db,label,body.actionId,signed.nonce,Date.now());
   return NextResponse.json({...challenge,appId:env.NEXT_PUBLIC_WORLD_APP_ID,rpContext:{rp_id:env.WORLD_RP_ID,nonce:signed.nonce,signature:signed.sig,created_at:signed.createdAt,expires_at:signed.expiresAt}},{headers:{"Cache-Control":"no-store"}});
  }
  if(body.operation!=="verify" || typeof body.id!=="string" || !body.proof)throw new Error("Invalid verification request");
  const result=await completeHumanChallenge(db,label,body.id,body.proof as IDKitResultSession,Date.now(),{
   verify:proof=>verifyWorldSession(env.WORLD_RP_ID,proof), execute:(a,c)=>executeApprovedAction(db,a,c)
  });
  return NextResponse.json({...result,label});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Verification failed"},{status:400});}
}
