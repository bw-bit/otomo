# Otomo — Aqua + SwapVM demo (SPEC-2)

Demonstrates on a local anvil chain that a user's ("maker") funds can back an
AMM strategy **while staying in the maker's wallet**: the maker ships a SwapVM
program to 1inch Aqua, a third-party taker swap pulls/pushes real ERC-20
tokens, the flat fee accrues to the maker's strategy, and the maker docks the
strategy at the end.

## Strategy

Aqua-mode SwapVM order (`useAquaInsteadOfSignature: true`, no `DynamicBalances`
— balances come from `aqua.ship`):

```
program = Deadline(deadline) + FlatFeeAmountIn(0.3%) + XYCSwap + Salt
```

Instruction order follows swap-vm `docs/PROGRAMS.md` (controls first; fee must
precede swap-amount computation — `FeeShouldBeAppliedBeforeSwapAmountsComputation`).

The taker swaps via `useTransferFromAndAquaPush`, so the taker only needs an
ERC-20 approval to the router (no callback contract); the router itself does
`transferFrom` + `Aqua.push`, and the output leg is an `Aqua.pull` straight
from the maker's wallet.

Powered by Aqua — © Degensoft Ltd 2025. SwapVM — © Degensoft Ltd 2025.

## Run

```sh
cd contracts
./script/install-deps.sh    # fetches the pinned official dependencies into lib/
./script/demo.sh            # anvil up -> forge script --broadcast -> anvil down; log: evidence/demo.log
forge test -vv
```

Keys default to anvil's well-known dev accounts; override with
`DEPLOYER_PRIVATE_KEY` / `MAKER_PRIVATE_KEY` / `TAKER_PRIVATE_KEY`.

## Official contracts used (unmodified, pinned)

| Package | Repo | Ref | Commit |
| --- | --- | --- | --- |
| Aqua | 1inch/aqua | v1.0.0 | `81c26e4619ce21556ab02b3284ee2685de21fb18` |
| SwapVM | 1inch/swap-vm | v1.0.2 | `32c687c2b73101fc26549e48fa1ff8a4d73afbac` |
| solidity-utils | 1inch/solidity-utils | 6.9.7 | `29043f22422fde454951e9733129cce5d67e6a39` |
| OpenZeppelin contracts | OpenZeppelin/openzeppelin-contracts | v5.4.0 | `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0` |
| forge-std | foundry-rs/forge-std | v1.11.0 | `8e40513d678f392f398620b3ef2b418648b33e89` |

Installed into `lib/` by `script/install-deps.sh` (not committed; plain directories, no submodules).
`src/OtomoProgram.sol` uses swap-vm's `test/utils/ProgramBuilder.sol` to encode opcodes.

## Sepolia deployment

Aqua is not officially deployed on Sepolia, so `script/DeploySepolia.s.sol`
deploys the whole stack (Aqua, AquaSwapVMRouter, mWETH mock, OtomoProgram,
OtomoOrderBuilder). mUSDC is the existing ENS MockUSDC
(`0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e`, permissionless `mint`, 6dp).

```sh
DEPLOYER_PRIVATE_KEY=0x... forge script script/DeploySepolia.s.sol \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Writes `deployments/sepolia.json` (aqua / router / usdc / weth / encoder /
orderBuilder) — feed those into the app's `AQUA_*` / `MOCK_WETH_ADDRESS` env.

## License

Files that incorporate SwapVM / Aqua code are released under their licenses
(`LicenseRef-Degensoft-SwapVM-1.1`, `LicenseRef-Degensoft-Aqua-Source-1.1`; see `lib/*/LICENSES/`).
`src/mocks/MockERC20.sol` is MIT. Hackathon use is non-commercial.

## Files

- `src/OtomoProgram.sol` — encodes the SwapVM program via the Aqua opcode set.
- `src/OtomoOrderBuilder.sol` — on-chain order/taker-data encoder so the app
  never reimplements MakerTraits/TakerTraits packing in TypeScript.
- `script/DeploySepolia.s.sol` — deploys the stack to Sepolia → `deployments/sepolia.json`.
- `src/mocks/MockERC20.sol` — test ERC-20 (mUSDC 6dp, mWETH 18dp).
- `script/Demo.s.sol` — deploy → mint → ship → quote → swap → dock, with
  wallet + Aqua virtual balances logged at each step.
- `test/OtomoStrategy.t.sol` — asserts wallet/Aqua deltas, fee effect, deadline
  revert, and post-dock revert.
- `script/demo.sh` — one-command anvil demo; output saved to `evidence/demo.log`.
