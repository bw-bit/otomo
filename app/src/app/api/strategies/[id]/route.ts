import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Hex } from "viem";
import { getDb, type Strategy } from "@/lib/db";
import { agentDemoSwap, confirmDock, confirmShip } from "@/lib/aqua";
import { createPendingAction } from "@/lib/approval";
import { hasCompanionWallet } from "@/lib/companion-wallet";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("shipped"), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  z.object({ event: z.literal("docked"), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  z.object({ event: z.literal("demo_swap") }),
  z.object({ event: z.literal("prepare"), operation: z.enum(["ship", "dock", "demo_swap"]) }),
]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  try {
    const db = await getDb();
    const row = (await db.execute({
      sql: `SELECT * FROM strategies WHERE id = ? AND companion = ?`, args: [id, label],
    })).rows[0] as unknown as Strategy | undefined;
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    const managed = await hasCompanionWallet(db, label);
    if (managed) {
      if (body.data.event !== "prepare") return NextResponse.json({ error: "World IDによる承認が必要です" }, { status: 403 });
      const action = await createPendingAction(db, { companion: label, intent: { type: "strategy_operation", strategyId: id, operation: body.data.operation }, amountUsdc: body.data.operation === "ship" ? row.usdc_amount : 0, now: Date.now() });
      return NextResponse.json({ actionId: action.id });
    }
    switch (body.data.event) {
      case "prepare": return NextResponse.json({ error: "専用ウォレットへの移行が必要です" }, { status: 409 });
      case "shipped": {
        if (row.status !== "ready") return NextResponse.json({ error: "strategy is not ready" }, { status: 409 });
        const strategyHash = await confirmShip(row, body.data.txHash as Hex);
        await db.execute({
          sql: `UPDATE strategies SET status = 'shipped', strategy_hash = ?, ship_tx = ? WHERE id = ? AND status = 'ready'`,
          args: [strategyHash, body.data.txHash, row.id],
        });
        return NextResponse.json({ ok: true, strategyHash });
      }
      case "docked": {
        if (row.status !== "shipped") return NextResponse.json({ error: "strategy is not shipped" }, { status: 409 });
        await confirmDock(row, body.data.txHash as Hex);
        await db.execute({
          sql: `UPDATE strategies SET status = 'docked', dock_tx = ? WHERE id = ? AND status = 'shipped'`,
          args: [body.data.txHash, row.id],
        });
        return NextResponse.json({ ok: true });
      }
      case "demo_swap": {
        if (row.status !== "shipped") return NextResponse.json({ error: "strategy is not shipped" }, { status: 409 });
        const txHash = await agentDemoSwap(row);
        return NextResponse.json({ ok: true, txHash });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
