import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, type Companion, type Db } from "@/lib/db";
import { personalitySchema, type Personality } from "@/lib/llm";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { SUPPORTED_LANGS } from "@/lib/i18n";
import { pickVoice, speechStyle, synthesizeSpeech, ttsEnv, type FetchLike, type TtsEnv } from "@/lib/tts";

export const runtime = "nodejs";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(800),
  lang: z.enum(SUPPORTED_LANGS).default("ja"),
});

export const TTS_CACHE_MAX = 200;
export interface CachedAudio {
  audio: Uint8Array;
  mime: string;
}
export type TtsCache = Map<string, CachedAudio>;

/** Module-level LRU so the cache survives across requests in the same process. */
const defaultCache: TtsCache = new Map();

function cacheGet(cache: TtsCache, key: string): CachedAudio | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(cache: TtsCache, key: string, value: CachedAudio, limit = TTS_CACHE_MAX): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

const audioKey = (text: string, lang: string, voice: string, model: string) =>
  createHash("sha256").update(model).update("\n").update(voice).update("\n").update(lang).update("\n").update(text).digest("hex");

export interface TtsDeps {
  env: TtsEnv | null;
  db: () => Promise<Db>;
  fetchFn?: FetchLike;
  cache?: TtsCache;
  cacheLimit?: number;
}

export async function handleTts(req: NextRequest, deps: TtsDeps): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "相棒の持ち主としてログインしていません" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  if (!deps.env) return NextResponse.json({ error: "読み上げは設定されていません" }, { status: 503 });

  try {
    const db = await deps.db();
    const c = (await db.execute({ sql: `SELECT * FROM companions WHERE label = ?`, args: [label] })).rows[0] as unknown as Companion | undefined;
    if (!c) return NextResponse.json({ error: "相棒が見つかりません" }, { status: 404 });

    let personality: Personality | null = null;
    try {
      personality = personalitySchema.parse(JSON.parse(c.personality));
    } catch {
      console.warn("[tts] unparsable personality, using default style", { label });
    }

    const voice = pickVoice(c.label);
    const key = audioKey(body.data.text, body.data.lang, voice, deps.env.model);
    const cache = deps.cache ?? defaultCache;
    let result = cacheGet(cache, key);
    if (!result) {
      result = await synthesizeSpeech(
        { text: body.data.text, lang: body.data.lang, voiceName: voice, style: speechStyle(personality) },
        deps.fetchFn ?? fetch,
        deps.env,
      );
      cacheSet(cache, key, result, deps.cacheLimit);
    }

    // Copy into a fresh Uint8Array: a Buffer's .buffer may be the shared alloc pool.
    return new Response(new Uint8Array(result.audio), {
      headers: { "content-type": result.mime || "audio/wav", "cache-control": "private, no-store" },
    });
  } catch (e) {
    console.error("[tts] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleTts(req, { env: ttsEnv(), db: getDb });
}
