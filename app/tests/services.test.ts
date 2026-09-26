import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { openDb, type Db } from "../src/lib/db";
import { NETWORKS } from "../src/lib/services/catalog";
import { serviceCatalog, serviceConfig, type ServiceConfig } from "../src/lib/services/config";
import { servePageReport } from "../src/lib/services/payment";
import { extractSource, isPublicAddress, validateSourceUrl, type SourcePage } from "../src/lib/services/source";
import { generateReport, type Generation } from "../src/lib/services/report";
import { serviceEarnings } from "../src/lib/services/store";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired } from "@x402/core/types";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec, type DiscoveryExtension } from "@x402/extensions/bazaar";

const PAYTO="0x1111111111111111111111111111111111111111";
const PAYER="0x2222222222222222222222222222222222222222";
const TX="0x"+"a".repeat(64);
const NOW=1790400000000;
const URL="https://docs.world.org/world-id";
const INPUT={url:URL,language:"en"};
const PAGE:SourcePage={url:URL,title:"World ID",text:"World ID helps people prove they are human. This public documentation explains how to integrate the service.",retrievedAt:new Date(NOW).toISOString(),sha256:"b".repeat(64),truncated:false};
const GEN:Generation={report:{title:PAGE.title,summary:"An identity service.",facts:[{claim:"It proves humanness.",quote:"World ID helps people prove they are human."}],source:{url:URL,retrievedAt:PAGE.retrievedAt,sha256:PAGE.sha256,truncated:false},language:"en",cached:false},inputTokens:100,outputTokens:40};
let db:Db, config:ServiceConfig;
beforeEach(async()=>{
  vi.stubEnv("VERCEL",""); vi.stubEnv("TURSO_AUTH_TOKEN","");
  db=await openDb("file::memory:");
  await db.execute({sql:"INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,created_at,role) VALUES (?,?,?,?,?,?,?,?)",args:["taro","taro.otomo.eth",PAYTO,PAYTO,"{}","test-human",NOW,"work"]});
  await db.execute("INSERT INTO birth_provisioning (label,status) VALUES ('taro','ready')");
  config=serviceConfig({X402_ENABLED:"true",X402_SELLER_LABELS:"taro",CDP_API_KEY_ID:"test",CDP_API_KEY_SECRET:"test",LLM_BASE_URL:"https://llm.invalid",LLM_API_KEY:"test",LLM_MODEL:"test"});
});
afterEach(()=>{db.close();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
function deps(){return {facilitator:{getSupported:vi.fn(async()=>({kinds:[{x402Version:2,scheme:"exact",network:config.network}],extensions:["bazaar"],signers:{}})),verify:vi.fn(async()=>({isValid:true,payer:PAYER})),settle:vi.fn(async()=>({success:true,network:config.network,transaction:TX,payer:PAYER}))} satisfies FacilitatorClient,fetchPage:vi.fn(async()=>PAGE),generate:vi.fn(async()=>GEN),now:()=>NOW};}
function req(header?:string,input:unknown=INPUT,path="/api/services/taro/page-report"){return new NextRequest("https://otomo.example"+path,{method:"POST",headers:{"content-type":"application/json",...(header?{"payment-signature":header}:{})},body:JSON.stringify(input)});}
async function quote(d:ReturnType<typeof deps>){const r=await servePageReport(req(),"taro",db,config,d);expect(r.status).toBe(402);return JSON.parse(Buffer.from(r.headers.get("payment-required")!,"base64").toString()) as PaymentRequired;}
function payment(q:PaymentRequired,nonce="c".repeat(64)){return Buffer.from(JSON.stringify({x402Version:2,resource:q.resource,accepted:q.accepts[0],payload:{signature:"0x"+"d".repeat(130),authorization:{from:PAYER,to:PAYTO,value:"50000",validAfter:"0",validBefore:"1999999999",nonce:"0x"+nonce}},extensions:q.extensions})).toString("base64");}

describe("paid page-report with the official x402 Next adapter",()=>{
  it("returns discovery metadata to bodyless POST probes without starting work",async()=>{
    const d=deps();
    const r=await servePageReport(new NextRequest("https://otomo.example/api/services/taro/page-report",{method:"POST"}),"taro",db,config,d);
    expect(r.status).toBe(402);
    expect(r.headers.get("payment-required")).toBeTruthy();
    expect(d.fetchPage).not.toHaveBeenCalled();
    expect(d.generate).not.toHaveBeenCalled();
    expect(d.facilitator.settle).not.toHaveBeenCalled();
  });
  it("returns a quote for an empty POST body sent by external discovery probes",async()=>{
    const d=deps();
    const probe=new NextRequest("https://otomo.example/api/services/taro/page-report",{method:"POST",body:"",headers:{"content-type":"application/json"}});
    const r=await servePageReport(probe,"taro",db,config,d);
    expect(r.status).toBe(402);
    expect(r.headers.get("payment-required")).toBeTruthy();
    expect(d.fetchPage).not.toHaveBeenCalled();
    expect(d.facilitator.settle).not.toHaveBeenCalled();
    const paidEmpty=new NextRequest("https://otomo.example/api/services/taro/page-report",{method:"POST",body:"",headers:{"content-type":"application/json","payment-signature":"test"}});
    expect((await servePageReport(paidEmpty,"taro",db,config,d)).status).toBe(400);
  });
  it("quotes non-job discovery payloads but rejects them before a paid call",async()=>{
    const d=deps();
    const probe=new NextRequest("https://otomo.example/api/services/taro/page-report",{method:"POST",body:"{}",headers:{"content-type":"application/json"}});
    const response=await servePageReport(probe,"taro",db,config,d);
    expect(response.status).toBe(402);
    const paymentHeader=payment(JSON.parse(Buffer.from(response.headers.get("payment-required")!,"base64").toString()) as PaymentRequired);
    const paid=new NextRequest("https://otomo.example/api/services/taro/page-report",{method:"POST",body:"{}",headers:{"content-type":"application/json","payment-signature":paymentHeader}});
    expect((await servePageReport(paid,"taro",db,config,d)).status).toBe(400);
    expect(d.facilitator.verify).not.toHaveBeenCalled();
    expect(d.facilitator.settle).not.toHaveBeenCalled();
  });
  it("passes the official Bazaar schema and specification validators",async()=>{
    const q=await quote(deps());
    const extension=q.extensions?.bazaar as DiscoveryExtension;
    expect(validateDiscoveryExtension(extension)).toEqual({valid:true});
    expect(validateDiscoveryExtensionSpec(extension as unknown as Record<string,unknown>)).toEqual({valid:true});
  });
  it("reuses a fresh report for a second independently settled payment",async()=>{
    const d=deps(); const q=await quote(d);
    await servePageReport(req(payment(q)),"taro",db,config,d);
    d.facilitator.settle.mockResolvedValue({success:true,network:config.network,transaction:"0x"+"b".repeat(64),payer:PAYER});
    const second=await servePageReport(req(payment(q,"e".repeat(64))),"taro",db,config,d);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({report:{cached:true}});
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(d.facilitator.settle).toHaveBeenCalledTimes(2);
    expect((await serviceEarnings(db,"taro",NOW)).balances[0]).toMatchObject({paidJobs:2,grossUsdc:0.1});
  });
  it("advertises exact USDC price and real Bazaar input/output schemas without doing work",async()=>{const d=deps();const q=await quote(d);expect(q.accepts[0]).toMatchObject({amount:"50000",payTo:PAYTO,asset:NETWORKS[config.network].asset,network:"eip155:84532"});expect(q.extensions?.bazaar).toBeTruthy();expect(JSON.stringify(q.extensions)).toContain('"language"');expect(d.generate).not.toHaveBeenCalled();expect(d.facilitator.settle).not.toHaveBeenCalled();});
  it("returns a report only after verified settlement; retries do not charge or generate again",async()=>{const d=deps();const h=payment(await quote(d));const r=await servePageReport(req(h),"taro",db,config,d);expect(r.status).toBe(200);expect(r.headers.get("payment-response")).toBeTruthy();expect(await r.json()).toMatchObject({seller:"taro.otomo.eth",report:{summary:GEN.report.summary}});const retry=await servePageReport(req(h),"taro",db,config,d);expect(retry.status).toBe(200);expect(retry.headers.get("x-otomo-replayed")).toBe("true");expect(d.generate).toHaveBeenCalledTimes(1);expect(d.facilitator.settle).toHaveBeenCalledTimes(1);expect((await serviceEarnings(db,"taro",NOW)).balances[0]).toMatchObject({paidJobs:1,grossUsdc:0.05});});
  it("binds a payment to its original input",async()=>{const d=deps();const h=payment(await quote(d));await servePageReport(req(h),"taro",db,config,d);const r=await servePageReport(req(h,{...INPUT,language:"ja"}),"taro",db,config,d);expect(r.status).toBe(409);expect(d.generate).toHaveBeenCalledTimes(1);});
  it("rejects a forged payment before fetching a page",async()=>{const d=deps();const h=payment(await quote(d));d.facilitator.verify.mockResolvedValue({isValid:false,payer:PAYER});const r=await servePageReport(req(h),"taro",db,config,d);expect(r.status).toBe(402);expect(d.fetchPage).not.toHaveBeenCalled();expect(d.facilitator.settle).not.toHaveBeenCalled();});
  it("does not return paid content or count revenue if settlement fails",async()=>{const d=deps();const h=payment(await quote(d));d.facilitator.settle.mockResolvedValue({success:false,network:config.network,transaction:"",payer:PAYER});const r=await servePageReport(req(h),"taro",db,config,d);expect(r.status).toBeGreaterThanOrEqual(400);expect(await r.text()).not.toContain(GEN.report.summary);expect((await serviceEarnings(db,"taro",NOW)).balances).toEqual([]);});
  it("does not settle failed generation",async()=>{const d=deps();const h=payment(await quote(d));d.generate.mockRejectedValue(new Error("unavailable"));const r=await servePageReport(req(h),"taro",db,config,d);expect(r.status).toBe(502);expect(d.facilitator.settle).not.toHaveBeenCalled();expect((await serviceEarnings(db,"taro",NOW)).balances).toEqual([]);});
  it("caps paid processing attempts before starting another expensive task",async()=>{const d=deps();config.dailyJobLimit=1;const q=await quote(d);await servePageReport(req(payment(q)),"taro",db,config,d);const r=await servePageReport(req(payment(q,"e".repeat(64))),"taro",db,config,d);expect(r.status).toBe(429);expect(d.generate).toHaveBeenCalledTimes(1);});
  it("blocks concurrent reuse of the same payment",async()=>{const d=deps();const h=payment(await quote(d));const results=await Promise.all([servePageReport(req(h),"taro",db,config,d),servePageReport(req(h),"taro",db,config,d)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(d.generate).toHaveBeenCalledTimes(1);expect(d.facilitator.settle).toHaveBeenCalledTimes(1);});
  it("rejects disabled services, paid invalid source/input and a route mismatch",async()=>{const d=deps();expect((await servePageReport(req(),"taro",db,{...config,ready:false},d)).status).toBe(503);const h=payment(await quote(d));expect((await servePageReport(req(h,{...INPUT,url:"http://127.0.0.1"}),"taro",db,config,d)).status).toBe(400);expect((await servePageReport(req(h,{...INPUT,extra:"x"}),"taro",db,config,d)).status).toBe(400);expect((await servePageReport(req(undefined,INPUT,"/api/unpaid"),"taro",db,config,d)).status).toBe(404);expect(d.generate).not.toHaveBeenCalled();});
  it("does not enable personal companions or publish identity secrets",async()=>{await db.execute("UPDATE companions SET role='personal'");expect((await servePageReport(req(),"taro",db,config,deps())).status).toBe(404);const c=await serviceCatalog(db,config);expect(c.sellers).toEqual([]);expect(JSON.stringify(c)).not.toContain("test-human");expect(c.bazaarStatus).toBe("not-verified");});
  it("reports a dated testnet Bazaar observation only for an enabled work seller",async()=>{
    const observed={...config,bazaarVerifiedAt:"2026-09-26T00:00:00.000Z"};
    expect(await serviceCatalog(db,observed)).toMatchObject({bazaarStatus:"observed-testnet",bazaarVerifiedAt:observed.bazaarVerifiedAt});
    expect((await serviceCatalog(db,{...observed,ready:false})).bazaarStatus).toBe("not-verified");
    expect((await serviceCatalog(db,{...observed,network:"eip155:8453"})).bazaarStatus).toBe("not-verified");
  });
  it("rejects wrong-network and wrong-price authorization locally",async()=>{const d=deps();const q=await quote(d);q.accepts[0].network="eip155:8453";expect((await servePageReport(req(payment(q)),"taro",db,config,d)).status).toBe(402);expect(d.facilitator.verify).not.toHaveBeenCalled();});
});
describe("source boundaries and report grounding",()=>{
  it.each(["127.0.0.1","10.0.0.1","169.254.169.254","192.168.1.2","100.64.0.1","::1","fc00::1","::ffff:127.0.0.1","2001:db8::1","0.0.0.0"])("rejects non-public address %s",address=>{expect(isPublicAddress(address)).toBe(false);});
  it("allows public addresses and blocks hostname, credentials and port tricks",()=>{expect(isPublicAddress("8.8.8.8")).toBe(true);for(const url of ["https://docs.world.org.evil.test/a","https://user:secret@docs.world.org/a","https://docs.world.org:8443/a","file:///etc/passwd","https://127.0.0.1/a"])expect(()=>validateSourceUrl(url,["docs.world.org"])).toThrow();expect(validateSourceUrl(URL+"#part",["docs.world.org"]).href).toBe(URL);});
  it("removes script text and retains readable content plus a fingerprint",()=>{const p=extractSource(`<html><head><title>Source</title></head><body><script>secret-script</script><main><p>${PAGE.text}</p></main></body></html>`,URL,NOW);expect(p.text).not.toContain("secret-script");expect(p.text).toContain(PAGE.text);expect(p.sha256).toHaveLength(64);expect(p.retrievedAt).toBe(PAGE.retrievedAt);});
  it("rejects invented quotes and bounds the model request",async()=>{vi.stubEnv("LLM_BASE_URL","https://llm.invalid");vi.stubEnv("LLM_API_KEY","test");vi.stubEnv("LLM_MODEL","test");const f=vi.fn(async()=>Response.json({choices:[{message:{content:JSON.stringify({summary:"Summary",facts:[{claim:"Not grounded",quote:"This was invented"}]})}}]}));vi.stubGlobal("fetch",f);await expect(generateReport(PAGE,{url:URL,language:"en"})).rejects.toThrow("quotes");const body=JSON.parse((f.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);expect(body.max_tokens).toBe(1200);expect(body.messages[0].content).toContain("untrusted data");});
});
