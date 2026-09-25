# World 連携の振り返り（Otomo）

提出対象部門: Best Use of IDKit / Best Use of World ID for Agents

## 1. なぜこの credential を選んだか

誕生の入口は **Selfie Check（issuer_schema_id 11）** を主軸に、**パスポート（9303）・マイナンバーカード（9310）・Proof of Human（1）** も受け付ける（`any()` 制約）。端末や地域で Selfie Check が使えないユーザーでも、手持ちの NFC 文書や Orb 認証で誕生できる。

- Otomo の要件は「1人1体の相棒」＝一意の人間性の証明であり、パスポートや Orb 級の強度は不要だった
- Orb は会場物理デバイス前提でハッカソンのデモ相手が使えない。Selfie Check は World App だけで完結し、参加者全員が試せる最低限の摩擦で済む
- 応答の `sybil_score` を門番として使い、`WORLD_SYBIL_MAX` 閾値で疑わしい登録を拒否する実装にした
- 重要操作（送金・依頼・運用）の承認には別途 World ID for Agents の OIDC を使い、`prompt=login` + `max_age=0` + `auth_time` で「その場の顔」を毎回要求する設計にした。誕生と実行で信頼の階層を分けている

## 2. 成功経路と代替経路

### 成功
1. `/api/world/rp-signature` が `signRequest` で署名付き rp_context と誕生チャレンジ（signal）を発行
2. IDKit（`IDKitRequestWidget`、4.2.3）が QR を出し、World App で Selfie Check 完了
3. `/api/birth` が Portal `/api/v4/verify/{rp_id}` で検証 → signal一致 → nullifier 重複なし → 性格生成 → ENS 名発行 → セッション発行

### 代替経路（いずれも実装＋テスト済み）
- **キャンセル/未完了**: IDKit の `onError` で失敗表示に戻る。保護処理は走らない
- **証明がウォレットレス化前の別コンテキスト向け**: `signal_mismatch` で 403
- **二重誕生**: `used_nullifiers` で `duplicate` 403
- **sybil リスク超過**: `sybil_risk` 403
- **期限切れ/取消の顔承認**: OIDC コールバックで `error` / state 不一致 / `auth_time` 古い場合は `rejected`・`expired` に落とし、pending action は実行されない（テストで網羅）

## 3. つまずきと学び

- **誕生セッションと証明の紐付け**: ウォレット接続を廃止したため、signal にウォレットアドレスを使えなくなった。サーバー発行の一度きりチャレンジ（クッキー＋DB、有効期限あり）を signal に採用して解決
- **Sandbox は `localhost` コールバックを拒否**: HTTPS の本番 URL（Vercel）を用意してから Agents 登録を行う必要があった
- **Agents ポータルのアクセス**: イベント開始直後は招待/ログイン方式が変わっていた（Okta化）。最新の sandbox ガイドと Discord 案内の確認が必要だった
- **「証明成功」≠「実行許可」**: 顔承認と実行を分離し、pending action は `auth_time` とセッション一致を両方満たした時だけ動く、という設計が一番の改善点だった

## 4. 残課題・改善点

- Selfie Check は現時点で World ID 3.0 経路（4.0 対応待ち）。Orb/Document へのアップグレード経路を UI 側に残したい
- sybil_score は保存済みだが、信頼度スコア（`reputation` 集計）への寄与は初期値のみ。挙動（承認履歴・継続日数）が主体の信頼モデルに今後寄せたい
- Agents の `agent_sub` との紐付けは bind フローで行うが、rediscovery（端末変更後の再紐付け）UX は未整備
