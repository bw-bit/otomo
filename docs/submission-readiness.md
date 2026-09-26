# Submission readiness — checked 2026-09-26 (JST)

**The application demo is available. The ETHGlobal submission is not complete.**

## Submission requirements and current state

| Item | Verified state | Remaining work |
| --- | --- | --- |
| ETHGlobal project | Name Otomo, AI category and emoji were entered. The guideline acknowledgement and Create project were attempted; browser control was interrupted before a saved project could be verified. Building from Scratch is selected. | Verify whether creation succeeded before retrying, complete the submission and select the intended partner prizes. |
| Deadline | September 27, 2026, 09:00 JST. Up to three partner prizes. | Submit before the deadline. [Official details](https://ethglobal.com/events/tokyo2026/info/details). |
| Source availability | `bw-bit/otomo` is public. Approval, UI and evidence changes were pushed through `cc1e812`; unauthenticated README access was verified. | Attach https://github.com/bw-bit/otomo to the submission. A separate active x402 task still has uncommitted changes; do not represent those as published by this commit. |
| Git history / AI disclosure | Multiple incremental commits exist. Specs are in `docs/SPEC-1-app.md` and `docs/SPEC-2-aqua.md`. UI brief and AI-assisted files are documented. | Include the current specs, prompts/planning artifacts and verification records in the submitted repository. Commit timestamps alone do not prove track eligibility. |
| Demo video | English script is prepared; recording/upload and full rehearsal remain unverified. | The project creation guidelines require a video when applying for finalist prizes. If submitted, it must be 2–4 minutes, at least 720p, with human narration; mobile-phone recording and AI voiceover are disallowed. [Video rules](https://ethglobal.com/events/tokyo2026/info/details). |

## Sponsor evidence

**1inch Aqua + SwapVM:** the deployed UI executed ship → swap → dock with sora as maker and a separate demo agent as taker. Receipts and transfers were rechecked during this audit. Token transfers occur at swap, not at ship. The [1inch requirements](https://ethglobal.com/events/tokyo2026/prizes/1inch) call for the official contracts, token-transfer execution in the demo and incremental commit history. These implementation elements are present; the final presentation still needs to show the swap receipt and explain the demo ratio. See [receipt evidence](evidence/sepolia-demo.json).

**ENSv2:** real Sepolia subnames and Permissioned Resolvers are integrated. sora's published reputation is readable; taro's application metrics are 1 delivered / 1 reviewed / 1 reward received. sora's zero delivery count is correct: sora requested the work. Public source and the live demo link still need to be attached to the submission. [ENS requirements](https://ethglobal.com/events/tokyo2026/prizes/ens).

**World / IDKit:** real World App birth, server verification and ENS provisioning were observed. [world-debrief.md](world-debrief.md) records success and unavailable-credential/proof-failure paths. The exact credential used in the successful birth was not conclusively retained. Do not claim a specific credential was proven on that attempt.

**World ID for Agents:** the demonstrated protected actions use the official development Sandbox with mocked identity. The current [World prize page](https://ethglobal.com/events/tokyo2026/prizes/world) allows the provided development environment; production identity is not stated as a universal submission prerequisite. Live unauthenticated and cross-origin approval requests now reject with 401/403 and unchanged action/transaction counts. The live browser cancellation/expiry journey is not yet recorded. Local tests cover cancellation, expiry and other failure paths. The complete successful Sandbox journey and integration feedback are documented.

## Product limitations and bug checks

- **Unresolved:** production Session-proof approval returns `world_id_4_not_available` on the tested World App. The backend accepted zero production human sessions. The new error message explains the limitation and prevents reusing an expired challenge. This does not invalidate the earlier successful birth, and it is not evidence of duplicate verification.
- **Fixed:** the long page is separated into Talk / Work / 1inch Aqua; completed deliveries and technical receipts are collapsed. Sepolia and Sandbox remain visible.
- **Fixed:** strategy fetch failure during companion switching clears old strategy data, avoiding stale balances from another companion.
- **Fixed:** Aqua ship/swap/dock and ENS publication approvals now describe the specific operation. Malformed stored intents no longer crash rendering or expose an approval link.
- **Clarified:** reputation counts the worker's deliveries, not outgoing requests. No metrics were fabricated or reassigned.
- **Corrected:** README and demo script distinguish verified deployed Sepolia flows from local tests, Sandbox identity and unresolved production Session proofs.
- **Not reverified:** live microphone conversation, a continuous demo rehearsal and a new bilingual delivery. The existing paid delivery is English only.

UI release verification: 113 tests passed; two opt-in live tests skipped. TypeScript and Vercel production build passed. The shared working copy, including separately developed x402 work, passed 140 tests with three opt-in tests skipped. That x402 work was excluded from this isolated UI release; no x402 payment or Bazaar listing is claimed here.

Published source recheck: 122 tests passed, two opt-in tests skipped, clean snapshot production build passed. The shared working copy passed 150 tests with three opt-in tests skipped. World verification now checks response success and individual credential results, rejecting partial or mismatched verification. This additional verifier hardening is committed; its production deployment is not yet verified.
