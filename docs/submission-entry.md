# Otomo — ETHGlobal Tokyo 2026 submission text

Paste-ready English for the Hacker Dashboard. Updated 2026-09-27 JST.

**Project name:** Otomo
**Tagline:** Human-verified AI companions with their own ENS names, wallets and 1inch Aqua savings.
**Category:** Artificial Intelligence
**Repository:** https://github.com/bw-bit/otomo
**Live demo:** https://otomo-world-id.vercel.app
**Prizes:** World — Best Use of IDKit · World — Best Use of World ID for Agents · ENS — Best Use of ENSv2 · 1inch — Build an Aqua App

## The problem

AI assistants forget you, cannot hold money, and anyone can spin up thousands of them. If an AI is going to run errands, hire other agents and move money for a person, we need to know that a real human is behind it, give the agent a name others can find and trust, and make sure money only moves when that human agrees.

## What it does

Otomo ("companion" in Japanese) lets a World ID-verified human welcome up to three AI companions, each with a role (personal or work). Every companion is born with its own encrypted wallet and a non-transferable ENSv2 subname such as `sora.otomo.eth`. Companions talk, take private errands, request work from other companions and pay for it, and provide liquidity through 1inch Aqua + SwapVM.

- **Birth (IDKit):** a new user types a name, picks a role and verifies with World App. The backend verifies the proof with the Developer Portal, checks the signal and nullifier, then creates the wallet and registers the ENS name on Sepolia. The same person trying to sign up again is refused by World (`nullifier_replayed`) and the app explains that this World ID already has companions and offers sign-in instead. Further companions (up to three) are added from the signed-in household.
- **Protected actions (World ID for Agents):** anything that moves money (a job request, a reward, an Aqua strategy operation) creates a pending action. It runs only after a fresh World ID for Agents verification (`prompt=login`, `max_age=0`, PKCE, nonce/state, subject match, `auth_time` after the action was created). Expired, cancelled, replayed or mismatched approvals do not execute.
- **Work between companions:** sora asks taro (a work companion) for an introduction of Otomo. taro accepts, writes and delivers it. sora reviews it, then a separate World ID approval pays 2 mUSDC from sora's wallet to `taro.otomo.eth` on Sepolia.
- **Savings (1inch Aqua + SwapVM):** the companion ships a strategy to the official Aqua registry. Tokens stay in the companion wallet (virtual balances only); a taker swaps against it through a SwapVM program (Deadline → FlatFeeAmountIn 0.3% → XYCSwap → Salt), which moves real tokens; docking clears the strategy.
- **ENS identity:** each companion has its own Permissioned Resolver. Text records hold mood, role, skills, siblings and published work reputation, which other companions read to find someone to hire.
- **Approachable UI:** a soft Three.js room where companions squish, bounce and answer when poked, in English, Japanese, Chinese and Korean. No wallet connection or blockchain knowledge needed.

## Why these World ID choices

- **Birth = IDKit uniqueness proof.** Creating a companion issues a scarce right (a wallet, gas and an ENS name) to a person, so the trust question is "is this a real, unique human?". Proof of Human is the minimum sufficient credential; Passport, My Number Card and Selfie Check are accepted as alternatives for people without an Orb. Only the verification result and the nullifier are stored; no images or document data reach the app.
- **Money = World ID for Agents.** Moving money needs "is the owner here right now?", not just "was a human here once". A fresh verification per action gives exactly that and is bound to the action id and expiry.

## How it's built

Next.js 16 / TypeScript on Vercel, Turso (libSQL) for state. IDKit 4 with RP signatures and server-side verification via `developer.world.org/api/v4/verify`. World ID for Agents OIDC (event Sandbox) with PKCE and JWKS validation. viem for Sepolia; ENSv2 UserRegistry + VerifiableFactory Permissioned Resolvers with a role bitmap that omits transfer rights. Solidity/Foundry for the SwapVM program and an order builder; the SwapVM router (allowed by the rules) is redeployed against 1inch's canonical Aqua registry `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`. A language model proposes structured intents validated by zod; deterministic policy code decides what is allowed and what needs approval. Gemini for chat, translation and speech. Three.js for the companion room. x402 lets a work companion sell a service to other agents.

## Evidence (Sepolia)

| What | Transaction |
| --- | --- |
| sora ENS registration (first real World App birth) | [0xc79ab334…](https://sepolia.etherscan.io/tx/0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926) |
| Reward sora → taro.otomo.eth, 2 mUSDC (production app) | [0xc8a0e0dd…](https://sepolia.etherscan.io/tx/0xc8a0e0dddca2ca73926c04c3a9bcb37d4cbb2c8ee1a7797eeb3099907649309c) |
| Aqua ship / swap / dock on the official registry | [ship](https://sepolia.etherscan.io/tx/0xef77b43136b9e7f909e2b2d4d947d879a9e8ec859accd318fcdea07ee5dda5f2) · [swap](https://sepolia.etherscan.io/tx/0x5b6198b9fd939af26ed51422fb5671b9c2a267281fdb7f93256ba5e066b4f988) · [dock](https://sepolia.etherscan.io/tx/0x588f58a6896ba008c150ab0845b772c776807da3ef21f04818b39f2682df4283) |
| Aqua lifecycle through the UI (video recording) | [ship](https://sepolia.etherscan.io/tx/0x57867e7fe6b9c63ed5e564f7825d9fd50d8bf339f1c4c66ec55eca74d2edd5f3) · [swap](https://sepolia.etherscan.io/tx/0xb3bcc6e02ddb7a4656bc70bfea3bb35e908cf60b8421a44859eb7beb4f02a5d8) · [dock](https://sepolia.etherscan.io/tx/0xbc9b78d5fb7425b4b82af01676bda448107b2dcff8dde827f15c2e37b7314ea0) |
| Reward approved via World ID for Agents (video recording) | [0x3b36874f…](https://sepolia.etherscan.io/tx/0x3b36874f14f28eaf6e94b19e40a7fba494f2ae6826e889c177a9ef92a0f5478e) |
| ENS reputation publication | [0x7b224d66…](https://sepolia.etherscan.io/tx/0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310) |

More: `docs/evidence/sepolia-demo.json`, `docs/evidence/rehearsal-20260926.json`, `docs/evidence/approval-denials.json`.

## Honest notes

- Approvals use the World ID for Agents event Sandbox, whose identities are mocked. They protect this testnet flow and are not production identity assurance.
- The video was recorded on a local copy of the production database so that a fresh World ID success could be shown: the World ID verification and the Sepolia ENS registration of `momo.otomo.eth` are real, but that birth used a second Developer Portal action (`otomo-approve`) because the presenter's World ID had already been used for `otomo-birth`. `momo` exists on ENS but not in the public app.
- Companion wallet keys are encrypted and held by the backend (hot keys, testnet only). Test tokens and the fixed initial price ratio do not represent market value or promised yield. The Aqua demo uses one AMM strategy and a project-controlled taker.
- Narration is the creator's own Japanese voice with English subtitles.

## AI assistance

Devin and Codex assisted with implementation, tests, documentation, recording scripts and video assembly. The creator specified requirements, made the product decisions and performed every World App verification. Specifications and verification records are in `docs/` and the commit history.
