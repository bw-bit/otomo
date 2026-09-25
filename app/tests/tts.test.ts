import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { openDb, type Db } from "@/lib/db";
import { sessionValue } from "@/lib/session";
import { TTS_VOICES, pickVoice, speechStyle, synthesizeSpeech, ttsEnv, type FetchLike, type TtsEnv } from "@/lib/tts";
import { handleTts, type TtsCache } from "@/app/api/tts/route";

process.env.APP_SECRET = "test-secret";

const PERSONALITY = JSON.stringify({ firstPerson: "ぼく", tone: "げんき", strengths: ["歌"], catchphrase: "よっ" });
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 1, 2, 3]);
const ENV: TtsEnv = { model: "gemini-tts", baseUrl: "https://tts.example", apiKey: "k" };

const okFetch = (): FetchLike =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        steps: [{ type: "model_output", content: [{ type: "audio", data: Buffer.from(WAV).toString("base64"), mime_type: "audio/wav" }] }],
      }),
      { status: 200 },
    ),
  );

const req = (body: unknown, withSession = true) =>
  new NextRequest("http://localhost/api/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withSession ? { cookie: `otomo_session=${sessionValue("taro")}` } : {}),
    },
    body: JSON.stringify(body),
  });

let db: Db;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otomo-tts-"));
  db = await openDb(`file:${path.join(dir, "test.db")}`);
  await db.execute({
    sql: `INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)`,
    args: ["taro", "taro.otomo.eth", "0xowner", "0xres", PERSONALITY, "n1", "sub", 1],
  });
});
afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const deps = (over: Partial<Parameters<typeof handleTts>[1]> = {}) => ({
  env: ENV,
  db: async () => db,
  fetchFn: okFetch(),
  cache: new Map() as TtsCache,
  ...over,
});

describe("ttsEnv / pickVoice / speechStyle", () => {
  it("is disabled without TTS_MODEL or LLM_API_KEY", () => {
    expect(ttsEnv({})).toBeNull();
    expect(ttsEnv({ TTS_MODEL: "m" })).toBeNull();
    expect(ttsEnv({ TTS_MODEL: "m", LLM_API_KEY: "k" })).toMatchObject({ model: "m", baseUrl: "https://generativelanguage.googleapis.com" });
    expect(ttsEnv({ TTS_MODEL: "m", LLM_API_KEY: "k", TTS_BASE_URL: "https://x/" })).toMatchObject({ baseUrl: "https://x" });
  });
  it("picks a deterministic voice per label, with TTS_VOICE override", () => {
    expect(pickVoice("taro", {})).toBe(pickVoice("taro", {}));
    expect(TTS_VOICES).toContain(pickVoice("taro", {}));
    expect(pickVoice("taro", { TTS_VOICE: "Leda" })).toBe("Leda");
  });
  it("builds a style hint from the personality tone", () => {
    expect(speechStyle({ tone: "quiet" })).toContain("quiet");
    expect(speechStyle(null)).toBe("speak naturally, like a trusted sibling");
    expect(speechStyle({ tone: 'weird"tone\n' })).not.toMatch(/["\n]/);
  });
});

describe("synthesizeSpeech", () => {
  it("passes through the returned audio bytes", async () => {
    const fetchFn = okFetch();
    const r = await synthesizeSpeech({ text: "hi", voiceName: "Kore" }, fetchFn, ENV);
    expect(new Uint8Array(r.audio)).toEqual(WAV);
    expect(r.mime).toBe("audio/wav");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://tts.example/v1beta/interactions",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("throws when no audio is returned", async () => {
    const fetchFn: FetchLike = async () => new Response(JSON.stringify({ steps: [] }), { status: 200 });
    await expect(synthesizeSpeech({ text: "hi", voiceName: "Kore" }, fetchFn, ENV)).rejects.toThrow("no audio");
  });
});

describe("POST /api/tts", () => {
  it("401 without a session, 400 on bad body, 503 when unconfigured, 404 for unknown companion", async () => {
    expect((await handleTts(req({ text: "hi" }, false), deps())).status).toBe(401);
    for (const bad of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(801) }, { text: 5 }, { text: "ok", lang: "fr" }]) {
      expect((await handleTts(req(bad), deps())).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await handleTts(req({ text: "hi" }), deps({ env: null }))).status).toBe(503);
    await db.execute(`DELETE FROM companions`);
    expect((await handleTts(req({ text: "hi" }), deps())).status).toBe(404);
  });

  it("returns audio/wav bytes and caches by text+lang+voice+model", async () => {
    const fetchFn = okFetch();
    const d = deps({ fetchFn });
    const r1 = await handleTts(req({ text: "こんにちは" }), d);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await r1.arrayBuffer())).toEqual(WAV);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Same key → cache hit, no second fetch.
    const r2 = await handleTts(req({ text: "こんにちは" }), d);
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(WAV);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // A different lang changes the key.
    await handleTts(req({ text: "こんにちは", lang: "en" }), d);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry beyond the cache limit", async () => {
    const fetchFn = okFetch();
    const d = deps({ fetchFn, cacheLimit: 2 });
    await handleTts(req({ text: "a" }), d);
    await handleTts(req({ text: "b" }), d);
    await handleTts(req({ text: "c" }), d); // evicts "a"
    await handleTts(req({ text: "a" }), d);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    await handleTts(req({ text: "c" }), d); // "c" still cached
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("502 when the upstream TTS call fails", async () => {
    const fetchFn: FetchLike = async () => new Response("upstream broke", { status: 500 });
    const r = await handleTts(req({ text: "hi" }), deps({ fetchFn }));
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: expect.stringContaining("500") });
  });
});
