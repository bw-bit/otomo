import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeFunctionData, toHex } from "viem";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { openDb, type Db } from "@/lib/db";
import { checkBirthProof, markNullifierUsed, type BirthPayload } from "@/lib/birth";
import {
  COMPANION_ROLE_BITMAP,
  MOOD_KEY,
  RegistryRoles,
  ROLE_KEY,
  SIBLINGS_KEY,
  SKILLS_KEY,
  companionInitCalls,
  dnsEncode,
  grantMoodSetterCall,
  normalizeCompanionLabel,
  resolverAbi,
  textSetterFor,
} from "@/lib/ens";
import { traitsFromSeed } from "@/three/traits";

const WALLET = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";
const payload = (over: Partial<BirthPayload["responses"][0]> = {}): BirthPayload => ({
  action: "otomo-birth",
  responses: [{ identifier: "selfie", issuer_schema_id: 11, nullifier: "0xnull", signal_hash: hashSignal(WALLET.toLowerCase()), sybil_score: 1, ...over }],
});

let db: Db;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otomo-birth-"));
  db = await openDb(`file:${path.join(dir, "test.db")}`);
});
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
const ok = vi.fn(async () => ({ ok: true, detail: "" }));

describe("birth proof", () => {
  it("accepts a verified selfie proof bound to the wallet", async () => {
    expect(await checkBirthProof(payload(), WALLET, { db, verifyWithPortal: ok })).toEqual({ ok: true, nullifier: "0xnull", sybilScore: 1, credential: "selfie" });
  });
  it("accepts the hashed v4 action form", async () => {
    const p = { ...payload(), action: "0x00b3ad4f6105123548927b72800e30fd398fe0c73063a4ee2b369852b4dc7cf2" };
    expect(await checkBirthProof(p, WALLET, { db, verifyWithPortal: ok })).toMatchObject({ ok: true });
  });
  it("rejects a different action", async () => {
    const r = await checkBirthProof({ ...payload(), action: "other-action" }, WALLET, { db, verifyWithPortal: ok });
    expect(r).toMatchObject({ ok: false, code: "wrong_action" });
  });
  it("rejects when the portal rejects, before trusting any field", async () => {
    const r = await checkBirthProof(payload(), WALLET, { db, verifyWithPortal: async () => ({ ok: false, detail: "invalid_proof" }) });
    expect(r).toMatchObject({ ok: false, code: "verify_failed" });
  });
  it("rejects a proof bound to another wallet", async () => {
    const r = await checkBirthProof(payload({ signal_hash: hashSignal("0x0000000000000000000000000000000000000001") }), WALLET, { db, verifyWithPortal: ok });
    expect(r).toMatchObject({ ok: false, code: "signal_mismatch" });
  });
  const addCompanion = (label: string, human: string) => db.execute({
    sql: `INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at,human) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [label, `${label}.otomo.eth`, `0x${label}`, "0xres", "{}", `${human}:${label}`, null, 1, human],
  });
  it("defaults to one companion per World ID (nullifier)", async () => {
    await markNullifierUsed(db, "0xnull", 1);
    await markNullifierUsed(db, "0xnull", 2);
    await addCompanion("taro", "0xnull");
    expect(await checkBirthProof(payload(), WALLET, { db, verifyWithPortal: ok })).toMatchObject({ ok: false, code: "duplicate" });
  });
  it("lets one human own up to maxCompanions", async () => {
    await addCompanion("taro", "0xnull");
    await addCompanion("hana", "0xnull");
    await addCompanion("other", "0xsomeoneelse");
    expect(await checkBirthProof(payload(), WALLET, { db, verifyWithPortal: ok, maxCompanions: 3 })).toMatchObject({ ok: true });
    await addCompanion("jiro", "0xnull");
    expect(await checkBirthProof(payload(), WALLET, { db, verifyWithPortal: ok, maxCompanions: 3 })).toMatchObject({ ok: false, code: "duplicate", reason: "この World ID で作れる相棒は3体までです" });
  });
  it("rolls back a nullifier insert when the companion insert fails", async () => {
    await expect(db.batch([
      { sql: `INSERT INTO used_nullifiers VALUES (?, ?)`, args: ["0xnull", 1] },
      { sql: `INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at) VALUES (?,?,?,?,?,?,?,?)`, args: ["taro", "taro.otomo.eth", "0xowner", "0xres", "{}", "0xnull", null, null] },
    ], "write")).rejects.toThrow();
    expect((await db.execute({ sql: `SELECT 1 FROM used_nullifiers WHERE nullifier = ?`, args: ["0xnull"] })).rows).toHaveLength(0);
  });
  it("rejects high sybil risk when a threshold is configured", async () => {
    const r = await checkBirthProof(payload({ sybil_score: 9 }), WALLET, { db, verifyWithPortal: ok, sybilMax: 3 });
    expect(r).toMatchObject({ ok: false, code: "sybil_risk" });
  });
  it("accepts passport, mnc and proof_of_human credentials", async () => {
    for (const [identifier, issuer_schema_id] of [["passport", 9303], ["mnc", 9310], ["proof_of_human", 1]] as const) {
      const r = await checkBirthProof(payload({ identifier, issuer_schema_id }), WALLET, { db, verifyWithPortal: ok });
      expect(r).toMatchObject({ ok: true, credential: identifier });
    }
  });
  it("rejects unsupported credentials", async () => {
    const r = await checkBirthProof(payload({ identifier: "device", issuer_schema_id: 9999 }), WALLET, { db, verifyWithPortal: ok });
    expect(r).toMatchObject({ ok: false, code: "unsupported_credential" });
  });
});

describe("ENS calldata", () => {
  it("DNS-encodes names", () => {
    expect(dnsEncode("taro.otomo.eth")).toBe(toHex(new Uint8Array([4, ...Buffer.from("taro"), 5, ...Buffer.from("otomo"), 3, ...Buffer.from("eth"), 0])));
  });
  it("companion names are not transferable", () => {
    expect(COMPANION_ROLE_BITMAP & RegistryRoles.ROLE_CAN_TRANSFER_ADMIN).toBe(0n);
    expect(COMPANION_ROLE_BITMAP & RegistryRoles.ROLE_SET_RESOLVER).toBe(RegistryRoles.ROLE_SET_RESOLVER);
  });
  it("scopes the agent grant to the mood key only", () => {
    const setter = decodeFunctionData({ abi: resolverAbi, data: textSetterFor(MOOD_KEY) });
    expect(setter).toMatchObject({ functionName: "setText", args: ["0x", MOOD_KEY, ""] });
    const grant = decodeFunctionData({ abi: resolverAbi, data: grantMoodSetterCall("0x00000000000000000000000000000000000000a9") });
    expect(grant.functionName).toBe("grantSetterRoles");
  });
  it("includes the agent grant in init calls only when requested", () => {
    const rec = { fullName: "taro.otomo.eth", owner: WALLET as `0x${string}`, description: "d", personalityJson: "{}", mood: "calm" };
    expect(companionInitCalls(rec, null)).toHaveLength(4);
    expect(companionInitCalls(rec, "0x00000000000000000000000000000000000000a9")).toHaveLength(5);
  });
  it("publishes role, skills and siblings for discovery", () => {
    const rec = { fullName: "hana.otomo.eth", owner: WALLET as `0x${string}`, description: "d", personalityJson: "{}", mood: "calm", role: "work", skills: '["翻訳"]', siblings: "sora.otomo.eth" };
    const calls = companionInitCalls(rec, null).map((data) => decodeFunctionData({ abi: resolverAbi, data }));
    expect(calls).toHaveLength(7);
    expect(calls.slice(4).map((c) => c.args?.slice(1))).toEqual([[ROLE_KEY, "work"], [SKILLS_KEY, '["翻訳"]'], [SIBLINGS_KEY, "sora.otomo.eth"]]);
  });
  it("validates companion labels", () => {
    expect(normalizeCompanionLabel(" Taro ")).toBe("taro");
    expect(() => normalizeCompanionLabel("ab")).toThrow();
    expect(() => normalizeCompanionLabel("-bad")).toThrow();
  });
});

describe("companion traits", () => {
  it("are deterministic per seed and differ across seeds", () => {
    expect(traitsFromSeed("taro.otomo.eth")).toEqual(traitsFromSeed("taro.otomo.eth"));
    expect(traitsFromSeed("taro.otomo.eth")).not.toEqual(traitsFromSeed("hana.otomo.eth"));
  });
});
