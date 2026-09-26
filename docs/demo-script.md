# Otomo デモ台本 — 実機で確認済みの導線（約2分）

収録と通しリハーサルは未実施。`sora.otomo.eth` は既に誕生済みなので、誕生の再送信ではなく、本番の相棒画面と登録トランザクションを使う。

| 時間 | 画面 | 実声ナレーション |
|---|---|---|
| 0:00–0:20 | [本番トップ](https://otomo-world-id.vercel.app/) | 「Otomoは、World IDの本人確認からENS名を持つAIの相棒を作るアプリです。今回、実機のWorld Appで認証し、soraという相棒を誕生させました。」 |
| 0:20–0:50 | [soraの相棒画面](https://otomo-world-id.vercel.app/otomo/sora)と[ENS登録tx](https://sepolia.etherscan.io/tx/0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926) | 「名前はsora.otomo.eth。Sepoliaでの登録はこのトランザクションで成功し、ENSの解決先は相棒専用ウォレットです。画面にはENSから読んだ気分も表示されます。」 |
| 0:50–1:20 | 相棒画面のチャット履歴 | 「日本語で話しかけると、soraが返答します。ここでは『自己紹介を一言で』と聞き、相棒としての返答を受け取りました。」 |
| 1:20–1:50 | 実績カードと[評判公開tx](https://sepolia.etherscan.io/tx/0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310) | 「実績はOtomoが記録し、ENSテキストレコードへ公開できます。この公開もSepoliaで成功しました。誕生は本番World ID、後続の承認サービスは画面表示どおりSandboxの模擬IDです。」 |
| 1:50–2:10 | [World連携の振り返り](world-debrief.md)の失敗経路 | 「使える資格情報がない試行では、IDKitがエラーを返し、誕生APIは呼ばれませんでした。成功と失敗を区別し、発行処理は検証成功後だけ実行します。」 |
| 2:10–2:20 | soraの相棒画面 | 「World IDで誕生し、ENSに名前と活動記録を持つ。これが今回、実機とSepoliaで確認できたOtomoです。」 |

## 収録時の事実確認

- 本番 `/api/birth` HTTP 200、proof check `ok: true`、DB `birth_provisioning=ready`、ENS登録tx receipt `success`。詳細は `work/autonomy/otomo-birth-e2e-success.json`。
- チャット送受信と評判のENS公開を本番で確認。評判のissuerは `https://sandbox.auth.world.org`。本番のWorld ID for Agents承認として説明しない。
- Live/TTS、Aquaの本番アプリ操作、依頼・納品・支払いは未実走。`contracts/evidence/demo.log` はchain ID 31337のローカル記録であり、本番Aqua統合の証拠ではない。
- 相棒ウォレットのmUSDCとmWETHはともに0で、strategyは0件。評判公開のpending actionが別に1件あるため、録画中に再承認しない。
- セッションクッキーや秘密値を映さない。[公式動画規定](https://ethglobal.com/events/tokyo2026/info/details)では、添付動画は2〜4分、720p以上、実声が必要。携帯電話での収録・AI音声は不可。
