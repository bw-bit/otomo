# Otomo リサーチメモ（2026-09-26 公式賞ページ・提出規定を再確認）

一次情報のURLと、実装で使う確定値をまとめる。出典のない値は使わない。

## 提出ルール（ETHGlobal Tokyo 2026）
- 応募できるパートナーは最大3社。同じスポンサーの複数部門は1社として数える（出典: /Users/R/hackathon/ETHGlobal-Tokyo-2026-prep.md）。
- 対象: World（IDKit / World ID for Agents）、ENS（Best Use of ENSv2）、1inch（Build an Aqua App）。
- 提出締切: 2026-09-27（日）09:00 JST。コミット履歴はイベント中に積む。AIの利用箇所と仕様・計画資料をリポジトリに含める。
- [提出規定](https://ethglobal.com/events/tokyo2026/info/details): パートナーは最大3社。動画は任意だが、添付する場合は2〜4分・720p以上・実声で、携帯電話収録とAI音声は禁止。提出物にはリポジトリとAI利用箇所を含める。

## World
### IDKit（相棒の誕生に使う）
- ガイド: https://docs.world.org/world-id/idkit/integrate （4.x。`@worldcoin/idkit` / `@worldcoin/idkit-core`）
- 公式サンプル: /Users/R/hackathon/references/world-idkit （HEAD 16bc527f）。Next.js 例: `/api/rp-signature` で `signRequest`、`/api/verify-proof` から `POST https://developer.world.org/api/v4/verify/{rp_id}`
- Developer Portal で `app_id` / `rp_id` / `signing_key` を取得（署名鍵はサーバーのみ）
- 開発時は `environment: "staging"` + Simulator（https://simulator.worldcoin.org/）
- Selfie Check（credential 11）: https://docs.world.org/world-id/credentials/11
  - 中程度の保証。Orb 不要で World ID App があれば誰でも使える。
  - 応答に `sybil_score`（リスク信号）と `integrity_bundle` を含む。検証成功後にだけスコアを使う。
  - 1回限りの操作: `IDKit.request({ action, allow_legacy_proofs: false, ... }).preset(selfieCheck())` → nullifier で二重実行を防ぐ。
- 審査で必要: 最小限で十分な credential を選んだ理由、成功1件＋代替経路（キャンセル・拒否・対象外）1件、統合の振り返り（初回成功までの時間、つまずき、不足、最大の改善点）。

### World ID for Agents（重要操作の承認に使う）
- ドキュメント: https://sandbox.auth.world.org/docs 。OIDC ベースの Human Continuity IdP。
- Discovery: https://sandbox.auth.world.org/.well-known/openid-configuration
  - issuer `https://sandbox.auth.world.org`
  - authorize `https://sandbox.auth.world.org/api/v1/authorize`
  - token `https://sandbox.auth.world.org/api/v1/token`
  - jwks `https://sandbox.auth.world.org/.well-known/jwks.json`
  - response_type `code`、PKCE `S256`、scope `openid`、subject `pairwise`、ID token `RS256`
  - `prompt`: `none` / `login`、claims に `auth_time` / `acr` / `amr` / `nonce`
  - token_endpoint_auth: `client_secret_basic` / `client_secret_post` / `private_key_jwt`
- 「その場の本人確認」= `prompt=login`（と `max_age=0`）で要求し、ID token の `auth_time` が操作作成時刻以降かをサーバーで検証する（RFC 9470 の考え方）。
- クライアント登録: ポータル（https://sandbox.auth.world.org/portal）または公式プラグイン（https://github.com/worldcoin/world-id-agent-plugin）の `world-id-developer` スキル。ポータルはGoogle/Okta ログインが必要でユーザー操作。
- 賞金ページ注記: 「proof はモックになったので sandbox app は不要」。本番用の身元として扱わない。
- 審査で必要: 要求→ユーザー完了→バックエンド検証→保護された操作の一連、拒否・期限切れ・キャンセルで操作が起きない経路、秘密をクライアントに出さない、統合の振り返り。

## ENSv2（Sepolia ベータ）
- 契約はまだ最終版ではない。読み取りはライブラリ標準の Universal Resolver 経由（アドレスをハードコードしない）。viem で `chain: sepolia` を選ぶだけ。
- Sepolia アドレス（https://docs.ens.domains/learn/deployments の Sepolia (ENSv2 Beta) 表）
  - ETHRegistrar `0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca`
  - ETHRegistry `0x657ea849311d3d5823348dded7c2aaafb3ede09e`
  - VerifiableFactory `0x9e726eb570beb6bceb495ab8cda7df517d4e841c`
  - PermissionedResolverImpl `0x14f09fd05d4585759e54844dc9b00147131cf243`
  - UserRegistryImpl `0xa80338aaa8d23831cea25e858d1774534abb0263`
  - MockUSDC `0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e`（`mint(address,uint256)` は誰でも呼べる）
- .eth 登録: ETHRegistrar は commit-reveal（commit → 60秒以上待つ → register）。手数料は承認済みステーブルコイン（Sepolia は MockUSDC 可）。関数定義は https://docs.ens.domains/llms-full.txt の「ETH Registrar」節を読むこと。
- サブネーム: 親名ごとに UserRegistry を VerifiableFactory で deploy（salt `keccak256(abi.encode(keccak256("UserRegistry"), namehash(parent), version))`、`initialize((address,uint256)[] grants)`）→ ETHRegistry で `setSubregistry(labelhash(parent), userRegistry)`。
  - `registry.register(label, owner, subregistry, resolver, roleBitmap, expiry)`。expiry は絶対時刻。
  - roleBitmap に `ROLE_CAN_TRANSFER_ADMIN` を入れなければ所有者は譲渡できない（= 譲渡不可の相棒名）。値は contracts-v2 の `RegistryRolesLib` を正とする。
  - 登録者（operator）には UserRegistry 上で `ROLE_REGISTRAR`（1<<0）と `ROLE_RENEW`（1<<16）が必要。
- Permissioned Resolver: 1アカウント1インスタンスが標準。VerifiableFactory で deploy（`initialize((address account,uint256 roleBitmap)[] grants, bytes[] calls)`。calls は初期化時にロールチェックなしで multicall 実行）。
  - 書き込みは DNS エンコード名: `setText(bytes name, string key, string value)`、`setAddress(bytes name, uint256 coinType, bytes addr)`。
  - ロール: `ROLE_SET_ADDRESS 1<<0`、`ROLE_SET_TEXT 1<<4`、`ROLE_LINK 1<<28`、`ROLE_UPGRADE 1<<124`。admin は `role << 128`。全ロール `0x1111…1111`（64ニブル）。
  - 特定キーだけの委任: `grantSetterRoles(encodeFunctionData(setText, ['0x', key, '']), account)`。取り消しは `revokeRoles(BigInt(keccak256(toHex(key))), ROLE_SET_TEXT, account)`。
  - 注意: 引数スコープの権限はそのリゾルバーが担当する**全ての名前**に効く。名前ごとに権限を分けたいなら名前ごとにリゾルバーを分ける。
- エージェント向け標準: ENSIP-25（AI Agent Registry 名の検証）https://docs.ens.domains/ensip/25/ 、ENSIP-26（Agent Text Records）https://docs.ens.domains/ensip/26/
- [賞の要件](https://ethglobal.com/events/tokyo2026/prizes): ENSv2 が中核であること、ハードコードでない動くデモ、ライブデモのリンク、公開アクセス可能なソース。エージェントを名前空間として扱い権限を持たせると加点。2026-09-26時点の `bw-bit/otomo` はprivateで、公開ソース要件は未達。

## 1inch Aqua / SwapVM
- Aqua: https://github.com/1inch/aqua （Solidity 0.8.30、Foundry、npm `@1inch/aqua`）
  - 残高は `balances[maker][app][strategyHash][token]` の仮想残高。資金は LP のウォレットに残る。
  - LP: `token.approve(aqua, max)` → `aqua.ship(app, abi.encode(strategy), tokens, amounts)` → 変更は `dock` → `ship`。
  - スワップ中だけ `pull` / `push`。
- SwapVM: https://github.com/1inch/swap-vm （npm `@1inch/swap-vm`）。`AquaSwapVMRouter` が Aqua 用の opcode セット。
  - Aqua モードは `useAquaInsteadOfSignature: true`、`DynamicBalances` を外し、残高は `aqua.ship` から来る。
  - AMM 例: `FeeFlatIn.build(0.003e7)` + `XYCSwap.build()`。`Deadline` 追加推奨。命令の順序はセキュリティ上重要。
  - SDK: https://github.com/1inch/sdks/tree/master/typescript/aqua
- 賞の条件: 公式 Aqua/SwapVM 契約を使う（改変した SwapVM の再デプロイは可）、最終デモでオンチェーンのトークン移動を見せる（ローカルフォーク可）、最終日の単一コミットは不可。SwapVM 利用で加点。
