# Otomo

**Tagline:** Human-backed AI companions with ENS identities and 1inch Aqua token exchange.

**Category:** Artificial Intelligence  
**Repository:** https://github.com/bw-bit/otomo  
**Live application:** https://otomo-world-id.vercel.app  
**Partner integrations:** World, 1inch, ENS

## What it does

Otomo gives a person a small household of AI companions with separate roles. A personal companion can ask a work companion for a short writing task. The worker delivers the text, the requester reviews it, and the human separately approves the test-token reward. Each companion has an ENSv2 subname, public activity records and a server-managed, encrypted wallet.

The DeFi demonstration uses 1inch Aqua and SwapVM. A companion registers virtual liquidity while tokens stay in its wallet. A separate demo taker then swaps against the strategy, moving tokens between the wallets. Stopping the strategy clears its Aqua virtual balances. The demonstration uses Sepolia mUSDC and mWETH, a 0.3% input fee and a demo-only initial ratio of 2,000 mUSDC per mWETH.

## How it is built

Next.js and TypeScript provide the interface and API routes. A language model proposes structured intents; deterministic server-side policy decides which actions are allowed and which require fresh approval. Turso/libSQL records actions, deliveries and approval state. World IDKit verifies companion birth; the World ID for Agents development Sandbox supplies OIDC approval with PKCE, nonce/state binding, subject matching and a fresh authentication time. Approval state is single-use and expires.

Companion ENSv2 names use permissioned resolvers on Sepolia. The Aqua and SwapVM source is pinned to upstream revisions and deployed by this project on Sepolia; these are project deployments, not a claim to use a canonical 1inch deployment. SwapVM executes Deadline → FlatFeeAmountIn → XYCSwap → Salt.

## What was actually verified

- A real World App birth completed and the backend provisioned sora's ENS identity. The exact credential from that successful attempt was not conclusively retained.
- The deployed application completed sora → taro request, delivery, review and a 2 mUSDC reward. The chain receipt confirms payment.
- The deployed application completed Aqua ship → swap → dock. Ship moved no tokens, swap produced actual transfers, and dock cleared the virtual balances.
- Negative approval tests cover cancellation, expiry, a different subject, stale authentication, invalid state, replay and failed verification. Live HTTP requests with no session or a cross-origin request were rejected without changing protected-action or transaction counts.

## Honest limitations

Protected actions in the demonstrated app use Sandbox identities, not production human authentication. Production Session-proof approval is implemented but the tested World App returned `world_id_4_not_available`; zero production human sessions have been accepted. This is separate from the successful birth authentication.

The wallet keys are encrypted and held by the application's backend. Tokens remaining in a companion wallet does not mean the human alone controls the keys. Test-token balances and the fixed initial ratio do not represent market value, yield or promised profit. The current Aqua demo uses a single AMM strategy and a project-controlled taker.

A new bilingual delivery, review, 2 mUSDC payment, Aqua ship/swap/dock cycle and browser expiry rejection were completed in the latest functional rehearsal. A timed human-narrated rehearsal is not yet complete. No demo video has been uploaded. A 2–4 minute, at least 720p video is required when applying for finalist prizes.

## Evidence

Public code includes `docs/evidence/sepolia-demo.json`, `docs/world-debrief.md`, `docs/demo-script.md`, architecture diagrams and implementation specs. Transaction links and approval environment disclosures are visible in the application.

## AI assistance

Codex assisted with implementation, debugging, tests, documentation and demo assets. The repository includes implementation specifications and verification records. Source availability and tests do not independently establish event-track eligibility.
