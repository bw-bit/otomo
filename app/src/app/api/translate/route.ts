import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { openAiCompatibleChat, type ChatFn } from "@/lib/llm";
import { translateTexts } from "@/lib/translate";
import { SUPPORTED_LANGS } from "@/lib/i18n";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  texts: z.array(z.string().min(1).max(800)).min(1).max(50),
  target: z.enum(SUPPORTED_LANGS),
});

export interface TranslateDeps {
  db: () => Promise<Db>;
  chat?: ChatFn;
}

export async function handleTranslate(req: NextRequest, deps: TranslateDeps): Promise<Response> {
  const label = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!label) return NextResponse.json({ error: "相棒の持ち主としてログインしていません" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  try {
    const db = await deps.db();
    const translations = await translateTexts(db, body.data.texts, body.data.target, deps.chat ?? openAiCompatibleChat);
    return NextResponse.json({ translations });
  } catch (e) {
    console.error("[translate] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleTranslate(req, { db: getDb });
}
