// Shared, public contract. No credentials, session data or wallet signing code.
export const REPORT_PRICE = "0.05";
export const REPORT_AMOUNT = 50_000;
export const REPORT_DESCRIPTION = "Read an allowed public HTTPS page and return a concise English or Japanese report with source quotes, URL and retrieval time. No login-only pages or JavaScript rendering.";
export const DEFAULT_SOURCE_HOSTS = ["www.gotokyo.org", "www.japan.travel", "docs.world.org"];
export const INPUT_EXAMPLE: {url: string; language: "en" | "ja"} = { url: "https://www.gotokyo.org/en/index.html", language: "en" };
export const INPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["url", "language"],
  properties: {
    url: { type: "string", format: "uri", maxLength: 2048, description: "Public HTTPS URL on one of the advertised allowedHosts; no credentials or nonstandard ports." },
    language: { type: "string", enum: ["en", "ja"], description: "Report language." },
  },
};
export const OUTPUT_SCHEMA = {
  type: "object", required: ["report", "seller", "service"],
  properties: {
    service: { type: "string", const: "page-report" }, seller: { type: "string" },
    report: {
      type: "object", required: ["title", "summary", "facts", "source", "language", "cached"],
      properties: {
        title: { type: "string" }, summary: { type: "string" }, language: { type: "string", enum: ["en", "ja"] }, cached: { type: "boolean" },
        facts: { type: "array", items: { type: "object", required: ["claim", "quote"], properties: { claim: { type: "string" }, quote: { type: "string", description: "Verbatim excerpt found in the retrieved page text." } } } },
        source: { type: "object", required: ["url", "retrievedAt", "sha256", "truncated"], properties: { url: { type: "string" }, retrievedAt: { type: "string" }, sha256: { type: "string" }, truncated: { type: "boolean" } } },
      },
    },
  },
};
export const OUTPUT_EXAMPLE = {
  service: "page-report", seller: "taro.otomo.eth",
  report: { title: "Example page", summary: "An example of the response format; not live information.", facts: [{ claim: "The page lists opening hours.", quote: "Open 10:00–18:00" }], language: "en", cached: false, source: { url: INPUT_EXAMPLE.url, retrievedAt: "2026-09-26T00:00:00.000Z", sha256: "0".repeat(64), truncated: false } },
};
export const NETWORKS = {
  "eip155:84532": { name: "Base Sepolia", testnet: true, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", explorer: "https://sepolia.basescan.org" },
  "eip155:8453": { name: "Base", testnet: false, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org" },
} as const;
export type ServiceNetwork = keyof typeof NETWORKS;
export interface ServiceCatalog {
  service: "page-report";
  description: string;
  price: string;
  currency: "USDC";
  network: ServiceNetwork;
  networkName: string;
  testnet: boolean;
  enabled: boolean;
  allowedHosts: string[];
  dailyJobLimit: number;
  cacheSeconds: number;
  bazaarStatus: "not-verified" | "observed-testnet";
  bazaarVerifiedAt: string | null;
  sellers: { label: string; name: string; payTo: string; endpoint: string }[];
  inputSchema: typeof INPUT_SCHEMA;
  outputSchema: typeof OUTPUT_SCHEMA;
  exampleInput: typeof INPUT_EXAMPLE;
  exampleOutput: typeof OUTPUT_EXAMPLE;
}
