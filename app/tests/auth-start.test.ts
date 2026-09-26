import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { openDb, type Db } from "@/lib/db";
import { sessionValue, SESSION_COOKIE } from "@/lib/session";
import { createPendingAction } from "@/lib/approval";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...(await original<object>()), getDb: mocks.getDb }));
import { GET } from "@/app/api/auth/start/route";

let db: Db;
let dir: string;
beforeEach(async () => {
  vi.stubEnv("APP_SECRET", "route-test-secret");
  dir = await mkdtemp(path.join(tmpdir(), "otomo-start-"));
  db = await openDb(`file:${dir}/test.db`);
  mocks.getDb.mockResolvedValue(db);
  await db.execute({ sql: `INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at) VALUES (?,?,?,?,?,?,?,?)`, args: ["alice", "alice.otomo.eth", "0xowner", "0xresolver", "{}", "nullifier", null, Date.now()] });
});
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const req = (url: string, label?: string) =>
  new NextRequest(url, { headers: label ? { cookie: `${SESSION_COOKIE}=${sessionValue(label)}` } : {} });

it("kind=approve always redirects to the owner approval page", async () => {
  const a = await createPendingAction(db, { companion: "alice", intent: { type: "private_task", summary: "x" }, amountUsdc: 0, now: Date.now() });
  const res = await GET(req(`https://app.example/api/auth/start?kind=approve&action=${a.id}`, "alice"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(`https://app.example/approval/world?action=${a.id}`);
  expect((await db.execute("SELECT COUNT(*) AS n FROM auth_flows")).rows[0].n).toBe(0);
});

it("kind=approve still requires the owner session and a pending action", async () => {
  const a = await createPendingAction(db, { companion: "alice", intent: { type: "private_task", summary: "x" }, amountUsdc: 0, now: Date.now() });
  expect((await GET(req(`https://app.example/api/auth/start?kind=approve&action=${a.id}`))).status).toBe(401);
  expect((await GET(req(`https://app.example/api/auth/start?kind=approve&action=${a.id}`, "bob"))).status).toBe(404);
  expect((await GET(req(`https://app.example/api/auth/start?kind=approve&action=nope`, "alice"))).status).toBe(404);
});
