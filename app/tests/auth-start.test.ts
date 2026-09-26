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

it("kind=approve always starts the Sandbox OIDC flow (fresh verification)", async () => {
  vi.stubEnv("AGENT_OIDC_ISSUER", "https://sandbox.auth.world.org");
  vi.stubEnv("AGENT_OIDC_CLIENT_ID", "test-client");
  vi.stubEnv("AGENT_OIDC_CLIENT_SECRET", "test-secret");
  vi.stubEnv("AGENT_OIDC_REDIRECT_URI", "https://app.example/api/auth/callback");
  const a = await createPendingAction(db, { companion: "alice", intent: { type: "private_task", summary: "x" }, amountUsdc: 0, now: Date.now() });
  const res = await GET(req(`https://app.example/api/auth/start?kind=approve&action=${a.id}`, "alice"));
  expect(res.status).toBe(307);
  const loc = res.headers.get("location") ?? "";
  expect(loc.startsWith("https://sandbox.auth.world.org/api/v1/authorize?")).toBe(true);
  expect(loc).toContain("prompt=login");
  const flows = (await db.execute("SELECT * FROM auth_flows")).rows;
  expect(flows.length).toBe(1);
  expect(flows[0].kind).toBe("approve");
  expect(flows[0].ref).toBe(a.id);
});

it("kind=approve still requires the owner session and a pending action", async () => {
  const a = await createPendingAction(db, { companion: "alice", intent: { type: "private_task", summary: "x" }, amountUsdc: 0, now: Date.now() });
  expect((await GET(req(`https://app.example/api/auth/start?kind=approve&action=${a.id}`))).status).toBe(401);
  expect((await GET(req(`https://app.example/api/auth/start?kind=approve&action=${a.id}`, "bob"))).status).toBe(404);
  expect((await GET(req(`https://app.example/api/auth/start?kind=approve&action=nope`, "alice"))).status).toBe(404);
});
