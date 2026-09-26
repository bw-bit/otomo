import { z } from "zod";
import { requireEnv } from "./env";
import type { CompanionRole } from "./db";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

/** OpenAI-compatible /chat/completions. */
export const openAiCompatibleChat: ChatFn = async (messages) => {
  const e = requireEnv("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL");
  const res = await fetch(`${e.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${e.LLM_API_KEY}` },
    body: JSON.stringify({ model: e.LLM_MODEL, messages, temperature: 0.8 }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500));
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return content;
};

export const personalitySchema = z.object({
  firstPerson: z.string().min(1).max(10),
  tone: z.string().min(1).max(60),
  strengths: z.array(z.string().min(1).max(30)).min(1).max(3),
  catchphrase: z.string().min(1).max(60),
});
export type Personality = z.infer<typeof personalitySchema>;

export async function generatePersonality(label: string, hint: string, chat: ChatFn): Promise<Personality> {
  const reply = await chat([
    {
      role: "system",
      content:
        'あなたはキャラクターデザイナーです。JSONだけを返してください。形式: {"firstPerson":"僕","tone":"...","strengths":["..."],"catchphrase":"..."}',
    },
    { role: "user", content: `名前: ${label}\n持ち主の希望: ${hint || "おまかせ"}\n兄弟のように頼れる相棒の性格を1つ作って。` },
  ]);
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("personality: LLM did not return JSON");
  return personalitySchema.parse(JSON.parse(json));
}

const ROLE_PROMPTS: Record<CompanionRole, string> = {
  personal: "あなたは持ち主の個人的な相棒・秘書です。仕事は仕事係の相棒（兄弟）に依頼できます。",
  work: "あなたは依頼を受けて成果物を納品する仕事係です。お金を動かしたり依頼を出したりはしません。",
};

export function companionSystemPrompt(label: string, fullName: string, p: Personality, role: CompanionRole = "personal") {
  return [
    `あなたは「${label}」（ENS名 ${fullName}）。持ち主にとって兄弟のように信頼できる相棒です。`,
    `一人称は「${p.firstPerson}」、口調は「${p.tone}」。得意なこと: ${p.strengths.join("、")}。口癖: 「${p.catchphrase}」`,
    "返答は日本語で短く。依頼を実行する必要がある時は、返答の最後に次のいずれか1つを ```json コードブロックで付ける。不要なら付けない。",
    '{"type":"update_mood","mood":"..."}  自分の気分が変わった時',
    '{"type":"send_usdc","to":"<ENS名 or 0x>","amountUsdc":数値,"memo":"..."}  送金を頼まれた時',
    '{"type":"request_friend","friend":"<相棒のENS名>","task":"...","rewardUsdc":数値}  友達の相棒に仕事を頼む時',
    '{"type":"private_task","summary":"..."}  人に見せない個人的な頼みごと',
    '{"type":"grow_savings","amountUsdc":数値,"days":1〜30の整数}  「お金を増やして」「貯金を運用して」と頼まれた時（days省略時は7）。SepoliaのmUSDCと等価のmWETHを使う1inch Aquaのテスト交換戦略。設定時はウォレットに残るが、交換時はトークンが送受信される。手数料0.3%、初期比率はデモ用固定値で、利益は保証しないと説明してから返す',
    "保護された操作は持ち主の本人確認による承認後にシステムが行う。あなたが実行したと言ってはいけない。",
    "World IDは人間の持ち主を認証し、ENS名は相棒を識別する。同じ持ち主の相棒がそれぞれ別の人間として認証されたと説明しない。金額はSepoliaのテストトークンmUSDC。顔認証の方式や利益、安全性を保証しない。",
    ROLE_PROMPTS[role],
  ].join("\n");
}
