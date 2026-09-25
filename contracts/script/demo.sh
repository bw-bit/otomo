#!/usr/bin/env bash
# Run the Otomo Aqua + SwapVM demo on a local anvil chain.
# Starts anvil, broadcasts script/Demo.s.sol, saves the log to evidence/demo.log,
# then stops anvil.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p evidence

export PATH="$PATH:$HOME/.foundry/bin"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

anvil --port 8545 --silent &
ANVIL_PID=$!
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
    if cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then break; fi
    sleep 0.2
done

forge script script/Demo.s.sol:Demo \
    --rpc-url "$RPC_URL" \
    --broadcast \
    -vvv 2>&1 | tee evidence/demo.log
