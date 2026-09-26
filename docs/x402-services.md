# Otomo x402 page reports

Status: live at `https://otomo-world-id.vercel.app/services` on 2026-09-26. CDP endpoint validation passed, one operator-funded Base Sepolia payment settled, and the exact resource appeared in the CDP Bazaar search. This proves a testnet purchase flow, not an outside buyer or cash income.

## Service contract

- Public UI: `/services` (English by default, Japanese when selected).
- Public catalog: `GET /api/services` (description, price, input/output schemas and examples, supported source hosts, recipient addresses, network and readiness).
- Paid endpoint: `POST /api/services/{label}/page-report`.
- Price: **0.05 USDC per successful report**. Network defaults to **Base Sepolia**, whose test tokens have no monetary value. The existing Sepolia mUSDC is a different token on a different chain.
- Input: `{ "url": "https://www.gotokyo.org/en/index.html", "language": "ja" }`. Only `en` and `ja` are accepted.
- Output: JSON containing a summary, 1–6 facts with exact source excerpts, source URL, retrieval timestamp, content SHA-256, truncation and cache indicators. This is a source summary, not an independent fact check.
- Current source allowlist: `www.gotokyo.org`, `www.japan.travel`, `docs.world.org`. Public HTML/text only; no login, JavaScript rendering or arbitrary hosts. DNS addresses are checked and pinned; redirects are checked again. Maximum 1 MB response, 18,000 source characters and one bounded LLM call per uncached job.
- Cache: 10 minutes, keyed by normalized URL and language. The original retrieval time is retained. A new payment can purchase a cached report; a retry with the same payment retrieves the original result without a second settlement.
- Enabled providers must be explicitly allowlisted work companions with completed birth provisioning. Payment goes directly to their existing EVM wallet address. The current companion ENS identity is on Sepolia; clients use the explicit `payTo` and Base network from the x402 quote, not mainnet ENS resolution.

## Accounts and configuration

This implementation uses the **Coinbase Developer Platform (CDP) facilitator**. The operator needs a CDP developer account and server-side API key. Bazaar has no separate registration form/account for listing. Buyers need an x402-capable wallet/client with USDC on the selected network; this endpoint does not require Otomo signup or World ID from buyers. A new CDP wallet or CDP wallet secret is unnecessary for receiving at the existing companion address.

Configure server-side values in the existing local/production environment without overwriting unrelated settings:

```dotenv
CDP_API_KEY_ID=<server key ID>
CDP_API_KEY_SECRET=<server key secret>
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_SELLER_LABELS=taro
X402_SOURCE_HOSTS=www.gotokyo.org,www.japan.travel,docs.world.org
X402_DAILY_JOB_LIMIT=20
X402_BAZAAR_VERIFIED_AT=2026-09-26T10:39:48.173Z
```

The existing `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` and database configuration are also required. Credentials must not be committed, pasted into chat or prefixed with `NEXT_PUBLIC_`. The checked-in `.env.example` defaults to disabled, no provider and Base Sepolia. `X402_BAZAAR_VERIFIED_AT` records the UTC time of an observed testnet search result; remove it if the service is reconfigured or the listing can no longer be confirmed. Each provider is limited to 20 processing attempts in a rolling 24 hours by default, including failures.

Only `eip155:84532` (Base Sepolia) and `eip155:8453` (Base mainnet) are supported. Real earning requires an explicitly configured mainnet service and real purchases. Do not interpret the testnet report or test ledger as income.

## Payment and discovery flow

1. An unpaid POST receives HTTP 402 and the `PAYMENT-REQUIRED` header, containing an exact EIP-3009 USDC offer and Bazaar discovery extension. A bodyless POST is supported for Bazaar health probes; it never starts work.
2. The buyer signs the offered payment and resends the **same endpoint and explicit input** with `PAYMENT-SIGNATURE`.
3. The official facilitator verifies the authorization. An atomic database reservation prevents simultaneous reuse and enforces the daily limit.
4. Otomo fetches the page, generates/validates the report and stores it. Retrieval/generation failures return an error without calling settlement.
5. The facilitator settles. The result is released only after a successful transaction receipt has been saved as `settled`. Successful responses include `PAYMENT-RESPONSE`.

Read-only quote example, after enabling the service:

```sh
curl -i -X POST 'https://otomo-world-id.vercel.app/api/services/taro/page-report' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.gotokyo.org/en/index.html","language":"ja"}'
```

This curl does not sign or pay. The browser's **View payment quote** button has the same limitation. Payment is performed by an external x402 client; no browser wallet checkout is implemented.

`GET /api/services/earnings` requires the existing companion session and exposes only that companion's confirmed receipts, counts, network and transaction links. It reports **gross receipts**, not wallet balance or profit. Model token usage is recorded where supplied, but operational costs are not priced.

### Recovery and errors

- `400`: malformed input or unsupported source; no work/settlement.
- `402`: quote, invalid authorization or facilitator rejection.
- `404`: unavailable seller or mismatched endpoint/method.
- `409`: reused payment with changed input/signature, concurrent/pending payment, or a previous failed job. Do not automatically sign another payment for an uncertain job.
- `429`: rolling processing limit reached; no new generation.
- `502`: retrieval/generation failure; settlement was not requested.
- `503`: disabled/unavailable service or a settlement requiring reconciliation.

The additive `service_payments` table stores a payment identity hash, proof hash, input hash, status, report and settlement receipt. It does not retain raw signed authorizations or wallet secrets. `service_report_cache` stores shared report results. Neither changes the existing birth/approval tables.

For a dropped response after a recorded settlement, retry the same input and signed authorization to obtain the saved report. `processing`, `prepared` or `uncertain` records after interruption require operator reconciliation against the facilitator/chain before changing state. Automated reconciliation and a refund interface are not implemented. A locally prepared report or facilitator timeout is not proof of payment; never mark it settled from that alone.

## Live testnet verification

1. CDP server key is configured locally with mode `0600` and in the exact Vercel Production project `otomo`. Authenticated facilitator capability check succeeded.
2. `taro.otomo.eth` is the ready work companion receiving payment at `0x47638b38c6706fb60d710396cdd672a54c9160f0`. The public service catalog and `/services` page load over HTTPS; an unpaid request returns HTTP 402 with the Base Sepolia offer for 0.05 test USDC.
3. CDP's endpoint validator returned HTTP 200 with `valid: true` and `simulation.outcome: accepted` for `POST https://otomo-world-id.vercel.app/api/services/taro/page-report`.
4. One real, operator-funded testnet purchase returned HTTP 200 and a Japanese report with three source-grounded facts. The [settlement transaction](https://sepolia.basescan.org/tx/0x15cb250090713c2464da86a97c1c2241c267f06c5a7b746962be07447ee8360c) succeeded: buyer balance changed 1.00→0.95 and taro balance 0→0.05 test USDC. The Production database records this payment as `settled` with the same transaction hash.
5. Authenticated CDP Bazaar search for the exact resource, Base Sepolia network and recipient returned one match at `2026-09-26T10:39:48.173Z`. This is a dated observation of testnet indexing, not a guarantee of continued listing, mainnet curation, or outside purchases.

Mainnet activation still requires an explicit network and payment decision. Duplicate and dropped-response paths are covered by local tests; they were not exercised with a second live payment.

## Verification performed

- Original x402 implementation: `npm test` 136 passed, 3 opt-in live tests skipped.
- Production candidate incorporating the current demo and World approval UI: after the listing-label update, `npm test` passed 143 tests with 3 skipped; `npm run lint` and `npm run build` passed. The deployed payment flow passed CDP validation and the single live testnet purchase above.
- `npm run lint`: TypeScript check.
- `npm run build`: production build.
- Official x402 Next adapter exercised with **stub facilitator/source/LLM** for 402 schemas, verify/settle failures, forged authorization rejection, daily limits, replay, concurrent use, cache purchases and revenue accounting. Both official Bazaar extension validators pass. This is not a cryptographic/onchain E2E.
- Separate opt-in `tests/services.live.test.ts`: real GO TOKYO HTTPS retrieval and one real Japanese LLM report, with every quote matched to source text; no payment. Run with `RUN_LIVE_SERVICE_REPORT=1` and an absolute `SERVICE_REPORT_OUTPUT` path.
- Evidence: `work/x402/paid-e2e.json`, production API responses, onchain receipt and the settled Production database row. The UI fixture uses a synthetic provider for layout only; live payment used the real taro address. The [faucet transaction](https://sepolia.basescan.org/tx/0x6c034e5529f006f7c4deccec5fac3b0830647c90a23f96f8fcc40acc89f19039) supplied the operator's buyer wallet with 1 test USDC.

Official references: [seller quickstart](https://docs.cdp.coinbase.com/x402/seller/quickstart), [Bazaar discovery and indexing conditions](https://docs.cdp.coinbase.com/x402/seller/get-discovered), [endpoint validation](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/validate-x402-endpoint).
