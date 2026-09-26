import { intentSchema, type Intent } from "./intent";
/** Display-only derivations. Approval and payment authority stay on the server. */
export interface DemoRequest {
  id: string; from_label: string; to_label: string; task: string; reward_usdc: number; status: string;
  content?: string; reviewed_at?: number; reward_action_id?: string;
  reward_expires_at?: number; reward_status?: string; reward_reason?: string | null; reward_tx_hash?: string | null;
}
export function rewardPaid(r: DemoRequest): boolean {
  return r.reward_status === "executed" && !r.reward_reason && Boolean(r.reward_tx_hash);
}
export function rewardNeedsRenewal(r: DemoRequest, now = Date.now()): boolean {
  return Boolean(r.reward_action_id) && !r.reward_tx_hash && (r.reward_status === "expired" || r.reward_status === "rejected" || (r.reward_status === "pending" && Number(r.reward_expires_at) <= now));
}
export function workStage(r: DemoRequest): number {
  if (rewardPaid(r)) return 4;
  if (r.reviewed_at != null || r.status === "done") return 3;
  if (r.content) return 2;
  return 1;
}
export function readDisplayIntent(raw: string): Intent | null {
  try { const parsed = intentSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
