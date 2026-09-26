import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { openDb, type Db } from "@/lib/db";
import { canSwitch, roleOf, siblingsOf } from "@/lib/household";

let dir: string;
let db: Db | undefined;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "otomo-household-")); });
afterEach(async () => { db?.close(); db = undefined; await rm(dir, { recursive: true, force: true }); });

const insert = (d: Db, label: string, human: string | null, role: "personal" | "work", at: number) => d.execute({
  sql: "INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at,human,role) VALUES (?,?,?,?,?,?,?,?,?,?)",
  args: [label, `${label}.otomo.eth`, `0x${label}`, "0xres", "{}", `n:${label}`, null, at, human, role],
});

describe("companions migration", () => {
  it("adds human/role to a legacy one-per-human table without losing rows, idempotently", async () => {
    const url = `file:${path.join(dir, "legacy.db")}`;
    const legacy = createClient({ url });
    await legacy.execute(`CREATE TABLE companions (
      label TEXT PRIMARY KEY, full_name TEXT NOT NULL, owner TEXT NOT NULL UNIQUE, resolver TEXT NOT NULL,
      personality TEXT NOT NULL, world_nullifier TEXT NOT NULL UNIQUE, agent_sub TEXT, created_at INTEGER NOT NULL)`);
    await legacy.execute({ sql: "INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)", args: ["sora", "sora.otomo.eth", "0xsora", "0xres", "{}", "0xnull", "sub", 1] });
    legacy.close();

    (await openDb(url)).close();
    db = await openDb(url);
    const sora = (await db.execute("SELECT human, role FROM companions WHERE label = 'sora'")).rows[0];
    expect({ human: sora.human, role: sora.role }).toEqual({ human: "0xnull", role: "personal" });

    await db.execute({
      sql: "INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at,human,role) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: ["hana", "hana.otomo.eth", "0xhana", "0xres", "{}", "0xnull:hana", null, 2, "0xnull", "work"],
    });
    expect(await siblingsOf(db, "sora")).toEqual([
      { label: "sora", full_name: "sora.otomo.eth", role: "personal" },
      { label: "hana", full_name: "hana.otomo.eth", role: "work" },
    ]);
  });
});

describe("household", () => {
  it("groups companions by human and only allows switching within the group", async () => {
    db = await openDb(`file:${path.join(dir, "h.db")}`);
    await insert(db, "sora", "h1", "personal", 1);
    await insert(db, "hana", "h1", "work", 2);
    await insert(db, "kai", "h2", "work", 3);
    await insert(db, "orphan", null, "personal", 4);
    await db.execute("UPDATE companions SET human = NULL WHERE label = 'orphan'");

    expect((await siblingsOf(db, "hana")).map((s) => s.label)).toEqual(["sora", "hana"]);
    expect(await canSwitch(db, "sora", "hana")).toBe(true);
    expect(await canSwitch(db, "sora", "kai")).toBe(false);
    expect(await canSwitch(db, "orphan", "orphan")).toBe(false);
    expect(await canSwitch(db, "sora", "missing")).toBe(false);
    expect(await roleOf(db, "hana.otomo.eth")).toBe("work");
    expect(await roleOf(db, "SORA")).toBe("personal");
    expect(await roleOf(db, "nobody.otomo.eth")).toBeNull();
  });
});
