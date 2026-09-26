# Otomo — English demo script (about 3 minutes)

The functional UI flow was rehearsed again on September 26: bilingual work, separate reward approval, a new Aqua lifecycle, and an expired approval with no execution. A timed human-narrated rehearsal and recording are not complete. Use the updated live application: https://otomo-world-id.vercel.app/. These are observed results; do not describe the Sandbox as real human verification.

| Time | Screen/action | Narration |
| --- | --- | --- |
| 0:00–0:20 | Companion room, with the Sepolia and Sandbox labels visible | “Otomo gives an AI companion a human partner, an ENS name and its own testnet wallet. World ID handles birth, ENS identifies the companion, and 1inch Aqua plus SwapVM enables token exchange.” |
| 0:20–0:45 | Show sora; switch to taro using the name buttons | “sora is my personal companion. taro takes small writing jobs. The first birth completed in the real World App; additional companions use the authenticated household session. That birth check is separate from the approvals in this demo, which use Sandbox identities.” |
| 0:45–1:25 | Work → paid job → View delivery & receipt | “sora requested a short introduction. taro accepted and delivered it. I reviewed the text, then approved the two mUSDC reward separately. The receipt shows the transfer from sora's wallet to taro's wallet on Sepolia. These are test tokens.” |
| 1:25–2:10 | 1inch Aqua → wallet → stopped strategy → ship/dock receipts | “This strategy used ten mUSDC and 0.005 mWETH. At setup, the tokens stayed in sora's wallet. A separate demo agent supplied 0.01 mWETH and received 6.659986 mUSDC in the swap. SwapVM applies a 0.3% input fee. The initial 2,000-to-one ratio is only a demo setting. We stopped the strategy, and its virtual balances are now zero.” |
| 2:10–2:35 | Evidence & profile, then taro's worker counts | “Each companion owns an ENSv2 name and resolver records. Worker delivery, review and reward counts come from Otomo's recorded activity. They are not a World-issued credit score. sora requested the job; taro earned the delivery record.” |
| 2:35–3:00 | Keep the approval environment visible; show failure evidence | “The backend validates approvals and binds each one to the action and expiry. The Sandbox protects this testnet flow. Production Session-proof approval is implemented but not working on the tested World App: it returned world_id_4_not_available and no human session was accepted. We show that limitation explicitly.” |

## Evidence to open

- [sora ENS registration](https://sepolia.etherscan.io/tx/0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926)
- [Reward payment](https://sepolia.etherscan.io/tx/0xc8a0e0dddca2ca73926c04c3a9bcb37d4cbb2c8ee1a7797eeb3099907649309c)
- [Aqua ship](https://sepolia.etherscan.io/tx/0x4632b1b73053c61acbdda045c19670ec535881816a8c989c4fd3485c4841c8de)
- [Aqua swap: actual token transfers](https://sepolia.etherscan.io/tx/0x9f6ac79947900a094a5073bc6a67dd4afc10bc39009d9a8de25d11f2f685ed8d)
- [Aqua dock](https://sepolia.etherscan.io/tx/0x63ec157c19ec7dbac91781e980763b47096905d8590f1f04fd43480f01f861f8)
- [sora ENS reputation publication](https://sepolia.etherscan.io/tx/0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310)
- Machine-readable read-only recheck: [sepolia-demo.json](evidence/sepolia-demo.json).

### Official 1inch Aqua registry (2026-09-26 rehearsal)

The demo now uses the official Aqua registry on Sepolia `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` with Otomo's own AquaSwapVMRouter `0x6069AaEBC937b794b02e9Fb14EeBE3881608B7C1` (redeployed, allowed by the rules) and OtomoOrderBuilder `0x159a581Ca16dE62D58bC24E483f25f02066B14c5`. sora's companion wallet is the maker.

| Step | Tx |
|---|---|
| approve mUSDC→Aqua | [0xe7e6534c](https://sepolia.etherscan.io/tx/0xe7e6534c7f083f7ea75d345c6f88ae21b4aff53615a5cc29a11e699be801273d) |
| approve mWETH→Aqua | [0x3f9b778a](https://sepolia.etherscan.io/tx/0x3f9b778a8bd92fa2e2711de7a78013c81af48cf2f1ac5817b2ecbee732d745b8) |
| ship | [0xef77b431](https://sepolia.etherscan.io/tx/0xef77b43136b9e7f909e2b2d4d947d879a9e8ec859accd318fcdea07ee5dda5f2) |
| third-party swap | [0x5b6198b9](https://sepolia.etherscan.io/tx/0x5b6198b9fd939af26ed51422fb5671b9c2a267281fdb7f93256ba5e066b4f988) |
| dock | [0x588f58a6](https://sepolia.etherscan.io/tx/0x588f58a6896ba008c150ab0845b772c776807da3ef21f04818b39f2682df4283) |

The latest delivered introduction contains English and Japanese, including 1inch Aqua + SwapVM, Sepolia and Sandbox disclosures. The original earlier delivery was English only.

## Still to demonstrate

A real expired approval was opened through Sandbox in the browser and returned Not executed. The database changed pending → expired with no transaction hash. Cancellation specifically remains unit-tested rather than browser-demonstrated. A timed narrated rehearsal, recording and microphone conversation remain unverified. See [latest rehearsal receipts](evidence/rehearsal-20260926.json).

Update (Sep 26 evening): production session approval no longer requires Selfie Check only — the request now accepts any World ID 4.0 credential (Selfie Check, passport, or My Number Card) and the backend accepts issuer schema IDs 11 / 9303 / 9310 / 1. A device retry is pending: if the World App can produce a passport session proof, replace the limitation segment above with a real production approval and re-record that section. If it still returns `world_id_4_not_available`, keep the honest-limitation narration.

The project-creation guidelines require a video for finalist-prize applications. The [official video rules](https://ethglobal.com/events/tokyo2026/info/details) require 2–4 minutes and at least 720p if uploaded, with human narration; AI voiceover and mobile-phone recording are disallowed. Do not use the app's synthesized voice as the presentation narrator.
