# SPEC-2: 相棒の「お金を増やす」— 1inch Aqua + SwapVM（優先度2）

前提資料: docs/research.md の 1inch 節。担当ディレクトリは `/Users/R/hackathon/otomo/contracts` のみ（`app/` は触らない）。コミットはしない（lead が行う）。

## 目的
ユーザーの資金をウォレットに置いたまま、相棒が提案した AMM 戦略を Aqua に `ship` し、第三者のスワップで手数料が入ることを、ローカルチェーン上の実際のトークン移動で示す。

## 構成
- Foundry プロジェクト。`forge` が無ければ公式手順（foundryup）で導入する。
- 依存: 公式リポジトリ `1inch/aqua` と `1inch/swap-vm` を `forge install` でタグ／コミット固定。契約は改変しない（改変が必要になったら止めて報告）。
- 使う契約: `Aqua`、`AquaSwapVMRouter`（Aqua 用 opcode セット）。テスト用 ERC20 を2つ（mUSDC 6桁, mWETH 18桁）。

## 戦略（相棒が提案する形）
Aqua モードの SwapVM 注文（`useAquaInsteadOfSignature: true`、`DynamicBalances` なし）:
```
program = Deadline(期限) + FeeFlatIn(0.003e7) + XYCSwap()
```
命令の順序は swap-vm の docs/PROGRAMS.md の規則に従い、違反があればそちらを優先して理由を報告する。

## 成果物
1. `script/Demo.s.sol`（anvil 上で実行）:
   - 契約を deploy、maker（ユーザー）と taker にトークンを mint。
   - maker: Aqua へ approve → `aqua.ship(router, abi.encode(order), [mUSDC, mWETH], [1000e6, 0.5e18])`。
   - taker: `router.quote` で見積もり → `swap`（exact in）。
   - 各ステップ後に maker/taker のウォレット残高と Aqua 仮想残高をログ出力。maker の資金が ship 後もウォレットに残っていること、swap 後に手数料分だけ maker 側が増えていることが読み取れること。
   - maker: `dock` で戦略を終了。
2. `test/OtomoStrategy.t.sol`: 上の流れを assert（残高の増減、期限切れで swap が revert、dock 後に swap 不可）。
3. `script/demo.sh`: anvil 起動 → Demo 実行 → 終了、を1コマンドで。
4. `README.md`: 何を示すデモか、実行方法、使った公式契約とコミット。

## 検証
`forge build`、`forge test -vv` が通ること。`script/demo.sh` の出力ログを `contracts/evidence/demo.log` に保存。

## 後で検討（今はやらない）
- アプリ（Next.js）からの呼び出しと、World 承認ゲートとの接続。
- カスタム opcode（例: 相棒の信頼度で手数料を変える）。
