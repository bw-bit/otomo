#!/usr/bin/env bash
# Installs the official, unmodified dependencies into lib/ at pinned commits.
# Idempotent; never creates submodules or commits in the parent repository.
set -euo pipefail
cd "$(dirname "$0")/.."

GIT=git
if ! git --version >/dev/null 2>&1; then GIT=/Library/Developer/CommandLineTools/usr/bin/git; fi

DEPS=(
  "aqua https://github.com/1inch/aqua.git 81c26e4619ce21556ab02b3284ee2685de21fb18"
  "swap-vm https://github.com/1inch/swap-vm.git 32c687c2b73101fc26549e48fa1ff8a4d73afbac"
  "solidity-utils https://github.com/1inch/solidity-utils.git 29043f22422fde454951e9733129cce5d67e6a39"
  "openzeppelin-contracts https://github.com/OpenZeppelin/openzeppelin-contracts.git c64a1edb67b6e3f4a15cca8909c9482ad33a02b0"
  "forge-std https://github.com/foundry-rs/forge-std.git 8e40513d678f392f398620b3ef2b418648b33e89"
)

mkdir -p lib
for dep in "${DEPS[@]}"; do
  read -r name url sha <<<"$dep"
  dir="lib/$name"
  if [[ -f "$dir/.pinned-commit" && "$(cat "$dir/.pinned-commit")" == "$sha" ]]; then
    echo "✓ $name already at $sha"
    continue
  fi
  rm -rf "$dir"
  tmp="$(mktemp -d)"
  "$GIT" init -q "$tmp"
  "$GIT" -C "$tmp" fetch -q --depth 1 "$url" "$sha"
  "$GIT" -C "$tmp" -c advice.detachedHead=false checkout -q FETCH_HEAD
  rm -rf "$tmp/.git"
  mv "$tmp" "$dir"
  echo "$sha" > "$dir/.pinned-commit"
  echo "✓ $name @ $sha"
done
