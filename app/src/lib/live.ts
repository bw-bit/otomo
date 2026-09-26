import "server-only";
import { Modality, type LiveConnectConfig } from "@google/genai";
import { companionSystemPrompt, type Personality } from "./llm";
import { LANG_NAMES, type Lang } from "./i18n";

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

export interface LiveEnv {
  apiKey: string;
  model: string;
}

/** Voice conversation is opt-in: it reuses the shared Gemini LLM_API_KEY. */
export function liveEnv(env: Partial<NodeJS.ProcessEnv> = process.env): LiveEnv | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL };
}

/** Spoken conversation prompt: same persona, no intent JSON (voice must never emit it). */
export function liveSystemPrompt(label: string, fullName: string, p: Personality | null, lang: Lang = "en"): string {
  const persona = p
    ? companionSystemPrompt(label, fullName, p).split("\n").slice(0, 2).join("\n")
    : `あなたは「${label}」（ENS名 ${fullName}）。持ち主にとって兄弟のように信頼できる相棒です。`;
  return [
    persona,
    "これは音声会話です。話し言葉で、短く自然に答えてください。JSON・箇条書き・マークダウンは使わないでください。",
    `Speak in ${LANG_NAMES[lang]}. This is the user's selected language. Preserve your personality while using that language.`,
  ].join("\n");
}

export function liveConnectConfig(systemInstruction: string, voiceName: string): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export type TokenIssuer = (apiKey: string, model: string, config: LiveConnectConfig) => Promise<string>;

/**
 * Mints a short-lived ephemeral token so the browser can open a Live API
 * WebSocket without ever seeing the real API key. The token is single-use,
 * expires for new sessions in 60s, and locks the model/voice/personality.
 */
export const issueLiveToken: TokenIssuer = async (apiKey, model, config) => {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      liveConnectConstraints: { model, config },
    },
  });
  if (!token.name) throw new Error("Gemini did not return an ephemeral token");
  return token.name;
};
