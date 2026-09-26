// Plain-language formatting for non-technical users. Safe for server and client imports.

import { t, type Lang } from "@/lib/i18n";

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
  operation?: string;
}

/** One friendly sentence describing what a pending action will do. */
export function intentPlainText(intent: PendingIntent, lang: Lang): string {
  switch (intent.type) {
    case "send_usdc":
      return t("plainSend", lang, {
        to: intent.to ?? t("unknownRecipient", lang),
        amount: intent.amountUsdc ?? "?",
      });
    case "request_friend":
      return t("plainFriendRequest", lang, {
        friend: intent.friend ?? t("friendFallback", lang),
        task: intent.task ?? "",
        reward: intent.rewardUsdc ?? 0,
      });
    case "grow_savings":
      return t("plainSavings", lang, { amount: intent.amountUsdc ?? "?" });
    case "private_task":
      return t("plainPrivate", lang, { summary: intent.summary ?? "" });
    case "strategy_operation": {
      const labels = {
        ja: { ship: "1inch Aquaの交換受付を開始していい？", demo_swap: "別のデモエージェントとテストトークンを交換していい？", dock: "1inch Aquaの交換受付を停止していい？" },
        en: { ship: "Start this 1inch Aqua strategy?", demo_swap: "Exchange test tokens with the demo agent?", dock: "Stop this 1inch Aqua strategy?" },
        zh: { ship: "开始此1inch Aqua策略？", demo_swap: "与演示代理交换测试代币？", dock: "停止此1inch Aqua策略？" },
        ko: { ship: "1inch Aqua 전략을 시작할까요?", demo_swap: "데모 에이전트와 테스트 토큰을 교환할까요?", dock: "1inch Aqua 전략을 중지할까요?" },
      };
      return labels[lang][intent.operation as "ship" | "dock" | "demo_swap"] ?? t("plainUnknown",lang);
    }
    case "publish_reputation":
      return { ja: "相棒の活動実績をENSで公開していい？", en: "Publish this companion's activity to ENS?", zh: "将搭档活动公开到ENS？", ko: "파트너 활동을 ENS에 공개할까요?" }[lang];
    case "update_mood":
      return t("plainMood", lang);
    default:
      return t("plainUnknown", lang);
  }
}

const STAGE_KEY = {
  preparing: "birthStagePreparing",
  funding: "birthStageFunding",
  deploying_resolver: "birthStageFunding",
  registering_name: "birthStageRegistering",
  ready: "birthStageReady",
  needs_review: "birthStageReview",
} as const;

const STAGE_PROGRESS: Record<string, number> = {
  preparing: 0.15,
  funding: 0.4,
  deploying_resolver: 0.55,
  registering_name: 0.8,
  ready: 1,
  needs_review: 0.9,
};

export const birthStageText = (stage: string, lang: Lang) => t(STAGE_KEY[stage as keyof typeof STAGE_KEY] ?? "birthStageFallback", lang);
export const birthStageProgress = (stage: string) => STAGE_PROGRESS[stage] ?? 0.1;

/** Friend-request status in words. */
export function requestStatusText(status: string, lang: Lang): string {
  switch (status) {
    case "open":
      return t("requestStatusOpen", lang);
    case "accepted":
    case "working":
      return t("requestStatusWorking", lang);
    case "delivered":
      return t("requestStatusDelivered", lang);
    case "done":
      return t("requestStatusDone", lang);
    default:
      return status;
  }
}
