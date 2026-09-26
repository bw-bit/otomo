import { describe, expect, it } from "vitest";
import { birthStageProgress, birthStageText, intentPlainText, requestStatusText } from "../src/lib/plain";

describe("intentPlainText", () => {
  it("describes send_usdc in plain words", () => {
    expect(intentPlainText({ type: "send_usdc", to: "hana.otomo.eth", amountUsdc: 5 }, "ja")).toBe(
      "hana.otomo.eth に 5 mUSDC（テストトークン）を送っていい？",
    );
  });
  it("describes request_friend with the reward", () => {
    expect(intentPlainText({ type: "request_friend", friend: "taro.otomo.eth", task: "会議メモ", rewardUsdc: 2 }, "ja")).toBe(
      "taro.otomo.eth に「会議メモ」を頼んでいい？（お礼 2 mUSDC・テストトークン）",
    );
  });
  it("describes grow_savings and private_task", () => {
    expect(intentPlainText({ type: "grow_savings", amountUsdc: 100 }, "ja")).toBe("100 mUSDCでAquaのテスト戦略を準備していい？");
    expect(intentPlainText({ type: "private_task", summary: "日記を書いて" }, "ja")).toBe("ひみつのお願い: 日記を書いて");
  });
  it("falls back for unknown intents", () => {
    expect(intentPlainText({ type: "mystery" }, "ja")).toBe("このお願いを実行していい？");
    expect(intentPlainText({ type: "send_usdc", to: "sora.otomo.eth", amountUsdc: 5 }, "en")).toBe("Send 5 mUSDC (test tokens) to sora.otomo.eth?");
    expect(intentPlainText({ type: "send_usdc", to: "sora.otomo.eth", amountUsdc: 5 }, "zh")).toBe("要向 sora.otomo.eth 转账 5 mUSDC（测试代币）吗？");
    expect(intentPlainText({ type: "send_usdc", to: "sora.otomo.eth", amountUsdc: 5 }, "ko")).toBe("sora.otomo.eth에게 5 mUSDC(테스트 토큰)를 보낼까요?");
    expect(intentPlainText({ type: "request_friend", friend: "hana.otomo.eth", task: "会議メモ", rewardUsdc: 2 }, "en")).toBe(
      "Ask hana.otomo.eth to do “会議メモ” for 2 mUSDC (test tokens)?",
    );
  });
});

describe("birthStage mapping", () => {
  it("maps each pipeline stage to plain text and monotonic progress", () => {
    expect(birthStageText("preparing", "ja")).toBe("性格を考えています…");
    expect(birthStageText("funding", "ja")).toBe("おうちを準備しています…");
    expect(birthStageText("deploying_resolver", "ja")).toBe("おうちを準備しています…");
    expect(birthStageText("registering_name", "ja")).toBe("名前を登録しています…");
    expect(birthStageText("ready", "ja")).toBe("もうすぐ会えます！");
    expect(birthStageText("ready", "en")).toBe("You'll meet soon!");
    expect(birthStageText("needs_review", "ko")).toBe("등록을 확인하고 있어요…");
    expect(birthStageProgress("preparing")).toBeLessThan(birthStageProgress("funding"));
    expect(birthStageProgress("funding")).toBeLessThan(birthStageProgress("registering_name"));
    expect(birthStageProgress("ready")).toBe(1);
  });
  it("has a safe fallback", () => {
    expect(birthStageText("unknown_stage", "ja")).toBe("準備しています…");
    expect(birthStageProgress("unknown_stage")).toBe(0.1);
  });
});

describe("requestStatusText", () => {
  it("translates statuses to plain words", () => {
    expect(requestStatusText("open", "ja")).toBe("返事待ち");
    expect(requestStatusText("accepted", "ja")).toBe("作業中");
    expect(requestStatusText("working", "ja")).toBe("作業中");
    expect(requestStatusText("delivered", "ja")).toBe("届きました");
    expect(requestStatusText("done", "ja")).toBe("検収済み");
    expect(requestStatusText("open", "en")).toBe("Awaiting reply");
    expect(requestStatusText("delivered", "zh")).toBe("已交付");
    expect(requestStatusText("done", "ko")).toBe("검수 완료");
    expect(requestStatusText("odd", "en")).toBe("odd");
  });
});
