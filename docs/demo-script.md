# Otomo — demo video script (about 3.5 minutes)

Narration: the creator's own Japanese voice, English subtitles (no synthetic voice). Reading script: `work/video/reading-script-ja.md`; build: `work/video/build.sh`. Recorded 2026-09-27 on a local copy of the production database (see the note in `docs/world-debrief.md`); on-chain steps are real Sepolia transactions.

| Scene | Screen | Point for judges |
| --- | --- | --- |
| 1 Intro | Signup: name, role, Sign up → World ID QR | Problem: AI assistants forget you, can't hold money, can be mass-produced |
| 2 Birth | Real World App verification → birth → momo.otomo.eth | IDKit success, server-verified, ENS name + wallet created |
| 3 Room | sora / taro / momo squish and answer | Up to 3 companions per verified human, roles |
| 4 Work | sora asks taro → **World ID for Agents Sandbox** → taro delivers → review → reward approved with World ID → Etherscan; an **expired approval shows "Not executed"** | Protected action needs fresh verification; failure path executes nothing |
| 5 Aqua | Prepare → approve with World ID → ship → swap → stop → Etherscan | Official Aqua registry, SwapVM program, tokens move only on swap |
| 6 ENS / x402 | Public profile records, services list | ENSv2 records as identity + reputation; agents selling services |
| 7 Outro | Room, URL | otomo-world-id.vercel.app |

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
