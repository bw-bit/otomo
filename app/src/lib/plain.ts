// Plain-language formatting for non-technical users. Server- and client-safe (no imports).

export interface PendingIntent {
  type?: string;
  to?: string;
  friend?: string;
  task?: string;
  rewardUsdc?: number;
  amountUsdc?: number;
  days?: number;
  summary?: string;
  mood?: string;
}

/** One friendly sentence describing what a pending action will do. */
export function intentPlainText(intent: PendingIntent): string {
  switch (intent.type) {
    case "send_usdc":
      return `${intent.to ?? "（不明な宛先）"} に ${intent.amountUsdc ?? "?"} ドルを送っていい？`;
    case "request_friend":
      return `${intent.friend ?? "お友達"} に「${intent.task ?? ""}」を頼んでいい？（お礼 ${intent.rewardUsdc ?? 0} ドル）`;
    case "grow_savings":
      return `${intent.amountUsdc ?? "?"} ドルを増やす運用を始めていい？`;
    case "private_task":
      return `ひみつのお願い: ${intent.summary ?? ""}`;
    case "update_mood":
      return "気分を更新していい？";
    default:
      return "このお願いを実行していい？";
  }
}

const STAGE_TEXT: Record<string, string> = {
  preparing: "性格を考えています…",
  funding: "おうちを準備しています…",
  deploying_resolver: "おうちを準備しています…",
  registering_name: "名前を登録しています…",
  ready: "もうすぐ会えます！",
  needs_review: "登録を確認しています…",
};

const STAGE_PROGRESS: Record<string, number> = {
  preparing: 0.15,
  funding: 0.4,
  deploying_resolver: 0.55,
  registering_name: 0.8,
  ready: 1,
  needs_review: 0.9,
};

export const birthStageText = (stage: string) => STAGE_TEXT[stage] ?? "準備しています…";
export const birthStageProgress = (stage: string) => STAGE_PROGRESS[stage] ?? 0.1;

/** Friend-request status in words. */
export function requestStatusText(status: string): string {
  switch (status) {
    case "open":
      return "返事待ち";
    case "accepted":
    case "working":
      return "作業中";
    case "delivered":
      return "届きました";
    case "done":
      return "完了";
    default:
      return status;
  }
}
