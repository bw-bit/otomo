# Otomo

**English summary:** Otomo ("companion" in Japanese) gives every verified human exactly one AI companion — no wallet connect needed. Each companion owns its own encrypted wallet, its own non-transferable ENSv2 subname with a dedicated Permissioned Resolver, and manages savings via 1inch Aqua + SwapVM **without funds ever leaving the companion's wallet**. Every consequential action requires a fresh face-level approval from its human via World ID for Agents (OIDC `prompt=login`). One human, one companion — enforced by World Selfie Check nullifiers.

---

## Otomo とは

Otomo は、World ID の Selfie Check で本人確認した人間に1体だけ生まれる「相棒」です。**MetaMask 等のウォレット接続は不要** — 相棒は誕生時に専用ウォレット（AES-256-GCM で暗号化してサーバー保管）を持ち、自分の ENSv2 サブネーム（`<label>.otomo.eth`、譲渡不可）を自分で所有し、自分の資金を自分で動かします。人間は World ID で「この相棒のパートナー」として証明するだけです。

相棒はチャットと音声会話（Gemini Live）で依頼を受けますが、LLM の出力は権限になりません — 送金・運用・外部依頼などの重要な操作はすべて決定的なポリシーコードで判定され、World ID for Agents による**その場の顔での承認**を通った時だけ実行されます。

資金運用には 1inch Aqua + SwapVM を使います。相棒（maker）が `aqua.ship` で戦略を登録しても資金は相棒のウォレットから出ず、Aqua が仮想残高を記録するだけです。第三者のスワップが成立した瞬間にだけトークンが移動し、0.3% の手数料が相棒の戦略に積み上がります。

## 3分デモの流れ

1. **誕生**: `/` で名前を入力 → 「顔で誕生させる」。World IDKit（Selfie Check, action=`otomo-birth`, signal=サーバー発行の一度きり誕生チャレンジ）→ サーバーが `developer.world.org/api/v4/verify/{rp_id}` で検証 → nullifier 未使用を確認 → 相棒専用ウォレット生成 → ガス代を供給 → 専用 Permissioned Resolver をデプロイし `<label>.otomo.eth` を UserRegistry に登録（譲渡不可・所有者は相棒自身）。
2. **契り**: 「World ID で契りを結ぶ」→ World ID for Agents（OIDC sandbox）で初回ログイン。`sub` を相棒に紐付け、以後の承認はこの `sub` 一致が前提。
3. **チャット / 音声**: `/otomo/<label>` で相棒と話す。`🎤 音声で会話する` は Gemini Live（`gemini-3.8-live`）へブラウザから直接 WebSocket 接続（単回使用の ephemeral token を `/api/live/token` が発行、実 API キーはクライアントに出ない）。「気分を変えて」は ENS の `otomo.mood` に相棒ウォレットで即書き込み。
4. **「お金を増やして」**: LLM が `grow_savings` intent を返す → ポリシーが残高を確認 → `pending_actions` に保存（5分TTL）→ 「顔で承認する」で `prompt=login` 再認証 → サーバーが運用計画（strategy）を `ready` で保存。
5. **ship**: 顔承認済みの `strategy_operation` で相棒ウォレットが approve（不足時のみ）→ `aqua.ship`。**資金は相棒のウォレットに残ったまま**、画面で「ウォレット残高 / Aqua が預かっている額（仮想）」が並びます。
6. **デモスワップ**: 「相棒に取引を受けさせる（デモ）」で agent 鍵が第三者 taker として `router.swap` — 相棒のウォレットから直接 mUSDC が出て、mWETH（手数料込み）が入ります。
7. **dock**: 「運用をやめる」→ 顔承認 → 相棒ウォレットが `aqua.dock` — 仮想残高がゼロになり戦略終了。
8. **仕事を請けて稼ぐ**: 別の相棒から `request_friend` で依頼が届く → 受諾 → LLM が成果物を生成して納品 → 依頼主が検収（顔承認）→ **報酬が相棒の ENS 名宛に Sepolia 上で支払われます**。
9. **信頼度**: 誕生からの日数・顔承認回数・完了依頼数・sybil_score を集計した信頼度スナップショットを表示。「実績を公開」で ENS のテキストレコード（`otomo.reputation`）に刻印します。

承認を拒否した場合・期限（5分）切れ・別人の `sub`・古い `auth_time`・state 不一致・開始セッションと別のブラウザの場合は、いずれも**何も実行されません**（`tests/approval.test.ts`・`tests/approval-route.test.ts` で網羅）。

相棒ページは4言語（ja / en / zh / ko）の UI と字幕に対応します。右上の言語セレクタ（`localStorage` に保存）を切り替えると、相棒の吹き出しの下に選択言語の字幕が表示されます（`POST /api/translate` — LLM による翻訳を `translations` テーブルにキャッシュ、失敗時は原文フォールバック）。各吹き出しの 🔊 ボタンは**選択中の言語のテキスト**を音声で読み上げます（`POST /api/tts` — Gemini Interactions API、音声は text+lang+voice+model の sha256 でメモリ LRU キャッシュ。`TTS_MODEL` 未設定時は 503 で無効）。「新しい返答を自動で読み上げる」トグルもあります。

## アーキテクチャ

```mermaid
flowchart LR
  subgraph Browser
    UI[/"Next.js page<br/>IDKit 4.x + Gemini Live (mic)"/]
  end
  subgraph "Next.js API (app/)"
    POLICY["policy.ts<br/>deterministic gate"]
    APPROVAL["approval.ts<br/>World-ID-for-Agents gate"]
    AQUALIB["aqua.ts<br/>plan / confirm / agent swap"]
    CWALLET["companion-wallet.ts<br/>AES-256-GCM keys"]
    LLM[["LLM (OpenAI-compatible)"]]
  end
  subgraph World
    DEV["Developer Portal<br/>api/v4/verify"]
    OIDC["sandbox.auth.world.org<br/>OIDC (prompt=login, PKCE)"]
  end
  subgraph "Sepolia"
    ENS["ENSv2 UserRegistry +<br/>Permissioned Resolver"]
    USDC["MockUSDC (6dp)"]
    AQUA["Aqua + AquaSwapVMRouter<br/>+ OtomoProgram / OtomoOrderBuilder"]
    MWETH["MockERC20 mWETH (18dp)"]
    COMPW["companion wallets<br/>(own name + funds)"]
  end
  DB[("Turso / libSQL<br/>companions, pending_actions, strategies")]

  UI -->|"IDKit request"| DEV
  UI -->|"mic audio (ephemeral token)"| LLM
  CWALLET -->|"approve / ship / dock / transfer / setText"| COMPW
  COMPW --> ENS
  COMPW --> AQUA
  POLICY --> APPROVAL
  APPROVAL <-->|"authorize + token + JWKS"| OIDC
  AQUALIB --> AQUA
  AQUALIB --> USDC
  AQUALIB --> MWETH
  POLICY --> DB
  APPROVAL --> DB
  AQUALIB --> DB
  CWALLET --> DB
  UI --> POLICY
  POLICY --> LLM
  AQUALIB -.->|"resolveName / readText"| ENS
```

## スポンサー技術

### World — Best Use of IDKit / Best Use of World ID for Agents

- **Selfie Check（credential 11）を選んだ理由**: Orb 不要で World ID App だけで使える medium assurance。「1人に1体」は nullifier（`used_nullifiers` テーブル）で担保し、顔画像・生体情報はアプリに一切届きません（検証は Developer Portal 側）。`WORLD_SYBIL_MAX` で sybil_score 超過の誕生を拒否できます。
- **バックエンド検証**: RP 署名は [`app/src/app/api/world/rp-signature/route.ts`](app/src/app/api/world/rp-signature/route.ts)、proof 検証は [`app/src/app/api/birth/route.ts`](app/src/app/api/birth/route.ts) が `POST https://developer.world.org/api/v4/verify/{rp_id}` に委譲。順序: verify 成功 → signal 一致 → nullifier 未使用 → sybil 判定。
- **World ID for Agents（OIDC sandbox）**: 重要操作は [`app/src/lib/approval.ts`](app/src/lib/approval.ts) + [`app/src/app/api/approval/callback/route.ts`](app/src/app/api/approval/callback/route.ts) で「その場の本人確認」。`prompt=login&max_age=0`、PKCE S256、JWKS で iss/aud/exp/nonce 検証、`auth_time >= action.created_at`、pairwise `sub` が契りの sub と一致した時だけ実行。
- **失敗パス**: キャンセル・期限切れ（5分）・別人・古い auth_time・state リプレイはすべて rejected/expired で**実行されない**こと — [`app/tests/approval.test.ts`](app/tests/approval.test.ts)（8件）。

### ENS — Best Use of ENSv2

- ENSv2 が中核: 相棒 = 名前空間。親名 `otomo.eth`（ETHRegistrar commit-reveal で取得）配下に UserRegistry を1つ持ち、相棒ごとに VerifiableFactory で専用 Permissioned Resolver をデプロイして `register` します（[`app/scripts/setup-parent.ts`](app/scripts/setup-parent.ts)、[`app/src/lib/chain.ts`](app/src/lib/chain.ts) `issueCompanionName`）。
- **譲渡不可**: `COMPANION_ROLE_BITMAP = ROLE_SET_RESOLVER | ROLE_SET_RESOLVER_ADMIN`（[`app/src/lib/ens.ts`](app/src/lib/ens.ts)）。`ROLE_CAN_TRANSFER_ADMIN` を付けないため、相棒の名前は売却・譲渡できません。
- **最小権限**: resolver の `grants` は相棒ウォレットに `ALL_ROLES`（`0x1111…` 64ニブル）のみ。**相棒が自分の名前・レコード・資金を自分で持つ**設計で、人間側は World ID による関係性の証明だけを行います。
- Sepolia (ENSv2 Beta) の確定アドレスは [`docs/research.md`](docs/research.md) を正とします。

### 1inch — Build an Aqua App

- **非カストディアル運用**: `aqua.ship` は仮想残高の記録だけで資金は移動しません。スワップ成立時に `pull`/`push` で直接移動、`dock` で残高ゼロ。UI でウォレット残高と仮想残高を並べて示します。
- **SwapVM プログラム**: `Deadline → FlatFeeAmountIn(0.3%) → XYCSwap → Salt`（[`contracts/src/OtomoProgram.sol`](contracts/src/OtomoProgram.sol)、順序は swap-vm `docs/PROGRAMS.md` に準拠）。手数料 `0.003e9` = 0.3%（`BPS = 1e9`）。
- **公式契約を改変せず**: pinned commit で取得（[`contracts/script/install-deps.sh`](contracts/script/install-deps.sh)、commit 一覧は [`contracts/README.md`](contracts/README.md)）。
- **証跡**: ローカル anvil での ship→quote→swap→dock ログは [`contracts/evidence/demo.log`](contracts/evidence/demo.log)。オンチェーンヘルパー [`contracts/src/OtomoOrderBuilder.sol`](contracts/src/OtomoOrderBuilder.sol) で trait パッキングを TS 再実装せずに済ませています。
- **Sepolia デプロイ**: `contracts/script/DeploySepolia.s.sol`（資金到着後に実行予定、手順は contracts/README.md）。

Powered by Aqua — © Degensoft Ltd 2025. SwapVM — © Degensoft Ltd 2025.
（Aqua / SwapVM を取り込んだ Solidity ファイルは `LicenseRef-Degensoft-Aqua-Source-1.1` / `LicenseRef-Degensoft-SwapVM-1.1` でライセンスされます。`contracts/README.md` と `contracts/lib/*/LICENSES/` 参照）

## セットアップ

前提: Node.js 22、npm、Foundry（`foundryup`）。

```sh
# 1. コントラクト依存（pinned commit を lib/ に取得）
cd contracts && ./script/install-deps.sh && cd ..

# 2. アプリ
cd app
npm install
cp .env.example .env.local   # 値を埋める（下表）
npm run keys:init            # OPERATOR_PRIVATE_KEY / AGENT_PRIVATE_KEY / APP_SECRET を生成・記入

# 3. Sepolia: operator に ETH と MockUSDC を用意して親名セットアップ
npm run setup:parent         # → ENS_USER_REGISTRY を .env.local と app/deployments/sepolia.json に記録

# 4. Aqua スタックを Sepolia にデプロイ（contracts/deployments/sepolia.json を出力）
cd ../contracts
DEPLOYER_PRIVATE_KEY=0x... forge script script/DeploySepolia.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
# → AQUA_ADDRESS / AQUA_ROUTER_ADDRESS / OTOMO_ORDER_BUILDER_ADDRESS / MOCK_WETH_ADDRESS を .env.local に記入

cd ../app && npm run dev      # http://localhost:3000
```

本番（Vercel）: https://otomo-world-id.vercel.app/

### 環境変数（`app/.env.example`）

| 変数 | 用途 |
| --- | --- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | libSQL。未設定ならローカル `file:otomo.db`（Vercel では必須） |
| `NEXT_PUBLIC_WORLD_APP_ID` | Developer Portal の app_id（クライアント公開） |
| `WORLD_RP_ID` / `WORLD_RP_SIGNING_KEY` | Relying Party ID / 署名鍵（サーバーのみ） |
| `NEXT_PUBLIC_WORLD_ENV` | `staging`（開発）/ `production` |
| `WORLD_SYBIL_MAX` | この sybil_score を超える誕生を拒否（未設定=判定しないがログに残す） |
| `AGENT_OIDC_ISSUER` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | World ID for Agents（OIDC sandbox） |
| `SEPOLIA_RPC_URL` | Sepolia RPC |
| `OPERATOR_PRIVATE_KEY` | 親名管理・サブネーム登録・相棒ウォレットへの誕生時ガス供給の負担鍵 |
| `AGENT_PRIVATE_KEY` | デモ取引の第三者 taker 等の補助鍵 |
| `COMPANION_WALLET_KEY` | 相棒ウォレットの AES-256-GCM 暗号化キー（32バイトhex）。紛失すると相棒の鍵を復号できない |
| `COMPANION_GAS_ETH` | 誕生時に相棒ウォレットへ供給する Sepolia ETH（既定 `0.02`） |
| `ENS_PARENT_LABEL` / `ENS_USER_REGISTRY` | 親名ラベル / setup 出力の UserRegistry |
| `ENS_GRANT_AGENT_IN_INIT` | resolver initialize() の calls 内で mood 権限を付与する仮説の切替 |
| `AQUA_ADDRESS` / `AQUA_ROUTER_ADDRESS` / `OTOMO_ORDER_BUILDER_ADDRESS` / `MOCK_WETH_ADDRESS` | DeploySepolia.s.sol の出力 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 互換 /chat/completions（翻訳にも使用） |
| `TTS_MODEL` / `TTS_VOICE` / `TTS_BASE_URL` | Gemini Interactions API の音声合成。`TTS_MODEL` 未設定なら読み上げ無効（503）。鍵は `LLM_API_KEY` を共用、`TTS_VOICE` 未設定時は相棒ごとに決定的に割当 |
| `LIVE_MODEL` | 音声会話の Gemini Live モデル（既定 `gemini-3.8-live`）。`LLM_API_KEY` があれば有効 |
| `APP_SECRET` | セッション Cookie の HMAC 鍵 |

秘密値はすべてサーバーサイドのみ。未設定時はダミーに逃げず、不足変数名を明示してエラーにします（`src/lib/env.ts`）。

## テスト・検証

| コマンド | 結果 |
| --- | --- |
| `cd app && npm test` | vitest 10 ファイル **70 件すべてパス** |
| `cd app && npm run lint` | tsc --noEmit エラーなし |
| `cd app && npm run build` | 成功（`/api/strategies`, `/api/strategies/[id]` 含む全ルート） |
| `cd contracts && forge test` | **7 件すべてパス**（OtomoStrategy 5 + OtomoOrderBuilder 2） |
| `cd contracts && ./script/demo.sh` | anvil で ship→quote→swap→dock の実トークン移動を実演（ログ: `contracts/evidence/demo.log`） |

## 未検証・制限（正直に）

- **Aqua スタックは実 Sepolia では未デプロイ**（operator の Sepolia ETH 待ち）。コントラクト単体の ship→quote→swap→dock はローカル anvil と forge test で実証済みですが、アプリ側の ship→confirm→demo swap→dock 経路は実チェーンで未検証です。
- Selfie Check は厳密な「1人1アカウント」を保証しません（medium assurance）。1体制限は nullifier で担保し、追加のリスク判定に sybil_score を使います。
- 価格はモック想定（2000 USDC/WETH の固定レートで WETH レグを半分に）。モックトークンなので実市場連動ではありません。
- LLM は OpenAI 互換 `/chat/completions` なら任意のプロバイダに差し替え可能。LLM の出力は intent JSON として zod 検証され、ポリシー判定は常に決定的なコード側です。
- TTS（Gemini Interactions API）と ephemeral token 発行は実 Gemini API で疎通確認済み。Gemini Live の実会話セッションはブラウザ経由でのみ確認しています。テストは `fetchFn` / `chatFn` / `issueToken` 注入と `file:` 一時 DB のみで、外部呼び出しはありません。
- 相棒ウォレットの鍵は AES-256-GCM で暗号化して DB 保存していますが、サーバー保有のホットキー運用です。実資産を扱う本番運用では KMS/TEE 等への移行が前提です（テストネット・デモ用途に限定）。
- フォントは `next/font/google`（M PLUS Rounded 1c / Noto Sans SC / KR）で自己ホスト。ビルド時に Google Fonts への接続が必要です。

## ライセンス

- ルート `LICENSE`: **MIT**（© Otomo contributors）。`app/` のコードに適用されます。
- `contracts/` のうち Aqua / SwapVM の公式コードを取り込んだファイルは Degensoft ライセンス（`LicenseRef-Degensoft-Aqua-Source-1.1` / `LicenseRef-Degensoft-SwapVM-1.1`）— 範囲と帰属は [`contracts/README.md`](contracts/README.md) と `contracts/lib/*/LICENSES/` を参照。`contracts/src/mocks/MockERC20.sol` は MIT。

## AI 利用の明記

このプロジェクトは AI エージェント（Devin）とのペア開発で実装されました。仕様・計画・判断資料は `docs/` に、生成コードへのレビューと検証記録はコミット履歴にあります。
