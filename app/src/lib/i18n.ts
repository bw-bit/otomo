// Client-safe UI strings for the companion page. No server imports allowed here.

export type Lang = "ja" | "en" | "zh" | "ko";
export const SUPPORTED_LANGS = ["ja", "en", "zh", "ko"] as const satisfies readonly Lang[];

export const LANG_LABELS: Record<Lang, string> = {
  ja: "日本語",
  en: "English",
  zh: "中文",
  ko: "한국어",
};

/** Used as the `target` prompt hint and for locale-aware date formatting. */
export const LANG_NAMES: Record<Lang, string> = {
  ja: "Japanese",
  en: "English",
  zh: "Simplified Chinese",
  ko: "Korean",
};

export const LANG_LOCALES: Record<Lang, string> = {
  ja: "ja-JP",
  en: "en-US",
  zh: "zh-CN",
  ko: "ko-KR",
};

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

/** ja is the source of truth; other languages may be added later, so they are optional. */
export type UiEntry = { ja: string } & Partial<Record<Exclude<Lang, "ja">, string>>;

/** `{name}` placeholders are filled from `vars`. */
export function pickEntry(entry: UiEntry | undefined, lang: Lang, vars?: Record<string, string | number>): string {
  let s = entry?.[lang] ?? entry?.ja ?? "";
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const UI_STRINGS = {
  loading: { ja: "読み込み中…", en: "Loading…", zh: "加载中…", ko: "불러오는 중…" },
  moodLabel: { ja: "ENS から読んだ気分", en: "Mood read from ENS", zh: "从 ENS 读取的心情", ko: "ENS에서 읽은 기분" },
  resolveTo: { ja: "解決先", en: "Resolves to", zh: "解析到", ko: "리졸브 대상" },
  unset: { ja: "（未設定）", en: "(unset)", zh: "（未设置）", ko: "（미설정）" },
  unresolved: { ja: "未解決", en: "unresolved", zh: "未解析", ko: "미해결" },
  approved: { ja: "承認しました。依頼を実行しました。", en: "Approved — the request was executed.", zh: "已批准，请求已执行。", ko: "승인했습니다. 요청을 실행했습니다." },
  rejected: { ja: "実行しませんでした", en: "Not executed", zh: "未执行", ko: "실행하지 않았습니다" },
  notBound: {
    ja: "まだ契りを結んでいません。重要な依頼はこの本人確認に紐付きます。",
    en: "You have not bonded yet. Important requests are tied to this identity check.",
    zh: "还没有缔结契约。重要请求将绑定到此身份验证。",
    ko: "아직 계약을 맺지 않았습니다. 중요한 요청은 이 본인 확인에 연결됩니다.",
  },
  bind: { ja: "World ID で契りを結ぶ", en: "Bond with World ID", zh: "用 World ID 缔结契约", ko: "World ID로 계약 맺기" },
  placeholder: { ja: "相棒にお願いする", en: "Ask your companion", zh: "向搭档拜托", ko: "파트너에게 부탁하기" },
  send: { ja: "送る", en: "Send", zh: "发送", ko: "보내기" },
  approveFace: { ja: "顔で承認する", en: "Approve with your face", zh: "刷脸批准", ko: "얼굴로 승인하기" },
  savings: { ja: "貯金の運用（1inch Aqua）", en: "Savings management (1inch Aqua)", zh: "储蓄理财（1inch Aqua）", ko: "저금 운용（1inch Aqua）" },
  strategyAmounts: {
    ja: "{usdc} USDC + {weth} mWETH",
    en: "{usdc} USDC + {weth} mWETH",
    zh: "{usdc} USDC + {weth} mWETH",
    ko: "{usdc} USDC + {weth} mWETH",
  },
  strategyDesc: {
    ja: "の AMM 戦略（手数料 0.3%・期限 {deadline}）",
    en: "AMM strategy (0.3% fee, deadline {deadline})",
    zh: "的 AMM 策略（手续费 0.3%，期限 {deadline}）",
    ko: "의 AMM 전략（수수료 0.3%, 기한 {deadline}）",
  },
  walletBalance: { ja: "ウォレット残高", en: "Wallet balance", zh: "钱包余额", ko: "지갑 잔액" },
  aquaHolds: { ja: "Aqua が預かっている額（仮想）", en: "Held by Aqua (virtual)", zh: "Aqua 托管金额（虚拟）", ko: "Aqua가 맡은 금액（가상）" },
  nonCustodial: {
    ja: "お金はウォレットから出ていません。Aqua は残高を記録するだけで、動くのはスワップ成立の瞬間だけです。",
    en: "Funds never left your wallet. Aqua only records balances; tokens move the moment a swap settles.",
    zh: "资金并未离开钱包。Aqua 只记录余额，仅在兑换成交时才划转。",
    ko: "자금은 지갑에서 나가지 않았습니다. Aqua는 잔액만 기록하며, 스왑이 성립하는 순간에만 이동합니다.",
  },
  ship: { ja: "承認して運用を始める（MetaMask）", en: "Approve & start (MetaMask)", zh: "批准并开始理财（MetaMask）", ko: "승인하고 운용 시작（MetaMask）" },
  connectWallet: { ja: "ウォレットを接続して運用を始める", en: "Connect wallet to start", zh: "连接钱包开始理财", ko: "지갑을 연결해 운용 시작" },
  walletWait: { ja: "ウォレットの確認待ち…", en: "Waiting for wallet…", zh: "等待钱包确认…", ko: "지갑 확인 대기 중…" },
  demoSwap: { ja: "相棒に取引を受けさせる（デモ）", en: "Let it take a trade (demo)", zh: "让搭档接单（演示）", ko: "거래를 받게 하기（데모）" },
  dock: { ja: "運用をやめる（dock）", en: "Stop (dock)", zh: "停止理财（dock）", ko: "운용 중단（dock）" },
  closed: { ja: "運用終了済み", en: "Closed", zh: "已结束", ko: "운용 종료됨" },
  inbox: { ja: "友達の相棒からの依頼", en: "Requests from friends' companions", zh: "来自朋友搭档的请求", ko: "친구 파트너의 요청" },
  inboxItem: {
    ja: "{from} より: {task}（報酬 {reward} USDC）— {status}",
    en: "From {from}: {task} (reward {reward} USDC) — {status}",
    zh: "来自 {from}：{task}（报酬 {reward} USDC）— {status}",
    ko: "{from}의 요청: {task}（보상 {reward} USDC）— {status}",
  },
  accept: { ja: "引き受ける", en: "Accept", zh: "接受", ko: "수락" },
  done: { ja: "完了した", en: "Done", zh: "已完成", ko: "완료함" },
  allowanceInfo: {
    ja: "相棒に預けている上限: {amount} USDC（オンチェーンの approve。相棒はこれ以上動かせません）",
    en: "Allowance for your companion: {amount} USDC (on-chain approve — it cannot move more)",
    zh: "已授权搭档的额度：{amount} USDC（链上 approve，搭档无法动用更多）",
    ko: "파트너에게 맡긴 한도: {amount} USDC（온체인 approve — 이 이상은 사용할 수 없습니다）",
  },
  setCap: { ja: "上限を設定", en: "Set cap", zh: "设置额度", ko: "한도 설정" },
  mint: { ja: "テスト用 mUSDC を受け取る（Sepolia）", en: "Get test mUSDC (Sepolia)", zh: "领取测试 mUSDC（Sepolia）", ko: "테스트 mUSDC 받기（Sepolia）" },
  language: { ja: "表示言語", en: "Language", zh: "语言", ko: "언어" },
  autoSpeak: { ja: "新しい返答を自動で読み上げる", en: "Read new replies aloud", zh: "自动朗读新回复", ko: "새 답변 자동 읽기" },
  speak: { ja: "読み上げ", en: "Read aloud", zh: "朗读", ko: "읽기" },
  cannot: { ja: "できません", en: "I can't", zh: "无法执行", ko: "할 수 없습니다" },
  noteMood: { ja: "気分を ENS に書き込みました", en: "Mood written to ENS", zh: "心情已写入 ENS", ko: "기분을 ENS에 기록했습니다" },
  noteApproval: { ja: "顔での承認が必要な依頼です（5分以内）", en: "Needs face approval (within 5 min)", zh: "此请求需要刷脸批准（5 分钟内）", ko: "얼굴 승인이 필요합니다（5분 이내）" },
  noteCap: { ja: "相棒に預ける上限を更新しました（反映まで数秒）", en: "Allowance updated (takes a few seconds)", zh: "额度已更新（几秒后生效）", ko: "한도를 업데이트했습니다（반영까지 몇 초）" },
  noteMint: { ja: "テスト用 mUSDC 1000 を受け取りました（反映まで数秒）", en: "Received 1000 test mUSDC (takes a few seconds)", zh: "已领取 1000 测试 mUSDC（几秒后生效）", ko: "테스트 mUSDC 1000을 받았습니다（반영까지 몇 초）" },
  noteShipped: { ja: "運用を開始しました（資金はウォレットに残ったままです）", en: "Started — funds stay in your wallet", zh: "已开始理财（资金仍在钱包中）", ko: "운용을 시작했습니다（자금은 지갑에 남아 있습니다）" },
  noteDemo: {
    ja: "相棒が第三者としてスワップしました（tx: {tx}）",
    en: "Your companion swapped as a third party (tx: {tx})",
    zh: "搭档已作为第三方完成兑换（tx: {tx}）",
    ko: "파트너가 제3자로서 스왑했습니다（tx: {tx}）",
  },
  noteDocked: { ja: "運用を終了しました", en: "Strategy closed", zh: "已结束理财", ko: "운용을 종료했습니다" },
  speakFail: { ja: "読み上げに失敗しました", en: "Couldn't read it aloud", zh: "朗读失败", ko: "읽기에 실패했습니다" },
  intentSend: { ja: "送金", en: "Transfer", zh: "转账", ko: "송금" },
  intentFriend: { ja: "友達への依頼", en: "Request to a friend", zh: "给朋友的请求", ko: "친구에게 요청" },
  intentPrivate: { ja: "個人的な頼みごと", en: "Private request", zh: "私人请求", ko: "개인적인 부탁" },
  intentGrow: { ja: "貯金の運用", en: "Savings", zh: "储蓄理财", ko: "저금 운용" },
} satisfies Record<string, UiEntry>;

export type UiKey = keyof typeof UI_STRINGS;

export function t(key: UiKey, lang: Lang, vars?: Record<string, string | number>): string {
  return pickEntry(UI_STRINGS[key], lang, vars);
}
