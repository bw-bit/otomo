import type { IDKitResultSession } from "@worldcoin/idkit";

/** A 200 may represent partial success. Every requested credential must verify. */
export async function verifyWorldSession(rpId: string, proof: IDKitResultSession): Promise<boolean> {
  const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proof),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return false;
  const body = await response.json();
  return body.success === true &&
    (!body.session_id || body.session_id === proof.session_id) &&
    (!body.environment || body.environment === "production") &&
    Array.isArray(body.results) && body.results.length === proof.responses.length &&
    proof.responses.every(p => body.results.some((r: { identifier?: string; success?: boolean }) => r.identifier === p.identifier && r.success === true)) &&
    body.results.every((r: { success?: boolean }) => r.success === true);
}
