# Demo UI brief — 2026-09-26

User direction: the live companion page mixes Aqua, job delivery, reward approval, ENS publication and raw transaction logs. Make the hackathon demonstration simple and check bugs and submission readiness. Preserve honest testnet/Sandbox labels. Keep the existing companions and workflows.

Implementation decisions:
- Retain the existing interactive companion artwork. On desktop, place the room beside the activity panel; stack them on mobile.
- Use three explicit activities: Talk, Work, 1inch Aqua. Keep pending approvals visible regardless of the selected activity.
- Show actual request → delivery → review → reward progress. Count reward payment only when the backend reports execution, no error and a transaction hash.
- Collapse paid delivery text, stopped strategies and technical receipts. Do not delete conversation or transaction history.
- Keep Sepolia and the actual approval issuer visible. Explain that reputation counts the worker's deliveries, not the requester's jobs.
- Provide real buttons for keyboard access to companion switching and retain speech/microphone controls.
- Clear strategy data when its fetch fails during a switch; do not show another companion's balances.
- Describe ship/swap/dock/publication approvals explicitly; safely reject unreadable stored intents in the UI.
- Explain the observed World ID 4.0 Session-proof failure without claiming enrollment or execution; do not reuse expired challenges.

Affected files: `app/src/app/otomo/[label]/{page.tsx,demo.css}`, `app/src/components/{DemoWorkCard,ReputationCard}.tsx`, `app/src/lib/{demo-copy,demo-view,plain}.ts`, `app/tests/demo-view.test.ts`, `app/src/app/approval/world/page.tsx`.

Validation: unit tests for unconfirmed payment, expired approval and malformed intent, TypeScript, production build, current browser screenshots at desktop and mobile widths, both companion roles and English/Japanese labels. All live receipt checks are read-only; UI verification does not create a new paid job or token swap.

AI assistance: Codex drafted and edited the files from the user's brief, ran checks and reviewed browser output. Existing Three.js companion assets were retained. No new illustration or logo was drawn in code. No external AI reviewer was used.
