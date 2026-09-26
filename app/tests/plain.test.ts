import { describe, expect, it } from "vitest";
import { birthStageProgress, birthStageText, intentPlainText, requestStatusText } from "../src/lib/plain";

describe("intentPlainText", () => {
  it("describes send_usdc in plain words", () => {
    expect(intentPlainText({ type: "send_usdc", to: "hana.otomo.eth", amountUsdc: 5 })).toBe(
      "hana.otomo.eth に 5 ドルを送っていい？",
    );
  });
  it("describes request_friend with the reward", () => {
    expect(intentPlainText({ type: "request_friend", friend: "taro.otomo.eth", task: "会議メモ", rewardUsdc: 2 })).toBe(
      "taro.otomo.eth に「会議メモ」を頼んでいい？（お礼 2 ドル）",
    );
  });
  it("describes grow_savings and private_task", () => {
    expect(intentPlainText({ type: "grow_savings", amountUsdc: 100 })).toBe("100 ドルを増やす運用を始めていい？");
    expect(intentPlainText({ type: "private_task", summary: "日記を書いて" })).toBe("ひみつのお願い: 日記を書いて");
  });
  it("falls back for unknown intents", () => {
    expect(intentPlainText({ type: "mystery" })).toBe("このお願いを実行していい？");
  });
});

describe("birthStage mapping", () => {
  it("maps each pipeline stage to plain text and monotonic progress", () => {
    expect(birthStageText("preparing")).toBe("性格を考えています…");
    expect(birthStageText("funding")).toBe("おうちを準備しています…");
    expect(birthStageText("deploying_resolver")).toBe("おうちを準備しています…");
    expect(birthStageText("registering_name")).toBe("名前を登録しています…");
    expect(birthStageText("ready")).toBe("もうすぐ会えます！");
    expect(birthStageProgress("preparing")).toBeLessThan(birthStageProgress("funding"));
    expect(birthStageProgress("funding")).toBeLessThan(birthStageProgress("registering_name"));
    expect(birthStageProgress("ready")).toBe(1);
  });
  it("has a safe fallback", () => {
    expect(birthStageText("unknown_stage")).toBe("準備しています…");
    expect(birthStageProgress("unknown_stage")).toBe(0.1);
  });
});

describe("requestStatusText", () => {
  it("translates statuses to plain words", () => {
    expect(requestStatusText("open")).toBe("返事待ち");
    expect(requestStatusText("accepted")).toBe("作業中");
    expect(requestStatusText("working")).toBe("作業中");
    expect(requestStatusText("delivered")).toBe("届きました");
    expect(requestStatusText("done")).toBe("完了");
    expect(requestStatusText("odd")).toBe("odd");
  });
});
