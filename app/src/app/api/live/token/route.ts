import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Companion, type Db } from "@/lib/db";
import { personalitySchema, type Personality } from "@/lib/llm";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { issueLiveToken, liveConnectConfig, liveEnv, liveSystemPrompt, type LiveEnv, type TokenIssuer } from "@/lib/live";
import { pickVoice } from "@/lib/tts";

export const runtime = "nodejs";

export interface LiveTokenDeps {
  env: LiveEnv | null;
  db: () => Promise<Db>;
  issueToken?: TokenIssuer;
}

/**
 * Issues a single-use ephemeral token for a browser → Gemini Live WebSocket.
 * The real API key never leaves the server; model, voice and persona are
 * locked into the token's liveConnectConstraints.
 */
export async function handleLiveToken(req: NextRequest, deps: LiveTokenDeps): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "相棒の持ち主としてログインしていません" }, { status: 401 });
  if (!deps.env) return NextResponse.json({ error: "音声会話は設定されていません" }, { status: 503 });

  try {
    const db = await deps.db();
    const c = (await db.execute({ sql: `SELECT * FROM companions WHERE label = ?`, args: [label] })).rows[0] as unknown as Companion | undefined;
    if (!c) return NextResponse.json({ error: "相棒が見つかりません" }, { status: 404 });

    let personality: Personality | null = null;
    try {
      personality = personalitySchema.parse(JSON.parse(c.personality));
    } catch {
      console.warn("[live] unparsable personality, using default persona", { label });
    }

    const voice = pickVoice(c.label);
    const config = liveConnectConfig(liveSystemPrompt(c.label, c.full_name, personality), voice);
    const token = await (deps.issueToken ?? issueLiveToken)(deps.env.apiKey, deps.env.model, config);
    return NextResponse.json({ token, model: deps.env.model, config });
  } catch (e) {
    console.error("[live] token failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleLiveToken(req, { env: liveEnv(), db: getDb });
}
