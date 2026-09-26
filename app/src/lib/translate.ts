import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";
import { openAiCompatibleChat, type ChatFn } from "./llm";
import { LANG_NAMES, type Lang } from "./i18n";

/** Cache key: the pair (text, lang) is unambiguous because lang is fixed-width. */
export const translationHash = (text: string, lang: Lang) =>
  createHash("sha256").update("otomo-context-v2\n").update(text).update("\n").update(lang).digest("hex");

const replySchema = z.array(z.string());

/**
 * Translate each string to `target`, caching rows in the `translations` table.
 * ja is the source language and passes through untouched. On any LLM or
 * validation failure the original text is returned (never cached).
 */
export async function translateTexts(
  db: Db,
  texts: string[],
  target: Lang,
  chat: ChatFn = openAiCompatibleChat,
): Promise<string[]> {
  if (target === "ja" || texts.length === 0) return texts;

  const hashes = texts.map((text) => translationHash(text, target));
  const found = new Map<string, string>();
  const rows = await db.execute({
    sql: `SELECT hash, translated FROM translations WHERE hash IN (${hashes.map(() => "?").join(",")})`,
    args: hashes,
  });
  for (const r of rows.rows) found.set(r.hash as string, r.translated as string);

  // Dedupe before asking the LLM: identical texts share one translation.
  const missing = [...new Set(texts.filter((_, i) => !found.has(hashes[i]!)))];
  if (missing.length > 0) {
    let translated: string[] | null = null;
    try {
      const reply = await chat([
        {
          role: "system",
          content:
            `You are a translator. The user message is a JSON array of strings. ` +
            `Translate each element into natural ${LANG_NAMES[target]}. ` +
            `Context: Otomo companions are AI characters owned by the user. Requests for approval address the human owner as 'you', never another companion. Preserve companion names, token symbols and amounts. ` +
            `Return only the JSON array of strings, in the same order and with the same length.`,
        },
        { role: "user", content: JSON.stringify(missing) },
      ]);
      const parsed = replySchema.safeParse(JSON.parse(reply.match(/\[[\s\S]*\]/)?.[0] ?? ""));
      if (parsed.success && parsed.data.length === missing.length) translated = parsed.data;
    } catch (e) {
      console.warn("[translate] falling back to original text", e);
    }
    if (translated) {
      const now = Date.now();
      await db.batch(
        missing.map((text, i) => ({
          sql: `INSERT OR REPLACE INTO translations (hash, lang, text, translated, created_at) VALUES (?,?,?,?,?)`,
          args: [translationHash(text, target), target, text, translated[i]!, now],
        })),
        "write",
      );
      missing.forEach((text, i) => found.set(translationHash(text, target), translated[i]!));
    }
  }

  return texts.map((text, i) => found.get(hashes[i]!) ?? text);
}
