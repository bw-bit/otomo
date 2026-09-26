# World連携の振り返り（Otomo、2026-09-26実測）

対象: ETHGlobal Tokyo 2026 Best Use of IDKit / Best Use of World ID for Agents。誕生認証と後続のSandbox承認を区別する。

## 認証を必要とする場面と資格情報

Otomoでは1つのWorld ID識別子から相棒を最大3体（既定、`WORLD_MAX_COMPANIONS`）誕生させられる。役割は個人/仕事で、役割ごとの許可操作はポリシーコードで強制する。誕生は人間にだけ許される権利発行なので、人間性の確認とサーバー側のnullifier重複防止を組み合わせる。現在の画面の既定は `proofOfHuman({signal})`（Orbの旧証明フォールバックを含む）。パスポート、マイナンバーカード、Selfie Checkは本人が選択できる。属性や書類番号は保存しない。受け付けた個別のcredential名は今回の保存済みデータから断定できないため、実機で使った種類を特定済みとは扱わない。

## 実測した成功経路

1. 本番 `/api/world/rp-signature` がRP署名と600秒のチャレンジを発行。IDKit 4.3.0のQRを実機World Appで読み、ユーザーが認証を完了。
2. 本番 `/api/birth` はHTTP 200、proof check `ok: true`。サーバーがPortal `/api/v4/verify/{rp_id}` へ送って検証し、signalと未使用nullifierを確認してから相棒を生成。
3. `sora.otomo.eth` のDB状態はready。SepoliaのENS登録tx `0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926` はsuccess、ENSの解決先は相棒ウォレットと一致。

実機・DB・チェーン照合: `work/autonomy/otomo-birth-e2e-success.json`。

## 意味のある失敗経路

最初の本番試行ではIDKit 4.2.3の `world_id_4_not_available` が出て、`/api/birth` に到達しなかった。別の4.3.0試行では `inclusion_proof_failed` が返り、同様に相棒は発行されなかった。これは利用できない資格情報・証明失敗時に保護処理が起きなかった実測例。後者は要求期限後の報告だったが、期限切れが原因とは確定していない。成功試行後、同じWorld IDでの二重発行は実機では試していない。signal不一致、nullifier重複、sybilリスク超過の拒否処理はコードにあるが、今回の実機デモ結果ではない。

## World ID for Agents

人間パートナーの紐付けと評判ENS公開は実行できた。OIDC issuerは `https://sandbox.auth.world.org` で、イベントの開発環境に相当する模擬ID。評判公開tx `0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310` はsuccess、ENS textとDB snapshotは一致した。要求→ユーザー完了→バックエンド検証→保護操作の成功経路を示す。一方、拒否・期限切れ・キャンセル時に保護操作が起きない経路は今回の本番画面で未実演。Sandboxの結果を本番身元保証と表現しない。

## 時間・摩擦・改善点

最初に保存された本番失敗報告（2026-09-26 00:41 UTC）から、成功した `/api/birth`（02:54 UTC）までは約2時間13分。これは着手からの総時間ではない。最大の摩擦は、IDKitの汎用エラーだけでは資格情報・証明失敗を切り分けられなかった点。Action/RP署名/Portal precheckを照合し、IDKit 4.3.0、公式credential preset、旧Orbフォールバック、600秒署名TTLを順に反映して成功した。単一変更の寄与は切り分けられていない。最も有効な改善は、IDKitの具体的エラーコードをアプリ画面に表示し、サーバー到達前の失敗を特定できるようにしたこと。

未収録: World ID for Agentsの拒否経路、動画、通しリハーサル。提出時は実演または証拠と未実演部分を区別する。

## Later verification — production UI and Session proofs

The production app subsequently completed the sora → taro request/delivery/review/reward flow and the Aqua ship/swap/dock lifecycle on Sepolia. Approvals used the Sandbox identity; receipt evidence is in `docs/evidence/sepolia-demo.json`.

A separate production IDKit Session-proof enrollment was attempted in World App and returned `world_id_4_not_available`. No production human session was accepted by the backend. This path is not equivalent to birth Action reuse and does not prove that the user failed because they were already verified. The UI now explains the unresolved compatibility issue, avoids claiming enrollment/execution, and prevents reuse of expired challenges. Production sensitive-action approval remains unverified.

## Submission preparation — 2026-09-26

The live approval API rejected unauthenticated requests with 401 and cross-origin requests with 403. Protected-action and transaction counts were identical before and after these requests; see `docs/evidence/approval-denials.json`. Cancellation, expiry, stale authentication, subject mismatch, replay and failed proof validation passed local tests. A subsequent live browser demonstration opened a real expired Sandbox approval: the UI showed Not executed and the database recorded expired with no transaction hash. Cancellation specifically remains tested locally.

The official error definition for `world_id_4_not_available` is an unavailable World ID 4.0 credential for the user. Session proofs need World ID 4.0, so a successful earlier birth (which can use legacy fallback) is not proof of Session support. [Error reference](https://docs.world.org/world-id/idkit/error-codes), [Session reference](https://docs.world.org/world-id/idkit/session-proofs). The backend still has zero accepted production human sessions. No production identity was fabricated or replaced with a Sandbox identity.

The verifier now requires `success: true` and successful results for all requested credentials; a 200 partial-success response alone is insufficient. The original proof payload is forwarded unchanged. This hardening is committed, tested and deployed to the production app. It does not resolve the phone's missing-credential condition.

Latest functional rehearsal: English/Japanese delivery, review, 2 mUSDC reward and Aqua ship/swap/dock were completed again through the deployed UI. All four Sepolia receipts succeeded; ship moved no tokens, swap transferred tokens, and dock left zero virtual balances. See `docs/evidence/rehearsal-20260926.json`.

## Final state and debrief — 2026-09-27

**Trust moments and credentials.** Birth issues a scarce right (wallet, gas, ENS name) to a person, so it uses an IDKit uniqueness proof (action `otomo-birth`, signal = one-time server challenge); Proof of Human is the minimum sufficient credential, with Passport, My Number Card and Selfie Check as alternatives. Moving money needs "the owner is here now", so every money-moving action (job request, reward, Aqua strategy operation) requires a fresh World ID for Agents verification bound to that action.

**Success paths shown.** (1) IDKit: a real World App verification followed by `/api/birth` 200 and a Sepolia ENS registration (sora on the production app; momo in the video, see below). (2) World ID for Agents: pending action → Sandbox verification (`prompt=login`, `max_age=0`) → backend validates the ID token, nonce, subject and `auth_time` → the protected action executes (reward tx `0x3b36874f14f28eaf6e94b19e40a7fba494f2ae6826e889c177a9ef92a0f5478e`).

**Alternative / failure paths shown.** (1) IDKit: the same human signing up again gets `nullifier_replayed`; the app now explains "This World ID already has companions. Sign in to welcome a sibling." and no companion is created. (2) World ID for Agents: an approval opened after its 5-minute window completes the Sandbox verification but the backend refuses; the room shows "Not executed: the 5-minute approval window expired, so nothing was sent", the action status is `expired` and no transaction exists (recorded in the video). Cancellation, subject mismatch, stale `auth_time`, state replay and failed token validation are covered by `app/tests/approval.test.ts`.

**Approval design history.** We tried (a) production Session proofs, which the tested World App could not produce (`world_id_4_not_available`); (b) re-using the `otomo-birth` uniqueness proof for approvals, rejected by World as `nullifier_replayed` because a uniqueness proof is one per person per action; (c) a birth-verified owner confirmation button, which we removed because it let a protected action run without a fresh verification. The final design is World ID for Agents for every protected action.

**Video recording note.** To show a fresh successful World ID verification, the video was recorded on a local copy of the production database with the birth action switched to a second Portal action (`otomo-approve`, via `NEXT_PUBLIC_WORLD_BIRTH_ACTION`), because the presenter's World ID was already used for `otomo-birth`. The World App verification and the ENS registration of `momo.otomo.eth` (`0x906f0a36eec615466b1cb735fdaf9fbb2370d3e8b06c08f5eb871733c231ce29`) are real; momo is not in the public app.

**Time to first success.** About 2 h 13 min from the first saved production failure to the first successful `/api/birth`.

**Friction.** (1) IDKit's generic errors did not say whether the credential, the RP signature or the action caused a failure. (2) It was not obvious that a uniqueness proof cannot be repeated for the same action, or that Session proofs need World ID 4.0 credentials that a legacy-verified phone may lack. (3) The Portal has no per-action "max verifications" setting, so the only way to re-demonstrate a birth was a second action.

**Missing capability / documentation.** A documented, supported way to ask an already-verified human to re-prove presence for later actions on devices without World ID 4.0 credentials, and a table of which credentials each proof type supports.

**Improvement with the greatest impact.** Surfacing the specific IDKit error code in the app (and mapping `nullifier_replayed` to "you already have companions, sign in") turned opaque failures into actionable ones.
