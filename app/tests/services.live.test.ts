import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fetchSource } from "../src/lib/services/source";
import { generateReport } from "../src/lib/services/report";

// Opt-in: one public page read and one bounded real LLM call. No payment or DB writes.
it.skipIf(process.env.RUN_LIVE_SERVICE_REPORT !== "1")("generates a Japanese report from a live public source",async()=>{
  const output=process.env.SERVICE_REPORT_OUTPUT;
  if(!output || !isAbsolute(output)) throw new Error("An absolute SERVICE_REPORT_OUTPUT is required");
  const input={url:"https://www.gotokyo.org/en/index.html",language:"ja" as const};
  const page=await fetchSource(input.url,["www.gotokyo.org"]);
  const result=await generateReport(page,input);
  expect(result.report.summary).toMatch(/[ぁ-んァ-ン]/);
  expect(result.report.facts.length).toBeGreaterThan(0);
  expect(result.report.facts.every(f=>page.text.includes(f.quote))).toBe(true);
  await writeFile(output,JSON.stringify({passed:true,scope:"Real HTTPS source and LLM; no payment, no Bazaar listing",result},null,2));
},45_000);
