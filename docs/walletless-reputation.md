# Walletless companions and ENS activity publication

## User flow

1. Choose a name and complete World Selfie verification. The browser gets a single-use, ten-minute challenge; no wallet connection is required.
2. A companion gets an independently generated wallet. Its private key is encrypted with AES-256-GCM; the companion label is authenticated data. The operator provisions the ENS subname.
3. Returning users choose login and verify the same World identity. Session cookies expire after 24 hours. Logout removes the browser cookie; it does not revoke copies of an already issued cookie.
4. The recipient accepts work and generates a text delivery. The requester reviews the actual result. Review queues one reward, which requires a fresh World ID for Agents approval by the bound person.
5. The activity card displays delivered, reviewed, and confirmed reward counts separately. Choose “ENSで公開する内容を確認”, inspect the snapshot, and approve using World ID. The app writes `otomo.reputation` and checks the current ENS value.
6. “ENSの現在値を再確認” performs reads only. A delayed response cannot overwrite the verification state of a newer publication. `/profile/<label>` shows the published snapshot and distinguishes a current match from a saved record.

`/lab/reputation` is an interactive display sample. Its counters are not real activity and do not write to the database or blockchain.

## What is public

ENS name, application issuer/version, Sepolia network, birth time, snapshot time, verification environment and approval issuer, and the three activity counts. These are Otomo's attestations, not a World-issued credit rating. Sybil score, identity subject/nullifier, face data, task text and wallet ciphertext are excluded. Sandbox approvals are identified as simulated identities.

## Configuration and custody

Run `npm run keys:init` to generate missing keys without printing them. Existing nonempty values are preserved. `COMPANION_WALLET_KEY` must be a stable 32-byte hex key, stored securely alongside the server environment. Losing it makes existing companion wallets inaccessible. Changing it does not migrate existing ciphertext. Back up the encrypted database and encryption key separately.

This remains server-controlled testnet custody. Encryption does not protect against a compromised server that can read the encryption key. Do not use these wallets for real assets. Dedicated companion wallets need Sepolia gas and the configured mock tokens; removing MetaMask from the user flow does not remove gas costs.

`ENS_USER_REGISTRY` and the operator's Sepolia gas are required for birth. Parent provisioning is separate (`npm run setup:parent`). Never choose another parent name automatically if the configured name is unavailable.

## Failure handling

- Birth reserves the identity and wallet before chain transactions. An uncertain registration is retained as `needs_review`; do not delete the reservation or mint again without checking the transaction. Automatic birth repair is not implemented.
- A work attempt can be retried after five minutes. Tokens fence off stale workers, so an old response cannot replace a newer delivery or reset its status.
- Reward transaction hashes are stored before receipt polling. A known broadcast with an uncertain receipt remains unconfirmed; dashboard reads reconcile it without rebroadcasting. Such payments do not count as received until receipt success is confirmed.
- ENS readback failure retains the publication for later read-only verification. Publication is not called verified merely because a write was attempted.

## Verification boundaries

Unit tests use local file databases and injected model/read functions. Passing these tests is not proof of real Selfie verification, funding, ENS deployment or an onchain payment. Production deployment and the complete live chain flow require separate evidence. Legacy companions retain their existing wallet path; this change does not transfer existing names or balances.
