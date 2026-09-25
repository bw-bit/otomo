import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Companion, type Strategy } from "@/lib/db";
import { shipTxParams, virtualBalances, walletBalances } from "@/lib/aqua";
import { requireEnv } from "@/lib/env";
import { ENS_SEPOLIA } from "@/lib/ens";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

function publicEnv(): { aqua: string; router: string; usdc: string; weth: string } | null {
  try {
    const e = requireEnv("AQUA_ADDRESS", "AQUA_ROUTER_ADDRESS", "MOCK_WETH_ADDRESS");
    return { aqua: e.AQUA_ADDRESS, router: e.AQUA_ROUTER_ADDRESS, usdc: ENS_SEPOLIA.mockUsdc, weth: e.MOCK_WETH_ADDRESS };
  } catch {
    return null; // stack not deployed yet — rows still listed, actions unavailable
  }
}

/** Owner's strategy list. `ready` rows carry ship params; `shipped` rows carry live balances. */
export async function GET(req: NextRequest): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    const db = await getDb();
    const c = (await db.execute({ sql: `SELECT * FROM companions WHERE label = ?`, args: [label] })).rows[0] as unknown as Companion | undefined;
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    const rows = (await db.execute({
      sql: `SELECT * FROM strategies WHERE companion = ? ORDER BY created_at DESC`, args: [label],
    })).rows as unknown as Strategy[];

    const strategies = await Promise.all(rows.map(async (row) => {
      const out: Record<string, unknown> = { ...row };
      try {
        if (row.status === "ready") out.ship = shipTxParams(row);
        if (row.status === "shipped") {
          out.virtual = await virtualBalances(row);
          out.wallet = await walletBalances(row.maker as `0x${string}`);
        }
      } catch (e) {
        out.paramsError = e instanceof Error ? e.message : String(e);
      }
      return out;
    }));

    return NextResponse.json({ env: publicEnv(), strategies });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
