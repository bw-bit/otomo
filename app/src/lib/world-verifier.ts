import type { IDKitResult, IDKitResultSession } from "@worldcoin/idkit";

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

/** Verifies a uniqueness proof (v3 legacy or v4) — the same endpoint birth uses. */
export async function verifyWorldProof(rpId: string, proof: IDKitResult): Promise<boolean> {
  const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proof),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null) as {
    success?: boolean;
    environment?: string;
    results?: { identifier?: string; success?: boolean }[];
  } | null;
  if (!body || body.success === false || (body.environment && body.environment !== "production")) return false;
  if (Array.isArray(body.results)) {
    const items = "responses" in proof && Array.isArray(proof.responses) ? proof.responses : [];
    if (!body.results.every(r => r.success === true)) return false;
    if (!items.every(p => body.results!.some(r => r.identifier === p.identifier))) return false;
  }
  return true;
}
