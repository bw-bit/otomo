import { afterEach, expect, it, vi } from "vitest";
import type { IDKitResultSession } from "@worldcoin/idkit";
import { verifyWorldSession } from "@/lib/world-verifier";
const proof: IDKitResultSession = { protocol_version: "4.0", environment: "production", session_id: "session_test", nonce: "nonce", responses: [{ identifier: "selfie", issuer_schema_id: 11, proof: [], session_nullifier: ["0x1", "0x2"], expires_at_min: 123, sybil_score: 0 }] };
afterEach(() => vi.unstubAllGlobals());
it("forwards the proof unchanged and checks verified credentials", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ success: true, results: [{ identifier: "selfie", success: true }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await verifyWorldSession("rp_test", proof)).toBe(true);
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(proof));
});
it.each([
  { success: false, results: [{ identifier: "selfie", success: true }] },
  { success: true, results: [{ identifier: "selfie", success: false }] },
  { success: true, results: [{ identifier: "other", success: true }] },
  { success: true, results: [] },
  { success: true },
  { success: true, session_id: "session_other", results: [{ identifier: "selfie", success: true }] },
  { success: true, environment: "sandbox", results: [{ identifier: "selfie", success: true }] },
])("rejects incomplete or mismatched verification %#", async body => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  expect(await verifyWorldSession("rp_test", proof)).toBe(false);
});
it("rejects non-200 even with a successful-looking body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true }, { status: 400 })));
  expect(await verifyWorldSession("rp_test", proof)).toBe(false);
});
