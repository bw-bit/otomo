import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { Agent, request } from "undici";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";

export const MAX_PAGE_BYTES = 1_000_000;
export const MAX_SOURCE_CHARS = 18_000;
export interface SourcePage { url: string; title: string; text: string; retrievedAt: string; sha256: string; truncated: boolean }
export function validateSourceUrl(raw: string, allowedHosts: string[]): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !allowedHosts.includes(url.hostname.toLowerCase()) || ipaddr.isValid(url.hostname)) throw new Error("Only allowed public HTTPS sources are supported");
  url.hash = "";
  return url;
}
export function isPublicAddress(address: string) {
  try { const ip = ipaddr.process(address); return ip.range() === "unicast"; } catch { return false; }
}
export function extractSource(html: string, url: string, now: number): SourcePage {
  const $ = load(html);
  $("script,style,noscript,iframe,svg,nav,footer,header,form,[hidden]").remove();
  const title = $("title").first().text().trim().slice(0,200);
  const root = $("main").first().length ? $("main").first() : $("body");
  root.find("p,div,section,li,h1,h2,h3,br,tr").append("\n");
  const all = root.text().replace(/\s+/g, " ").trim();
  if (all.length < 60) throw new Error("Source has too little readable text; JavaScript-only pages are not supported");
  return { url, title, text: all.slice(0,MAX_SOURCE_CHARS), retrievedAt: new Date(now).toISOString(), sha256: createHash("sha256").update(all).digest("hex"), truncated: all.length > MAX_SOURCE_CHARS };
}
/** DNS is checked AND pinned at connection time; each redirect gets the same checks. No caller cookies or authorization are forwarded. */
export async function fetchSource(raw: string, allowedHosts: string[]): Promise<SourcePage> {
  let url = validateSourceUrl(raw, allowedHosts);
  const signal = AbortSignal.timeout(12_000);
  for (let redirects=0; redirects<=3; redirects++) {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error("Source does not resolve exclusively to public addresses");
    const pinned = addresses.find(a => a.family === 4) ?? addresses[0];
    const dispatcher = new Agent({ connect: { timeout: 5000, autoSelectFamily: false, family: pinned.family, lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family) } });
    try {
      // undici.request does not follow redirects without an explicit redirect interceptor.
      const response = await request(url, { dispatcher, signal, headersTimeout: 8000, bodyTimeout: 8000, headers: { accept: "text/html,text/plain", "accept-encoding": "identity", "user-agent": "OtomoPageReport/1.0" } });
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.body.destroy();
        if (!response.headers.location || redirects === 3) throw new Error("Source redirect limit exceeded");
        url = validateSourceUrl(new URL(String(response.headers.location),url).href,allowedHosts);
        continue;
      }
      if (response.statusCode !== 200 || !/^(text\/html|text\/plain)(?:;|$)/i.test(String(response.headers["content-type"] ?? "")) || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.body.destroy(); throw new Error("Source is not an accessible uncompressed text page");
      }
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) { response.body.destroy(); throw new Error("Source page exceeds size limit"); }
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString("utf8");
      const html = String(response.headers["content-type"]).startsWith("text/plain") ? `<html><body>${text.replaceAll("&","&amp;").replaceAll("<","&lt;")}</body></html>` : text;
      return extractSource(html,url.href,Date.now());
    } finally { await dispatcher.destroy(); }
  }
  throw new Error("Source unavailable");
}
