import "server-only";
import { createHash } from "node:crypto";
import { LANG_LOCALES, LANG_NAMES, isLang } from "./i18n";

export const DEFAULT_TTS_BASE_URL = "https://generativelanguage.googleapis.com";

/** A few of Gemini's prebuilt studio voices (ai.google.dev/gemini-api/docs/speech-generation). */
export const TTS_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Leda", "Zephyr", "Fenrir", "Sulafat"] as const;

export class TtsNotConfiguredError extends Error {
  constructor() {
    super("TTS is not configured");
  }
}

export interface TtsEnv {
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** TTS is opt-in: unset TTS_MODEL (or the shared Gemini LLM_API_KEY) means disabled. */
export function ttsEnv(env: Partial<NodeJS.ProcessEnv> = process.env): TtsEnv | null {
  const model = env.TTS_MODEL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!model || !apiKey) return null;
  const baseUrl = (env.TTS_BASE_URL?.trim() || DEFAULT_TTS_BASE_URL).replace(/\/+$/, "");
  return { model, baseUrl, apiKey };
}

/** Deterministic per-companion voice; TTS_VOICE overrides for everyone. */
export function pickVoice(label: string, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const forced = env.TTS_VOICE?.trim();
  if (forced) return forced;
  const hash = createHash("sha256").update(label).digest();
  return TTS_VOICES[hash[0]! % TTS_VOICES.length];
}

/** Short English style hint from the companion's personality. */
export function speechStyle(personality: { tone?: string; firstPerson?: string } | null, lang?: string): string {
  const tone = personality?.tone?.replace(/[\r\n"']/g, " ").trim().slice(0, 60);
  // A non-ASCII (e.g. Japanese) tone hint makes the model switch languages, so only use it verbatim for Japanese output.
  const useTone = tone && (lang === "ja" || /^[\x20-\x7e]+$/.test(tone));
  const base = useTone ? `speak in a ${tone} tone, like a trusted sibling` : "speak warmly, like a trusted sibling";
  return isLang(lang) ? `${base}; speak only in ${LANG_NAMES[lang]}` : base;
}

export interface SpeechRequest {
  text: string;
  lang?: string;
  voiceName: string;
  style?: string;
}
export interface SpeechResult {
  audio: Uint8Array;
  mime: string;
}
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface InteractionContent {
  type?: string;
  data?: string;
  mime_type?: string;
}
interface InteractionStep {
  type?: string;
  content?: InteractionContent[];
}

/**
 * Gemini Interactions API: POST /v1beta/interactions with a speech_metadata
 * annotation. Unary calls return a complete WAV (audio/wav) in the last
 * `steps[].content[type=audio].data` (base64).
 */
export async function synthesizeSpeech(
  { text, lang, voiceName, style }: SpeechRequest,
  fetchFn: FetchLike = fetch,
  env: TtsEnv | null = ttsEnv(),
): Promise<SpeechResult> {
  if (!env) throw new TtsNotConfiguredError();
  const res = await fetchFn(`${env.baseUrl}/v1beta/interactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.apiKey },
    body: JSON.stringify({
      model: env.model,
      input: [
        {
          type: "user_input",
          content: [
            { type: "text", text, annotations: [{ type: "speech_metadata", style: style ?? "natural" }] },
          ],
        },
      ],
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [
          { voice: voiceName, ...(isLang(lang) ? { language: LANG_LOCALES[lang] } : {}) },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`TTS request failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500));
  const body = (await res.json()) as { steps?: InteractionStep[] };
  const steps = body.steps ?? [];
  const outputs = steps.some((s) => s.type === "model_output") ? steps.filter((s) => s.type === "model_output") : steps;
  const audio = outputs
    .flatMap((s) => s.content ?? [])
    .reverse()
    .find((c) => c.type === "audio" && typeof c.data === "string" && c.data.length > 0);
  if (!audio?.data) throw new Error("TTS returned no audio");
  return { audio: Buffer.from(audio.data, "base64"), mime: audio.mime_type ?? "audio/wav" };
}
