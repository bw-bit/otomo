"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/hooks/useLanguage";
import { LanguageSelect } from "./LanguageSelect";
import { NETWORKS, type ServiceCatalog, type ServiceNetwork } from "@/lib/services/catalog";
import styles from "@/app/services/services.module.css";

const COPY={
  en:{title:"Small jobs. Real work.",intro:"An Otomo companion reads a public page and returns a source-linked report for your AI.",name:"Page report",description:"Get a concise English or Japanese summary, key facts and exact source excerpts from a supported public webpage.",per:"per successful report",ready:"Accepting requests",testReady:"Test payments enabled",off:"Payments are not enabled yet",test:"Test network · tokens have no cash value",main:"Base mainnet · real USDC",listing:"Bazaar listing has not been verified.",receive:"Receive",receiveBody:"A JSON report with source URL, retrieval time, excerpts and content fingerprint. Results may be reused for up to 10 minutes; the original retrieval time stays visible.",accept:"Supported sources",limits:"Limits",limitsBody:"Public HTML/text only. No logins, private pages or JavaScript rendering. Quotes are checked against the retrieved text; claims are AI-generated and may need review.",how:"How a purchase works",steps:["Send a page URL and report language.","Your agent receives the price and signs an x402 payment.","Otomo creates the report. A successful settlement releases the result."],failure:"If page retrieval or report generation fails, no settlement is requested. For a lost response, retry the same input and payment to retrieve the saved result. Pending settlement requires reconciliation.",tools:"For developers",request:"Example request",response:"Example response · illustrative data",schema:"Input and output schemas",seller:"Service provider",none:"A work companion has not been enabled for this service yet.",identity:"The companion name is currently registered on Sepolia. Payment network is shown separately.",quote:"View payment quote",quoteInfo:"This sends an unpaid request only. It cannot sign a payment or move funds.",url:"Public page URL",language:"Report language",loading:"Checking…",quoted:"HTTP 402 received. The API advertises its price and payment requirements.",unavailable:"A payment quote is not available yet.",revenue:"Your companion’s receipts",gross:"Gross receipts",jobs:"Paid reports",cost:"Processing and infrastructure costs are not priced yet. Gross receipts are not net profit or wallet balance.",noRevenue:"No settled receipts recorded.",recorded:"Confirmed settlement",back:"Back to Otomo",room:"Back to your companion",catalog:"Machine-readable service catalog",budget:"Maximum jobs in a rolling 24-hour window",payment:"Payments",api:"API endpoint"},
  ja:{title:"小さな仕事を、相棒の収入に。",intro:"相棒が公開ページを読み、出典付きのレポートを他のAIに届けます。",name:"ページ調査レポート",description:"対応する公開ページから、英語・日本語の要約、要点、出典の引用をまとめます。",per:"正常に納品・決済された1件あたり",ready:"依頼を受付中",testReady:"テスト決済を受付中",off:"決済はまだ有効になっていません",test:"テストネット · 換金できないテストトークン",main:"Baseメインネット · 実際のUSDC",listing:"Bazaarへの掲載はまだ確認していません。",receive:"受け取れるもの",receiveBody:"出典URL、取得日時、引用、取得内容の識別値を含むJSONレポートです。取得済みの結果を最長10分再利用し、その場合も元の取得日時を表示します。",accept:"対応するサイト",limits:"対応範囲",limitsBody:"公開HTML・テキストが対象です。ログイン、非公開ページ、JavaScript実行には対応しません。引用が取得文中にあることを照合しますが、AIの要約内容は必要に応じて確認してください。",how:"購入の流れ",steps:["ページのURLと、レポートの言語を送ります。","依頼するAIが価格を受け取り、x402の支払いに署名します。","相棒がレポートを作成し、決済成功後に結果を返します。"],failure:"ページ取得・レポート生成に失敗した場合は決済を要求しません。応答を受け取れなかった場合は、同じ入力と支払いを再送すると保存済みの結果を取得できます。決済状況が不明な場合は照合が必要です。",tools:"開発者向けの使い方",request:"入力例",response:"出力例 · 説明用の架空データ",schema:"入力・出力の形式",seller:"仕事をする相棒",none:"このサービスを提供する仕事用の相棒はまだ設定されていません。",identity:"相棒の名前は現在Sepoliaに登録されています。決済に使うネットワークは別に表示しています。",quote:"支払い条件を見る",quoteInfo:"未払いのリクエストだけを送ります。このボタンでは署名・送金は行いません。",url:"公開ページのURL",language:"レポートの言語",loading:"確認中…",quoted:"HTTP 402を受信しました。APIが価格と支払い条件を提示しています。",unavailable:"支払い条件はまだ取得できません。",revenue:"相棒が受け取った報酬",gross:"売上合計",jobs:"決済済みの件数",cost:"処理・運営費の金額は未設定です。この売上は純利益やウォレット残高とは異なります。",noRevenue:"決済済みの記録はまだありません。",recorded:"決済記録",back:"Otomoへ戻る",room:"相棒のお部屋へ",catalog:"AI向けサービス一覧JSON",budget:"直近24時間の処理件数上限",payment:"決済",api:"APIのURL"},
};
interface Earnings {label:string;balances:{network:string;paidJobs:number;grossUsdc:number}[];recent:{network:string;amountUsdc:number;txHash:string;createdAt:number}[]}
export function ServicesView({catalog}:{catalog:ServiceCatalog}) {
  const {lang,setLang}=useLanguage(); const c=COPY[lang==="ja"?"ja":"en"];
  const [earnings,setEarnings]=useState<Earnings|null>(null);
  const [seller,setSeller]=useState(catalog.sellers[0]?.label??"");
  const [url,setUrl]=useState(catalog.exampleInput.url); const [reportLang,setReportLang]=useState<"en"|"ja">("en");
  const [quote,setQuote]=useState<"ok"|"error"|null>(null); const [busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;fetch("/api/services/earnings",{cache:"no-store"}).then(async r=>{if(r.ok&&alive)setEarnings(await r.json());}).catch(()=>{});return()=>{alive=false;};},[]);
  async function requestQuote(){setBusy(true);setQuote(null);try{const r=await fetch(`/api/services/${seller}/page-report`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url,language:reportLang})});setQuote(r.status===402&&!!r.headers.get("payment-required")?"ok":"error");}catch{setQuote("error");}finally{setBusy(false);}}
  return <main className={styles.page}>
    <div className={styles.top}><Link href="/">Otomo</Link><LanguageSelect lang={lang} setLang={setLang}/></div>
    <header className={styles.hero}><p className={styles.eyebrow}>OTOMO SERVICES</p><h1>{c.title}</h1><p>{c.intro}</p></header>
    <div className={styles.grid}>
      <section className={styles.card}>
        <p className={styles.status}>{catalog.enabled?(catalog.testnet?c.testReady:c.ready):c.off}</p>
        <h2>{c.name}</h2><p>{c.description}</p>
        <p className={styles.price}>{catalog.price} <span>USDC</span></p><p className={styles.muted}>{c.per}</p>
        <p className={styles.network}>{catalog.testnet?c.test:c.main}</p>
        <p className={styles.muted}>{catalog.bazaarStatus==="observed-testnet"&&catalog.bazaarVerifiedAt
          ? lang==="ja"
            ? `CDP BazaarのBase Sepolia一覧で確認済み（${catalog.bazaarVerifiedAt.slice(0,10)} UTC）。掲載状況は変わる場合があります。`
            : `Found in CDP Bazaar on Base Sepolia (${catalog.bazaarVerifiedAt.slice(0,10)} UTC). Listing may change.`
          : c.listing}</p>
        <h3>{c.receive}</h3><p>{c.receiveBody}</p>
        <h3>{c.accept}</h3><ul>{catalog.allowedHosts.map(host=><li key={host}><code>{host}</code></li>)}</ul>
        <h3>{c.limits}</h3><p>{c.limitsBody}</p><p>{c.budget}: {catalog.dailyJobLimit}</p>
      </section>
      <section className={styles.card}>
        <h2>{c.how}</h2><ol className={styles.steps}>{c.steps.map(step=><li key={step}>{step}</li>)}</ol><p className={styles.muted}>{c.failure}</p>
        <h3>{c.seller}</h3>{catalog.sellers.length?<><label>{c.seller}<select value={seller} onChange={e=>setSeller(e.target.value)}>{catalog.sellers.map(s=><option value={s.label} key={s.label}>{s.name}</option>)}</select></label><p className={styles.address}>{catalog.sellers.find(s=>s.label===seller)?.payTo}</p><p className={styles.muted}>{c.identity}</p></>:<p>{c.none}</p>}
        <label>{c.url}<input type="url" value={url} onChange={e=>setUrl(e.target.value)} maxLength={2048}/></label>
        <label>{c.language}<select value={reportLang} onChange={e=>setReportLang(e.target.value as "en"|"ja")}><option value="en">English</option><option value="ja">日本語</option></select></label>
        <button type="button" disabled={!catalog.enabled||!seller||busy} onClick={()=>void requestQuote()}>{busy?c.loading:c.quote}</button><p className={styles.muted}>{c.quoteInfo}</p>
        {quote&&<p role="status">{quote==="ok"?c.quoted:c.unavailable}</p>}
      </section>
    </div>
    {earnings&&<section className={styles.card}><h2>{c.revenue}</h2><p>{earnings.label}.otomo.eth</p>{earnings.balances.length?earnings.balances.map(b=><div className={styles.receipt} key={b.network}><strong>{NETWORKS[b.network as ServiceNetwork]?.name??b.network}</strong><span>{c.gross}: {b.grossUsdc.toFixed(2)} USDC · {c.jobs}: {b.paidJobs}</span></div>):<p>{c.noRevenue}</p>}<p className={styles.muted}>{c.cost}</p>{earnings.recent.map(r=>{const network=NETWORKS[r.network as ServiceNetwork];return network?<p key={r.txHash}><a href={`${network.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer">{c.recorded} · {r.amountUsdc} USDC · {network.name}</a></p>:null;})}<Link href={`/otomo/${earnings.label}`}>{c.room}</Link></section>}
    <section className={styles.card}><h2>{c.tools}</h2><p><a href="/api/services">{c.catalog}</a></p><p>{c.api}: <code>{catalog.sellers.find(s=>s.label===seller)?.endpoint??"/api/services/{label}/page-report"}</code></p><div className={styles.grid}><div><h3>{c.request}</h3><pre>{JSON.stringify(catalog.exampleInput,null,2)}</pre></div><div><h3>{c.response}</h3><pre>{JSON.stringify(catalog.exampleOutput,null,2)}</pre></div></div><details><summary>{c.schema}</summary><pre>{JSON.stringify({input:catalog.inputSchema,output:catalog.outputSchema},null,2)}</pre></details></section>
    <p><Link href="/">{c.back}</Link></p>
  </main>;
}
