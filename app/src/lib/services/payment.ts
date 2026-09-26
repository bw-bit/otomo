import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import type { Db } from "../db";
import { INPUT_EXAMPLE, INPUT_SCHEMA, NETWORKS, OUTPUT_EXAMPLE, OUTPUT_SCHEMA, REPORT_AMOUNT, REPORT_DESCRIPTION } from "./catalog";
import { getServiceSeller, type ServiceConfig } from "./config";
import { fetchSource, validateSourceUrl, type SourcePage } from "./source";
import { generateReport, reportInput, type Generation, type ReportInput } from "./report";
import { initServiceStore, reserveJob, type PaymentRecord } from "./store";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function serviceError(error: string, status: number) { return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }); }
async function readInput(request: Request): Promise<ReportInput | null> {
  if (Number(request.headers.get("content-length")) > 4096) throw new Error("Body too large");
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > 4096) throw new Error("Body too large"); chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  if (size === 0) return null;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("JSON body required");
  return reportInput.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
/** Only USDC EIP-3009 exact authorization payments are advertised and accepted in v1. */
export function paymentRecord(header: string, input: ReportInput, label: string, config: ServiceConfig, payTo: string): PaymentRecord {
  if (header.length > 16384 || !/^[A-Za-z0-9+/=_-]+$/.test(header)) throw new Error("Invalid payment header");
  const body = JSON.parse(Buffer.from(header,"base64").toString("utf8"));
  const a = body?.payload?.authorization;
  const accepted = body?.accepted;
  const signature = body?.payload?.signature;
  if (body.x402Version !== 2 || accepted?.scheme !== "exact" || accepted.network !== config.network || accepted.amount !== String(REPORT_AMOUNT) || accepted.asset?.toLowerCase() !== NETWORKS[config.network].asset.toLowerCase() || accepted.payTo?.toLowerCase() !== payTo.toLowerCase() || !a || !/^0x[0-9a-f]{40}$/i.test(a.from) || a.to?.toLowerCase() !== payTo.toLowerCase() || String(a.value) !== String(REPORT_AMOUNT) || !/^0x[0-9a-f]{64}$/i.test(a.nonce) || typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature) || signature.length > 4098 || !/^\d+$/.test(String(a.validBefore)) || !/^\d+$/.test(String(a.validAfter))) throw new Error("Invalid payment authorization");
  return { key: hash([config.network,accepted.asset.toLowerCase(),a.from.toLowerCase(),a.nonce.toLowerCase()].join(":")), proofHash: hash(signature.toLowerCase()), requestHash: hash(JSON.stringify({ label, network:config.network, input })), seller:label, network:config.network, asset:accepted.asset.toLowerCase(), amount:REPORT_AMOUNT };
}

export interface ServiceDeps { facilitator?: FacilitatorClient; fetchPage?: (url: string, hosts: string[]) => Promise<SourcePage>; generate?: (page: SourcePage, input: ReportInput) => Promise<Generation>; now?: () => number }
export async function servePageReport(request: NextRequest, label: string, db: Db, config: ServiceConfig, deps: ServiceDeps = {}): Promise<NextResponse> {
  const pathname = `/api/services/${label}/page-report`;
  // A route mismatch in withX402 runs its handler unpaid. Reject before entering the SDK.
  if (!/^[a-z0-9-]{3,20}$/.test(label) || request.nextUrl.pathname !== pathname || request.method !== "POST") return serviceError("not_found",404);
  if (!config.ready) return serviceError("service_not_enabled",503);
  const seller = await getServiceSeller(db,label,config);
  if (!seller) return serviceError("seller_not_available",404);
  const rawPayment = request.headers.get("payment-signature");
  // Bazaar health probes send a bodyless POST. They need the 402 declaration,
  // but a paid request must always carry a validated, explicit job input.
  let input: ReportInput = {...INPUT_EXAMPLE};
  try {
    const providedInput = await readInput(request.clone());
    if (rawPayment) {
      if (!providedInput) throw new Error("Paid request requires input");
      input = {...providedInput, url: validateSourceUrl(providedInput.url,config.hosts).href};
    }
  } catch (error) {
    // Discovery probes may POST an empty or non-job payload. Quote them without
    // starting work; a signed request must still provide valid, safe input.
    if (rawPayment || (error instanceof Error && error.message === "Body too large")) return serviceError("invalid_input_or_source",400);
  }
  let payment: PaymentRecord | undefined;
  if (rawPayment) {
    try { payment = paymentRecord(rawPayment,input,label,config,seller.payTo); } catch { return serviceError("invalid_payment",402); }
  }
  await initServiceStore(db);
  if (payment) {
    const previous = (await db.execute({sql:"SELECT * FROM service_payments WHERE payment_key=?",args:[payment.key]})).rows[0];
    if (previous) {
      if (previous.proof_hash !== payment.proofHash || previous.request_hash !== payment.requestHash) return serviceError("payment_bound_to_another_request",409);
      if (previous.status === "settled" && previous.result && previous.settlement) return NextResponse.json(JSON.parse(String(previous.result)),{headers:{"Cache-Control":"no-store","PAYMENT-RESPONSE":Buffer.from(String(previous.settlement)).toString("base64"),"X-Otomo-Replayed":"true"}});
      return serviceError(previous.status === "failed" ? "previous_job_failed_no_settlement" : "payment_in_progress_or_needs_reconciliation",409);
    }
  }
  const now = deps.now ?? Date.now;
  const resource = new x402ResourceServer(deps.facilitator ?? createCdpFacilitatorClient()).register(config.network,new ExactEvmScheme()).registerExtension(bazaarResourceServerExtension);
  let reserved = false;
  let reserveFailure: string | undefined;
  resource.onAfterVerify(async ({result}) => {
    if (!result.isValid || !payment) return {abort:true,reason:"invalid_payment"};
    try { await reserveJob(db,payment,config.dailyJobLimit,now()); reserved=true; }
    catch(e) { reserveFailure=e instanceof Error ? e.message : "job_unavailable"; return {abort:true,reason:reserveFailure}; }
  });
  resource.onAfterSettle(async ({result}) => {
    if (!payment || !reserved) return;
    if (!result.success || result.network !== config.network || !/^0x[0-9a-f]{64}$/i.test(result.transaction)) throw new Error("Invalid settlement receipt");
    await db.execute({sql:"UPDATE service_payments SET status='settled',settlement=?,tx_hash=? WHERE payment_key=? AND status='prepared'",args:[JSON.stringify(result),result.transaction.toLowerCase(),payment.key]});
  });
  resource.onSettleFailure(async () => {
    if (payment && reserved) await db.execute({sql:"UPDATE service_payments SET status='uncertain' WHERE payment_key=? AND status='prepared'",args:[payment.key]});
  });
  const handler = withX402<unknown>(async () => {
    if (!reserved || !payment) return serviceError("verified_payment_required",402);
    try {
      const cacheKey = hash(JSON.stringify(input));
      const cached = (await db.execute({sql:"SELECT result FROM service_report_cache WHERE cache_key=? AND expires_at>?",args:[cacheKey,now()]})).rows[0];
      let generation: Generation;
      if (cached) generation={report:{...JSON.parse(String(cached.result)),cached:true},inputTokens:0,outputTokens:0};
      else {
        const page = await (deps.fetchPage ?? fetchSource)(input.url,config.hosts);
        generation = await (deps.generate ?? generateReport)(page,input);
        await db.execute({sql:"INSERT INTO service_report_cache VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at",args:[cacheKey,JSON.stringify(generation.report),now()+config.cacheSeconds*1000]});
      }
      const result={service:"page-report",seller:seller.name,report:generation.report};
      await db.execute({sql:"UPDATE service_payments SET status='prepared',result=?,input_tokens=?,output_tokens=? WHERE payment_key=? AND status='processing'",args:[JSON.stringify(result),generation.inputTokens,generation.outputTokens,payment.key]});
      return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
    } catch {
      await db.execute({sql:"UPDATE service_payments SET status='failed' WHERE payment_key=? AND status='processing'",args:[payment.key]});
      return serviceError("report_unavailable_no_charge",502);
    }
  }, {
    [`POST ${pathname}`]: {
      accepts: {scheme:"exact",network:config.network,payTo:seller.payTo,price:{asset:NETWORKS[config.network].asset,amount:String(REPORT_AMOUNT),extra:{name:"USDC",version:"2",assetTransferMethod:"eip3009",paymentFlow:"authorization"}},maxTimeoutSeconds:300},
      description:REPORT_DESCRIPTION,mimeType:"application/json",
      extensions:declareDiscoveryExtension({bodyType:"json",input:INPUT_EXAMPLE,inputSchema:INPUT_SCHEMA,output:{example:OUTPUT_EXAMPLE,schema:OUTPUT_SCHEMA}}),
    },
  },resource);
  const response=await handler(request);
  if (reserveFailure) return serviceError(reserveFailure,reserveFailure==="daily_job_limit"?429:409);
  response.headers.set("Cache-Control","no-store");
  // Never release a report unless settlement is also durably recorded.
  if (response.ok && payment) {
    const state=(await db.execute({sql:"SELECT status FROM service_payments WHERE payment_key=?",args:[payment.key]})).rows[0];
    if (state?.status!=="settled") return serviceError("settlement_needs_reconciliation",503);
  }
  return response;
}
