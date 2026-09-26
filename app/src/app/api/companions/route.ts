import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public companion directory for discovery: only public-facing fields, never identity or wallet internals. */
export async function GET(): Promise<Response> {
  try {
    const rows = (await (await getDb()).execute("SELECT label, full_name, role, personality FROM companions ORDER BY created_at")).rows;
    const companions = rows.map((r) => {
      let skills: string[] = [];
      try { const p = JSON.parse(String(r.personality)); if (Array.isArray(p?.strengths)) skills = p.strengths.map(String); } catch { /* malformed personality → no skills */ }
      return { label: String(r.label), full_name: String(r.full_name), role: r.role === "work" ? "work" : "personal", skills };
    });
    return NextResponse.json({ companions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
