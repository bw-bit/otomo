# Otomo 引き継ぎ（Codex向け）— 2026-09-26 時点

## プロジェクト概要

- リポジトリ: `/Users/R/hackathon/otomo`（GitHub: bw-bit/otomo, branch `main`）
- Next.js アプリ: `app/`（Next.js 16.3.5, viem, @worldcoin/idkit 4.2.3, @google/genai）
- コントラクト: `contracts/`（Foundry、1inch Aqua + SwapVM）
- 本番URL: `https://otomo-world-id.vercel.app`（Vercel プロジェクト `loveworks7-gmailcoms-projects/otomo`、CLIデプロイ方式）
- ETHGlobal Tokyo 2026 提出用。締切は 9/27 09:00 JST。

## すでに完了しているもの

- Sepolia に全デプロイ済み:
  - `otomo.eth` 登録済み（owner = operator `0x2F1758E72795DBe67A61e2cf6f4E86D68dC265B3`）
  - UserRegistry `0x1b1519F28c5b386fB3B9fF2474A01C62099Ba1e5`（otomo.eth の subregistry）
  - Aqua `0x6B7110A6035beEC23493242891fD490Fc1e44167`、Router `0xA7d3aBC48733d4692F7408f9453aCEEdF49ae0C1`、OrderBuilder `0x13D3406Ab51829E22463DFab6b754618f65Afa9E`、mWETH `0xf7A9C97d0DC45A13cd7e3E17406fA61CA72d66FA`（`contracts/deployments/sepolia.json`）
- ENS 経路の実チェーン検証済み: `smoketest.otomo.eth` が `app/scripts/smoke-ens.ts`（未コミット・手元のみ）で登録・解決・mood読取まで成功
- テスト 73 件全パス、tsc clean、本番ビルド成功
- Vercel Production env 設定済み: `LLM_*`, `TTS_*`, `SEPOLIA_RPC_URL`, `COMPANION_WALLET_KEY`, `ENS_USER_REGISTRY`, `AQUA_*`, `MOCK_WETH_ADDRESS`, `WORLD_*`, `AGENT_OIDC_*` 等
- operator 残高 ~0.12 ETH、agent に 0.02 ETH 送金済み
- コミット push 済み最新: `e104072`

## 現在のブロッカー（最重要）

**World ID の誕生フローがブラウザで失敗する。**

- 症状: `https://otomo-world-id.vercel.app` で名前入力→「顔で誕生させる」→ IDKit ウィジェットが `Something went wrong / We couldn't complete your request` を出す。World App 側まで行かずブラウザ側エラー。`/api/birth` には一度も到達しない（Vercelログ確認済み）。
- 検証済み事実:
  - `/api/world/rp-signature` は本番で 200、`rp_id=rp_35ff4cfb1b8f2769`・有効な sig・誕生チャレンジ cookie を返す
  - Node で `IDKit.request({...}).constraints(any(...))` を実 rp_context で実行すると**リクエスト作成・bridge登録・ポーリング（waiting_for_connection）まで全て成功**する（WASM 初期化は file:// fetch をパッチして確認）
  - 本番バンドルは `environment:"production"`、`allow_legacy_proofs:!0`、constraints `any(selfie,passport,mnc,proof_of_human)` を含む
  - v4 の action はハッシュ形 `0x00b3ad4f6105123548927b72800e30fd398fe0c73063a4ee2b369852b4dc7cf2`（= `otomo-birth`）で返る可能性があり両形受理済み
- ユーザー報告: Selfie Check は World App で使えない、パスポートは登録済みのはず
- **最有力仮説**: `WORLD_RP_SIGNING_KEY` が Developer Portal 発行の `signing_key` と不一致（自分で生成した鍵が入っている可能性）。次点: Portal にアクション `otomo-birth` 未登録 / app が staging 側にのみ存在

## 次にやること（順番）

1. ユーザーに確認: developer.world.org → アプリ `app_690ebac379aa31482fcbbb8f418ef6fc` → World ID 4.0/RP 設定で `rp_id`・`signing_key` を確認。`WORLD_RP_SIGNING_KEY` をポータル発行値に更新（Vercel + `app/.env.local`）→ `npx vercel --prod` で再デプロイ。アクション `otomo-birth` がなければポータルで作成
2. ユーザーに再試行してもらい、失敗時はモーダルを閉じて `code:` を報告してもらう（page.tsx は `setDebug(true)` + onError で code/report を表示・console に出力済み）
3. 誕生が通ったら E2E: 契り（OIDC）→ チャット → 🎤 Live → TTS → 依頼/納品/支払い → Aqua ship/swap/dock → 信頼度公開
4. デモ動画収録: `docs/demo-script.md` 台本どおり一発通し（実声ナレーション、TTS音声はミュート、720p+、2〜4分）

## 環境・ツールの注意

- **git が Xcode ライセンス未同意で通常パスでは動かない**。使えるのは:
  `export GIT_EXEC_PATH='/Applications/GitHub Desktop.app/Contents/Resources/app/git/libexec/git-core' && export PATH="$GIT_EXEC_PATH:/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin:$PATH"`
- **vercel CLI はグローバルに無い**。`npx vercel ...` を使う（`npx vercel --prod` でデプロイ、`npx vercel env add/rm/ls`、`npx vercel logs otomo-world-id.vercel.app`）
- **forge は PATH 外**。`export PATH="$HOME/.foundry/bin:$PATH"` を前置き
- `.env.local` の値（秘密鍵等）は出力に出さない
- ローカル検証: `cd app && npm test`（vitest）、`npx tsc --noEmit`、`npm run build`
- ローカルで World ID なしのオンチェーン確認: `node --env-file=.env.local --experimental-strip-types scripts/smoke-ens.ts`（`smoketest.otomo.eth` は登録済みなので別ラベルに変えて実行）
- `server-only` を import するモジュールを素の node で動かすには `--conditions=react-server` が必要（ただし拡張子なし import は解決しないので注意）

## 関連ドキュメント

- `docs/research.md` — 賞要件リサーチ
- `docs/world-debrief.md` — World 審査用振り返り（credential 選択理由等）
- `docs/walletless-reputation.md` — ウォレットレス構成と信頼度の説明
- `docs/demo-script.md` — デモ動画台本
- `docs/SPEC-1-app.md` / `docs/SPEC-2-aqua.md` — 仕様
