import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { openDb, type Db } from "@/lib/db";
import { sessionValue } from "@/lib/session";
import { TTS_VOICES } from "@/lib/tts";
import { DEFAULT_LIVE_MODEL, liveConnectConfig, liveEnv, liveSystemPrompt, type LiveEnv } from "@/lib/live";
import { handleLiveToken } from "@/app/api/live/token/route";

process.env.APP_SECRET = "test-secret";

const PERSONALITY = JSON.stringify({ firstPerson: "おれ", tone: "冷静", strengths: ["先回り"], catchphrase: "任せろ" });
const ENV: LiveEnv = { apiKey: "k", model: DEFAULT_LIVE_MODEL };

const req = (withSession = true, label = "taro") =>
  new NextRequest("http://localhost/api/live/token", {
    method: "POST",
    headers: withSession ? { cookie: `otomo_session=${sessionValue(label)}` } : {},
  });

let db: Db;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otomo-live-"));
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

const issueToken = vi.fn(async () => "ephemeral-token-1");

describe("liveEnv", () => {
  it("is disabled without LLM_API_KEY", () => {
    expect(liveEnv({})).toBeNull();
  });
  it("defaults to the stable 3.8 live model and honors LIVE_MODEL", () => {
    expect(liveEnv({ LLM_API_KEY: "k" })?.model).toBe("gemini-3.8-live");
    expect(liveEnv({ LLM_API_KEY: "k", LIVE_MODEL: "x" })?.model).toBe("x");
  });
});

describe("liveSystemPrompt", () => {
  it("keeps the persona but forbids JSON/markdown for voice", () => {
    const p = liveSystemPrompt("taro", "taro.otomo.eth", { firstPerson: "おれ", tone: "冷静", strengths: ["先回り"], catchphrase: "任せろ" });
    expect(p).toContain("taro.otomo.eth");
    expect(p).toContain("音声会話");
  });
});

describe("liveConnectConfig", () => {
  it("requests audio output and both transcriptions", () => {
    const c = liveConnectConfig("sys", "Kore");
    expect(c.responseModalities).toEqual(["AUDIO"]);
    expect(c.inputAudioTranscription).toEqual({});
    expect(c.outputAudioTranscription).toEqual({});
  });
});

describe("handleLiveToken", () => {
  it("rejects anonymous callers", async () => {
    const res = await handleLiveToken(req(false), { env: ENV, db: async () => db, issueToken });
    expect(res.status).toBe(401);
  });
  it("is 503 when not configured", async () => {
    const res = await handleLiveToken(req(), { env: null, db: async () => db, issueToken });
    expect(res.status).toBe(503);
  });
  it("is 404 for an unknown companion", async () => {
    const res = await handleLiveToken(req(true, "ghost"), { env: ENV, db: async () => db, issueToken });
    expect(res.status).toBe(404);
  });
  it("mints an ephemeral token locked to the companion's voice and persona", async () => {
    issueToken.mockClear();
    const res = await handleLiveToken(req(), { env: ENV, db: async () => db, issueToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; model: string; config: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }; systemInstruction: unknown } };
    expect(body.token).toBe("ephemeral-token-1");
    expect(body.model).toBe(DEFAULT_LIVE_MODEL);
    expect(TTS_VOICES).toContain(body.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName);
    expect(String(body.config.systemInstruction)).toContain("taro.otomo.eth");
    expect(issueToken).toHaveBeenCalledWith("k", DEFAULT_LIVE_MODEL, expect.objectContaining({ responseModalities: ["AUDIO"] }));
  });
});
