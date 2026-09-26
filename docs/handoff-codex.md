# Otomo 引き継ぎ（Codex向け）— 2026-09-26 時点

## 更新（2026-09-26 x402サービス実装）

- `/services`、`GET /api/services`、`POST /api/services/{label}/page-report`、セッション限定の受取記録APIをローカル実装。価格0.05 USDC、英日レポート、Bazaar入力/出力スキーマ、決済完了後の結果返却、同一支払い再送保護、日次上限を追加。
- 既定はBase Sepolia。既存Sepolia mUSDC/ENSとはネットワークが異なる。仕事相棒を `X402_SELLER_LABELS` で明示許可し、相棒ウォレットへ直接受け取る。受取先に秘密鍵は不要。
- **今回のx402改修は本番未反映。実送金・Bazaar掲載は未確認。** CDP_API_KEY_ID/SECRETが未設定で、ChromeでもCDPサインイン画面を確認。My Studio `otomo-x402-cdp-setup` に本人ログイン待ちを登録。既存 `.env.local`、本番環境、資金には触れていない。
- 通常136テスト、型チェック、本番ビルド成功。追加の実公開ページ+実LLMテスト1件成功。公式SDKの支払いテストは模擬facilitatorであり、実チェーンE2Eではない。UIは隔離DBの架空provider `demo-helper`、英日/スマートフォンで確認。ローカルpreviewは終了。
- 仕様と有効化手順: `docs/x402-services.md`。証拠: `work/x402/verification.json` と同ディレクトリのログ。別作業中の認証/Aqua/LLM/部屋の既存差分は開始時ハッシュと一致し、上書きしていない。
- 次はCDPログイン確認とキー設定、正しいVercel `otomo` への反映、公開402検証、許可されたテスト決済・着金照合、Bazaar検証。既存Vercel `app` には触れない。

## 更新（2026-09-26 15:02 JST）

- UIとAqua改修をVercel `otomo` 本番へ反映済み。deployment `dpl_FhLkgY7JY1Um7ruybYaGsx8eoyMu` はREADYで `otomo-world-id.vercel.app` aliasを確認。既存の別プロジェクト `app` には触れていない。
- 英語既定・日本語選択の永続化、入力欄内マイク、常時見える読み上げ切替、公開プロフィールの実績カードと公開範囲説明を実装。Three.jsの表情/耳/口/反応を追加。相棒切替で全画面遷移せずモデルを保持し、CDPではhistoryApi遷移のみであることを確認。
- 仕事デモは実LLMとSepolia ENS読み取りを使い、隔離ローカルDBで依頼→受諾→納品→検収。題材はOtomo英日紹介文と3手順、報酬2 mUSDC。別のローカルAnvilテストで実ERC20支払いと二重承認拒否を確認。本番sora/taroの実機承認・報酬送金は今回行っていない。
- AquaはSepoliaでoperatorをmaker、agentをtakerとしてmint/approve/ship/swap/dockの9取引を実送信。0.001 mWETH → 1.662497 mUSDC、手数料0.3%。ship `0x2b8f3af1c6e49054b15f7bc07b4dc9be227e60c3e0f056a1114d48b9b7db7d18`、swap `0x7dbf03bc50574fd23efc4bf2c66721e3bbe519d49f72f4fd3912f20ee0ea5783`、dock `0xa294df6cd6a02627c125a2f266a14612f6f3ec2b3667f7a84a99c292d285368e`。3 receiptを親側で再読確認。sora/taroの資金と本番DB strategyは変更していない。
- Aqua画面は不足テストトークン取得、戦略残高とウォレット残高、固定デモ比率と手数料を表示。`fund_demo` は本人セッションのready戦略のみ、固定Sepolia mock token、不足分のみ、20 mUSDC＋等価mWETH上限、専用相棒ウォレットの署名に限定。ship/swap/dockは従来の本人承認を維持。
- 最終アプリ98 tests、コントラクト7 tests、lint/build成功。opt-inの実LLM仕事1件・Anvil報酬1件も別実行で成功。ライブ音声のマイク接続と本番での実機World承認の往復は未実施。声のオン/オフと選択言語のAPIテストは確認済み。
- 証拠は `work/aqua-demo/parent-verification.json` と呼出元チャットの `outputs/demo-results.md`。誕生/ログインの古い記録や未検証表記は以下の時点の履歴として読む。

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
- この記録の開始時HEADは `bd4e618`。追加相棒と経過表示の修正はローカル `main` にコミットして本番へCLIデプロイ済み。未追跡 `app/scripts/smoke-ens.ts` は既存資産として保持。

## 現在の状態（2026-09-26 13:28 JST）

**実機World App認証で `sora.otomo.eth` が誕生し、認証済みセッションから2体目の `taro.otomo.eth` も誕生した。両方とも本番DBで ready、Sepolia ENSで解決できる。**

- Developer Portal のアプリ `app_690ebac379aa31482fcbbb8f418ef6fc` では、RP ID `rp_35ff4cfb1b8f2769`・署名者・Action `otomo-birth` を照合済み。precheckは本番・Action active・`can_user_verify: yes`。環境変数は変更していない。Portal VerificationのApp URLが `https://docs.world.org/` なのは観測したが、今回は誕生に成功しており、失敗原因とは断定できない。
- `@worldcoin/idkit` と core を4.3.0へ更新し、公式presetのlegacy Orbフォールバックと資格情報選択を導入。IDKitエラーコードをアプリ画面にも表示するようにした。RP署名TTLを誕生チャレンジと同じ600秒にした。旧試行では `world_id_4_not_available`、次の試行では `inclusion_proof_failed` を取得したが、後者の原因は特定できていない。最新試行は成功した。
- 2体目の誕生失敗はIDKitの `nullifier_replayed` で、署名APIは200だが `/api/birth` に到達していなかった。同じActionの一意性証明は再利用できないため、認証済みのsoraセッションから追加する経路を実装した。修正後の本番 `/api/birth` は200。DBではsoraとtaroの本人識別子が一致し、taroは仕事役で `birth_provisioning=ready`。登録tx `0x9285246ecb5f077d5e97c98ff0e0af45e48ad0c181252d5130c2f914e76103dc` のSepolia receiptはsuccess、ENS解決先はtaro専用ウォレット `0x47638b38c6706fb60d710396cdd672a54c9160f0` と一致した。2体目でWorld Appの再認証は行っていない。
- 誕生画面に経過秒数とDBの処理段階（ガス供給、専用リゾルバ、ENS名登録、完了/要確認）を表示する変更を反映した。本番デプロイ `dpl_JCvs8SQPr22bADyVRZuCQgCq8abr` はREADYで `otomo-world-id.vercel.app` alias付き。`/api/birth/status` は未ログインで401。本番のtaro誕生は経過表示のデプロイ前だったため、この表示を使った実誕生の観測は未実施。ローカル `npm run lint` と `npm run build` は成功。
- ユーザーのWorld Appは認証完了を表示。本番ログは `/api/birth` HTTP 200、`[birth] proof check { label: 'sora', ok: true }`。DB `birth_provisioning.status=ready`、登録tx `0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926` のSepolia receiptはsuccess。ENS resolverと相棒ウォレットの解決先はDB値に一致し、`otomo.mood=calm`。
- 相棒ページでチャット送受信を確認。人間パートナーとの紐付けと承認のissuerは `https://sandbox.auth.world.org`（模擬ID）。評判のENS公開tx `0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310` はsuccess、ENS textはDB snapshotに一致。**誕生認証は本番World ID、後続承認はSandbox**として区別する。
- soraの相棒ウォレット残高はmUSDC 100・mWETH 0（Sepolia RPCのbalanceOfとmint tx receiptを確認）、strategy 0件。Live/TTS、Aquaアプリ操作、依頼/納品/支払い、動画収録は未検証。評判公開のpending actionがもう1件あるため、重複承認しない。

実測の詳細: `work/autonomy/otomo-birth-e2e-success.json`（sora）、`work/autonomy/otomo-second-birth-recovery.json`（taro）。デモ台本は `docs/demo-script.md`。soraで使った `otomo-birth` の一意性証明は再送信しない。追加相棒はログイン済みの画面から作成する。現行セッションは24時間で期限切れになり、従来の `/api/login` は同じ一意性証明を要求するため、期限後の再ログインは未解決。

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
