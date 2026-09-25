# SPEC-1: Otomo アプリ本体（優先度1: World + ENSv2）

前提資料: docs/research.md（確定値・URL）。値はここと research.md を正とし、推測で変えない。

## 目的
顔（World Selfie Check）で1人1体の相棒を誕生させ、相棒に ENSv2 のサブネーム `<label>.<parent>.eth` を与える。
相棒はチャットで依頼を受け、重要な操作は World ID for Agents による「その場の本人確認」を通った時だけ実行する。

## 場所と技術
- ルート: `/Users/R/hackathon/otomo/app`（Next.js App Router + TypeScript, pnpm）。`/Users/R/hackathon/otomo/contracts` は別担当なので触らない。
- ライブラリ: `viem`、`wagmi`（injected コネクタのみ, Sepolia のみ）、`@worldcoin/idkit`（4.x）、`better-sqlite3`、テストは `vitest`。
- 新規依存は公開から7日以上経過した版を固定で入れる（`latest` 不可）。
- git は `/Library/Developer/CommandLineTools/usr/bin/git` を使う（`/usr/bin/git` はXcodeライセンスで止まる）。コミットは lead が行うので、作業者はコミットしない。

## 環境変数（`.env.example` に全て列挙。実値は `.env.local`、git 管理外）
```
NEXT_PUBLIC_WORLD_APP_ID=
WORLD_RP_ID=
WORLD_RP_SIGNING_KEY=
NEXT_PUBLIC_WORLD_ENV=staging
WORLD_SYBIL_MAX=            # これを超える sybil_score は誕生を拒否（数値。未設定なら判定しないがログに残す）
AGENT_OIDC_ISSUER=https://sandbox.auth.world.org
AGENT_OIDC_CLIENT_ID=
AGENT_OIDC_CLIENT_SECRET=
AGENT_OIDC_REDIRECT_URI=http://localhost:3000/api/approval/callback
SEPOLIA_RPC_URL=
OPERATOR_PRIVATE_KEY=       # 親名の管理とサブネーム登録・ガス負担
AGENT_PRIVATE_KEY=          # 相棒の実行用。オンチェーンで与えた権限（気分テキスト、USDC 上限）以外は何もできない
ENS_PARENT_LABEL=otomo      # 取れなければ別ラベル
ENS_USER_REGISTRY=          # setup スクリプトの出力を記入
LLM_BASE_URL=               # OpenAI 互換
LLM_API_KEY=
LLM_MODEL=
```
秘密はサーバーコードでのみ読む。`NEXT_PUBLIC_` 以外をクライアントに出さない。値が無い時はダミーで代替せず、どの変数が足りないかを明示してエラーにする。

## 1. 親名セットアップ（`scripts/setup-parent.ts`, `pnpm setup:parent`）
operator 鍵で1回だけ実行。各ステップは既に済んでいれば飛ばす（冪等）。
1. MockUSDC を operator に mint。
2. ETHRegistrar で `${ENS_PARENT_LABEL}.eth` を commit → 60秒以上待つ → register（MockUSDC で支払い、approve 含む）。関数定義は ENS docs の ETH Registrar 節を読んで合わせる。既に他人が持っていたら停止して報告。
3. VerifiableFactory で親名用 UserRegistry を deploy（grants: operator に全ロール）→ ETHRegistry で `setSubregistry`。
4. 出力（UserRegistry アドレス、tx hash）を表示し、`app/deployments/sepolia.json` に保存。

## 2. 相棒の誕生（World IDKit + ENSv2）
画面 `/`（未誕生）→ ウォレット接続 → 「顔で誕生させる」。
1. IDKit Selfie Check の一回限りリクエスト: `action = "otomo-birth"`, `allow_legacy_proofs: false`, `signal = 接続ウォレットアドレス（小文字）`。RP 署名は `/api/world/rp-signature`、検証は `/api/world/verify-birth`（`POST https://developer.world.org/api/v4/verify/{rp_id}`）。公式サンプル `/Users/R/hackathon/references/world-idkit` の Next.js 例の構成に合わせる。
2. サーバー検証の順序: v4 verify 成功 → signal が接続アドレスと一致 → nullifier 未使用（1 World ID = 1体）→ `WORLD_SYBIL_MAX` 判定。どれかで失敗したら相棒を作らず、理由をUIに表示（キャンセル・未所持・重複・スコア超過をそれぞれ区別）。
3. 相棒の生成: 名前ラベル（ユーザーが入力。ENS 正規化、3〜20文字、既存なら拒否）と、性格シード（LLM で生成。一人称・口調・得意分野の短いJSON）。
4. ENS 発行（operator が送信）:
   a. 相棒専用の Permissioned Resolver を VerifiableFactory で deploy。salt は `keccak256(abi.encode(keccak256("OwnedResolver"), userAddress, version))`、version は未使用の最小値。grants は `[{ user, ALL_ROLES }]` のみ（operator・agent には付けない）。calls で初期レコード: `setAddress(name, 60, user)`、`setText(name, "description", …)`、`setText(name, "otomo.personality", JSON)`、`setText(name, "otomo.mood", "calm")`。ENSIP-26 のエージェント用テキストキーで該当するものがあれば併記。
      - 仮説: calls で `grantSetterRoles(setText otomo.mood, AGENT)` もロールチェックなしで通る。Sepolia で実際に確かめ、通るならここで付与。通らなければ手順 5 に回す。どちらになったか報告する。
   b. UserRegistry に `register(label, user, 0x0, resolver, ROLE_SET_RESOLVER | ROLE_SET_RESOLVER_ADMIN, now + 365日)`。`ROLE_CAN_TRANSFER_ADMIN` は付けない（譲渡不可）。ロール値は contracts-v2 の `RegistryRolesLib` から取る。
5. （4a の仮説が外れた場合）ユーザーのウォレットで `grantSetterRoles(setText otomo.mood, AGENT)` を署名する画面。「相棒に気分だけ書き換える権限を渡す」と表示。
6. 「兄弟の契り」: World ID for Agents で初回ログイン（`prompt=login`）し、ID token の `sub` を相棒に紐付けて保存。以後の承認はこの `sub` と一致した時だけ有効。
7. 誕生完了画面で `viem getEnsAddress / getEnsText`（Sepolia, Universal Resolver 経由）で読み戻した値を表示する（ハードコード禁止）。

## 3. チャットと意図（intent）
画面 `/otomo/[label]`。LLM は性格シードで口調を持ち、返答と一緒に次の JSON を1つ返す（zod 等で厳密に検証し、不正なら intent なしとして扱う）:
```
{ "type": "none" }
{ "type": "update_mood", "mood": string }
{ "type": "request_friend", "friend": "<label>.<parent>.eth", "task": string, "rewardUsdc": number }
{ "type": "send_usdc", "to": "<ens name or 0x>", "amountUsdc": number, "memo": string }
{ "type": "private_task", "summary": string }
```
ポリシーは決定的なコード（`lib/policy.ts`）で判定し、LLM の出力を権限として扱わない:
- `update_mood`: 自動実行。AGENT 鍵で相棒リゾルバーの `setText(name, "otomo.mood", mood)`。オンチェーン権限はこのキーだけ。
- `send_usdc`, `request_friend`（報酬あり）, `private_task`: 承認必須（4 章）。
- `send_usdc` の上限: ユーザーが事前に MockUSDC を AGENT に `approve` した額（オンチェーンの上限）＋アプリ側の1回上限 `20 USDC`。超える依頼は承認画面に進めず拒否理由を表示。
- 宛先の ENS 名は Sepolia で解決し、解決できなければ拒否。

## 4. 承認ゲート（World ID for Agents）
1. 保護対象の intent は `pending_actions` に保存（id, character, 内容, created_at, expires_at = +5分, status）。
2. 「顔で承認」→ `/api/approval/start?action=<id>`: state（action id に束縛）、nonce、PKCE verifier をサーバー側に保存し、authorize へ `prompt=login&max_age=0&scope=openid` でリダイレクト。
3. `/api/approval/callback`: state 照合 → code 交換（client secret はサーバーのみ）→ ID token を JWKS で検証（iss, aud, exp, nonce, `auth_time >= created_at`, `sub` = 相棒に紐付けた sub）→ action が期限内かつ pending → 実行 → status=executed。
4. 失敗経路: IdP の `error`（キャンセル・拒否）、期限切れ、sub 不一致、auth_time が古い、state 不一致 → status=rejected/expired にして**実行しない**。理由をUIに表示。
5. 実行内容: `send_usdc` は AGENT 鍵で `MockUSDC.transferFrom(user, to, amount)`。`request_friend` は友達の相棒の受信箱に依頼を作成し、報酬を同じ方法で送る。`private_task` は実行記録のみ（内容はサーバー DB、チェーンに載せない）。tx hash を表示し Sepolia Etherscan へリンク。

## 5. 友達への依頼
- 友達の名前を Sepolia で解決（address と `otomo.personality` が読めること = Otomo の相棒である確認）。
- 依頼は DB に保存し、友達の相棒の画面に受信箱として表示。受諾・完了を操作できる（完了で報酬の承認フローへ）。

## テスト（vitest、ネットワーク・時刻・乱数はモック）
- policy: 各 intent の判定、上限超過、ENS 未解決の拒否。
- 承認 callback: 成功で1回だけ実行／キャンセル・期限切れ・sub 不一致・古い auth_time・state 不一致で実行されない。
- 誕生検証: v4 verify 失敗・signal 不一致・nullifier 重複・sybil 超過で相棒が作られない。
- ENS calldata: DNS エンコード名、grantSetterRoles の setter エンコード、roleBitmap に transfer 権限が含まれないこと。
- intent パーサー: 不正 JSON は `none`。
`pnpm test`、`pnpm lint`、`pnpm build` が通ること。

## 対象外（後回し）
- 1inch Aqua 連携（SPEC-2）。本 SPEC ではチャットの intent に `ship_strategy` を足せるよう型だけ拡張可能にしておく。
- 本番デプロイ（ライブデモ URL は後で決める）。

## 提出物に必要な文書
- `README.md`: 一文要約、構成図、各スポンサー技術を使っているファイルと行、セットアップ手順。
- `docs/world-debrief.md`: 振り返りの雛形（実際の数値は lead が記入）。
- AI 利用の明記。

## 実装状況

- 本 SPEC は実装済み（`npm test` 33件、`npm run lint`、`npm run build` 通過）。
- 追加で SPEC-2 の Aqua 連携が入っている: intent に `grow_savings`（`src/lib/intent.ts`）、`strategies` テーブル、`src/lib/aqua.ts`、`/api/strategies`・`/api/strategies/[id]`、相棒ページの「貯金の運用」セクション、contracts 側の `OtomoOrderBuilder`（maker 側 trait パッキングのオンチェーン化）。Aqua 上で maker=ユーザー自身が ship/dock し、agent 鍵はデモ taker のみ（資金移動はユーザーの ship 以外に書かせない）。
- 未実施: Aqua スタックの実 Sepolia デプロイ（資金待ち）、`docs/world-debrief.md`。
