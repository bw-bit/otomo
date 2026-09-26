import { PublicProfileView } from "@/components/PublicProfileView";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { readText } from "@/lib/chain";
import { REPUTATION_KEY, type ReputationSnapshot } from "@/lib/reputation";
export const dynamic = "force-dynamic";
export default async function PublicProfile({ params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  if (!/^[a-z0-9-]{3,20}$/.test(label)) notFound();
  const db = await getDb();
  const row = (await db.execute({ sql: "SELECT p.*, c.full_name FROM reputation_publications p JOIN companions c ON c.label = p.label WHERE p.label = ? AND p.tx_hash IS NOT NULL", args: [label] })).rows[0];
  if (!row) return <PublicProfileView name={`${label}.otomo.eth`} profile={null} />;
  const snapshot = JSON.parse(String(row.snapshot)) as ReputationSnapshot;
  const current = await readText(String(row.full_name), REPUTATION_KEY).catch(() => null);
  const verified = current === String(row.snapshot);
  return <PublicProfileView name={String(row.full_name)} profile={{ name: String(row.full_name), snapshot, raw: String(row.snapshot), verified, txHash: String(row.tx_hash) }} />;
}
