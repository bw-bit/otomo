import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Companion, type Strategy } from "@/lib/db";
import { MOCK_WETH_USDC_RATE, SWAPVM_FEE_PERCENT, shipTxParams, virtualBalances, walletBalances } from "@/lib/aqua";
import { requireEnv } from "@/lib/env";
import { ENS_SEPOLIA } from "@/lib/ens";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

function publicEnv(): { aqua: string; router: string; usdc: string; weth: string } | null {
  try {
    const e = requireEnv("AQUA_ADDRESS", "AQUA_ROUTER_ADDRESS", "OTOMO_ORDER_BUILDER_ADDRESS", "MOCK_WETH_ADDRESS");
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
        if (row.status === "ready") {
          out.ship = shipTxParams(row);
          const wallet = await walletBalances(row.maker as `0x${string}`);
          out.wallet = wallet;
          out.funding = {
            ready: wallet.usdc >= row.usdc_amount && wallet.weth >= row.weth_amount,
            required: { usdc: row.usdc_amount, weth: row.weth_amount },
            missing: {
              usdc: Math.max(0, row.usdc_amount - wallet.usdc),
              weth: Math.max(0, row.weth_amount - wallet.weth),
            },
          };
        }
        if (row.status === "shipped" || row.status === "docked") {
          out.virtual = await virtualBalances(row);
          out.wallet = await walletBalances(row.maker as `0x${string}`);
        }
      } catch (e) {
        out.paramsError = e instanceof Error ? e.message : String(e);
      }
      return out;
    }));

    const env = publicEnv();
    return NextResponse.json({
      env,
      demo: env ? {
        network: "Sepolia",
        chainId: 11155111,
        testTokens: true,
        assets: {
          usdc: { symbol: "mUSDC", address: env.usdc, decimals: 6 },
          weth: { symbol: "mWETH", address: env.weth, decimals: 18 },
        },
        referenceRate: { base: "mWETH", quote: "mUSDC", mWETH: 1, mUSDC: MOCK_WETH_USDC_RATE, source: "fixed demo seed; not a market oracle" },
        swapFeePercent: SWAPVM_FEE_PERCENT,
        swapFeeDescription: "SwapVM applies the 0.3% input fee before pricing; the full input is credited to Aqua virtual inventory.",
      } : null,
      strategies,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
