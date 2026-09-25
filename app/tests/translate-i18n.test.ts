import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { openDb, type Db } from "@/lib/db";
import { sessionValue } from "@/lib/session";
import { translateTexts, translationHash } from "@/lib/translate";
import type { ChatFn } from "@/lib/llm";
import { handleTranslate } from "@/app/api/translate/route";
import { SUPPORTED_LANGS, UI_STRINGS, isLang, pickEntry, t } from "@/lib/i18n";

process.env.APP_SECRET = "test-secret";

const req = (body: unknown, withSession = true) =>
  new NextRequest("http://localhost/api/translate", {
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
  dir = await mkdtemp(path.join(tmpdir(), "otomo-translate-"));
  db = await openDb(`file:${path.join(dir, "test.db")}`);
});
afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const translationsTable = async () =>
  (await db.execute(`SELECT * FROM translations`)).rows as unknown as { hash: string; lang: string; text: string; translated: string }[];

describe("POST /api/translate", () => {
  it("401 without a session and 400 on invalid bodies", async () => {
    const deps = { db: async () => db, chat: vi.fn(async () => "[]") };
    expect((await handleTranslate(req({ texts: ["a"], target: "en" }, false), deps)).status).toBe(401);
    for (const bad of [
      {},
      { texts: [] },
      { texts: ["a"] },
      { texts: "a", target: "en" },
      { texts: ["a"], target: "fr" },
      { texts: ["x".repeat(801)], target: "en" },
    ]) {
      expect((await handleTranslate(req(bad), deps)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
  });

  it("passes ja through without calling the LLM", async () => {
    const chat = vi.fn(async () => "[]");
    const r = await handleTranslate(req({ texts: ["こんにちは"], target: "ja" }), { db: async () => db, chat });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ translations: ["こんにちは"] });
    expect(chat).not.toHaveBeenCalled();
  });

  it("translates via the LLM, caches rows, and reuses the cache", async () => {
    const chat = vi.fn<ChatFn>(async () => '["Hello","See you"]');
    const r = await handleTranslate(req({ texts: ["こんにちは", "またね"], target: "en" }), { db: async () => db, chat });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ translations: ["Hello", "See you"] });
    expect(chat).toHaveBeenCalledTimes(1);
    // The user message carries the JSON array of the same texts.
    const sent = JSON.parse(chat.mock.calls[0]![0][1]!.content);
    expect(sent).toEqual(["こんにちは", "またね"]);

    const rows = await translationsTable();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hash: translationHash("こんにちは", "en"), lang: "en", translated: "Hello" });

    // Second identical request: served from the cache.
    const r2 = await handleTranslate(req({ texts: ["こんにちは", "またね"], target: "en" }), { db: async () => db, chat });
    expect(await r2.json()).toEqual({ translations: ["Hello", "See you"] });
    expect(chat).toHaveBeenCalledTimes(1);
    // A different target is a different cache entry.
    await handleTranslate(req({ texts: ["こんにちは"], target: "en" }), { db: async () => db, chat });
    expect(chat).toHaveBeenCalledTimes(1);
    const chatKo = vi.fn<ChatFn>(async () => '["안녕"]');
    const r3 = await handleTranslate(req({ texts: ["こんにちは"], target: "ko" }), { db: async () => db, chat: chatKo });
    expect(await r3.json()).toEqual({ translations: ["안녕"] });
    expect(chatKo).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original text on LLM failure, without caching", async () => {
    for (const chat of [
      vi.fn(async () => "not json"),
      vi.fn(async () => '["only one"]'),
      vi.fn(async () => { throw new Error("LLM down"); }),
    ]) {
      const r = await handleTranslate(req({ texts: ["a", "b"], target: "en" }), { db: async () => db, chat });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ translations: ["a", "b"] });
      expect(chat).toHaveBeenCalledTimes(1);
    }
    expect(await translationsTable()).toHaveLength(0);
  });
});

describe("translateTexts", () => {
  it("returns texts in input order and dedupes identical inputs", async () => {
    const chat = vi.fn<ChatFn>(async () => '["Hola1","Hola2"]');
    const out = await translateTexts(db, ["b", "a", "b"], "en", chat);
    expect(out).toEqual(["Hola1", "Hola2", "Hola1"]);
    expect(chat).toHaveBeenCalledTimes(1);
    // Only the unique texts were sent.
    expect(JSON.parse(chat.mock.calls[0]![0][1]!.content)).toEqual(["b", "a"]);
  });
});

describe("i18n", () => {
  it("has a non-empty ja string and all four languages for every key", () => {
    for (const [key, entry] of Object.entries(UI_STRINGS)) {
      expect(entry.ja.length, key).toBeGreaterThan(0);
      for (const lang of SUPPORTED_LANGS) {
        expect((entry as Record<string, string>)[lang], `${key}.${lang}`).toBeTruthy();
      }
    }
  });
  it("falls back to ja when a language is missing and to interpolation vars", () => {
    expect(pickEntry({ ja: "あ" }, "en")).toBe("あ");
    expect(pickEntry({ ja: "あ", en: "a" }, "en")).toBe("a");
    expect(pickEntry({ ja: "{n} 件" }, "en", { n: 3 })).toBe("3 件");
    expect(t("send", "en")).toBe("Send");
    expect(t("send", "ja")).toBe("送る");
  });
  it("isLang accepts only supported languages", () => {
    for (const l of SUPPORTED_LANGS) expect(isLang(l)).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});
