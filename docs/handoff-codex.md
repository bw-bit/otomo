# Otomo 引き継ぎ（Codex向け）— 2026-09-26 時点

## プロジェクト概要

- リポジトリ: `/Users/R/hackathon/otomo`（GitHub: bw-bit/otomo, branch `main`）
- Next.js アプリ: `app/`（Next.js 16.3.5, viem, @worldcoin/idkit 4.3.0, @google/genai）。4.3.0は本番に反映済み。
- コントラクト: `contracts/`（Foundry、1inch Aqua + SwapVM）
- 本番URL: `https://otomo-world-id.vercel.app`（Vercel プロジェクト `loveworks7-gmailcoms-projects/otomo`、CLIデプロイ方式）
- ETHGlobal Tokyo 2026 提出用。締切は 9/27 09:00 JST。

## すでに完了しているもの

（以下は前回ハンドオフの記録。今回の実機誕生・本番DB・Sepolia照合結果は「現在の状態」を参照。）

- Sepolia に全デプロイ済み:
  - `otomo.eth` 登録済み（owner = operator `0x2F1758E72795DBe67A61e2cf6f4E86D68dC265B3`）
  - UserRegistry `0x1b1519F28c5b386fB3B9fF2474A01C62099Ba1e5`（otomo.eth の subregistry）
  - Aqua `0x6B7110A6035beEC23493242891fD490Fc1e44167`、Router `0xA7d3aBC48733d4692F7408f9453aCEEdF49ae0C1`、OrderBuilder `0x13D3406Ab51829E22463DFab6b754618f65Afa9E`、mWETH `0xf7A9C97d0DC45A13cd7e3E17406fA61CA72d66FA`（`contracts/deployments/sepolia.json`）
- ENS 経路の実チェーン検証済み: `smoketest.otomo.eth` が `app/scripts/smoke-ens.ts`（未コミット・手元のみ）で登録・解決・mood読取まで成功
- テスト 73 件全パス、tsc clean、本番ビルド成功
- Vercel Production env 設定済み: `LLM_*`, `TTS_*`, `SEPOLIA_RPC_URL`, `COMPANION_WALLET_KEY`, `ENS_USER_REGISTRY`, `AQUA_*`, `MOCK_WETH_ADDRESS`, `WORLD_*`, `AGENT_OIDC_*` 等
- operator 残高 ~0.12 ETH、agent に 0.02 ETH 送金済み
- 現在のHEAD: `2f03a01`（branch `main`、`origin/main` と一致。未追跡 `app/scripts/smoke-ens.ts` は既存資産として保持）

## 現在の状態（2026-09-26 12:02 JST）

**実機World App認証による誕生は完了。`sora.otomo.eth` が本番DBに作成され、Sepolia ENSで解決できる。ブラウザの読み込みも完了した。**

- Developer Portal のアプリ `app_690ebac379aa31482fcbbb8f418ef6fc` では、RP ID `rp_35ff4cfb1b8f2769`・署名者・Action `otomo-birth` を照合済み。precheckは本番・Action active・`can_user_verify: yes`。環境変数は変更していない。Portal VerificationのApp URLが `https://docs.world.org/` なのは観測したが、今回は誕生に成功しており、失敗原因とは断定できない。
- `@worldcoin/idkit` と core を4.3.0へ更新し、公式presetのlegacy Orbフォールバックと資格情報選択を導入。IDKitエラーコードをアプリ画面にも表示するようにした。RP署名TTLを誕生チャレンジと同じ600秒にした。旧試行では `world_id_4_not_available`、次の試行では `inclusion_proof_failed` を取得したが、後者の原因は特定できていない。最新試行は成功した。
- 本番デプロイ `dpl_5AVbgD5rNXrRHBVfAwP8UqJbbMmg` はREADY、`otomo-world-id.vercel.app` alias付き。`/api/world/rp-signature` のTTL 600を本番で確認。ローカルの最新変更は `npm run lint` と `npm run build` 成功。73テスト成功はその前のIDKit更新時の記録で、最新変更後に全テストは再実行していない。
- ユーザーのWorld Appは認証完了を表示。本番ログは `/api/birth` HTTP 200、`[birth] proof check { label: 'sora', ok: true }`。DB `birth_provisioning.status=ready`、登録tx `0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926` のSepolia receiptはsuccess。ENS resolverと相棒ウォレットの解決先はDB値に一致し、`otomo.mood=calm`。
- 相棒ページでチャット送受信を確認。人間パートナーとの紐付けと承認のissuerは `https://sandbox.auth.world.org`（模擬ID）。評判のENS公開tx `0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310` はsuccess、ENS textはDB snapshotに一致。**誕生認証は本番World ID、後続承認はSandbox**として区別する。
- Aqua用相棒ウォレット残高はmUSDC 0・mWETH 0、strategy 0件。Live/TTS、Aquaアプリ操作、依頼/納品/支払い、動画収録は未検証。評判公開のpending actionがもう1件あるため、重複承認しない。

実測の詳細: `work/autonomy/otomo-birth-e2e-success.json`。デモ台本は `docs/demo-script.md`。誕生済みアカウントで同じ誕生を再実演しない。画面と登録txを使って収録する。

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
