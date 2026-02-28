#!/usr/bin/env bash
# Run cca-disburse against a local Anvil fork with the tracker's disburser patched to your key.
#
# Prereqs:
#   1. Anvil running with the right fork. For Eth Sepolia, e.g.:
#        anvil --fork-url "$SEPOLIA_RPC_URL" --fork-block-number 10322365
#      (or use ARBITRUM_SEPOLIA_RPC_URL / ARBITRUM_ONE_RPC_URL for Arbitrum chains)
#   2. script/cca-disburse/.env filled (TRACKER_TOKEN_ADDRESS, CCA_ADDRESS, DISBURSER_PRIVATE_KEY, etc.)
#
# This script:
#   1. Deploys a "patch" CCADisbursementTracker (same params, your DISBURSER_PRIVATE_KEY as disburser).
#   2. Replaces the tracker's bytecode on Anvil with that (anvil_setCode) so your key is the disburser.
#   3. Runs cca-disburse with RPC_URL=http://127.0.0.1:8545 so it talks to Anvil.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Load cca-disburse .env so we have TRACKER_TOKEN_ADDRESS, DISBURSER_PRIVATE_KEY, etc.
if [[ -f script/cca-disburse/.env ]]; then
  set -a
  # shellcheck source=../../.env
  source script/cca-disburse/.env
  set +a
else
  echo "Missing script/cca-disburse/.env"
  exit 1
fi

TRACKER_ADDRESS="${TRACKER_TOKEN_ADDRESS:?Set TRACKER_TOKEN_ADDRESS in script/cca-disburse/.env}"
# Derive disburser address from private key (strip 0x if present for cast)
KEY="${DISBURSER_PRIVATE_KEY:?Set DISBURSER_PRIVATE_KEY in script/cca-disburse/.env}"
KEY="${KEY#0x}"
PATCH_DISBURSER=$(cast wallet address "$KEY")
export TRACKER_ADDRESS PATCH_DISBURSER

LOCAL_RPC_URL="http://127.0.0.1:8545"

echo "Patching tracker at $TRACKER_ADDRESS so disburser is $PATCH_DISBURSER on Anvil..."

# Fund the disburser on the fork so they can pay for the patch deployment and later txs
# 10000 ether in wei (same order as Anvil’s default per-account balance)
cast rpc anvil_setBalance "[\"$PATCH_DISBURSER\", \"$(cast to-hex "$(cast to-wei 10_000 ether)")\"]" --raw --rpc-url "$LOCAL_RPC_URL" >/dev/null

# Deploy patch contract on Anvil (from disburser) and extract deployed address from output
FORGE_LOG=$(mktemp)
trap 'rm -f "$FORGE_LOG"' EXIT
forge script script/cca-disburse/PatchTrackerDisburser.s.sol --rpc-url "$LOCAL_RPC_URL" --broadcast --private-key "$DISBURSER_PRIVATE_KEY" | tee "$FORGE_LOG"
PATCH_ADDR=$(sed -n 's/.*Patch tracker deployed at: \(0x[0-9a-fA-F]*\).*/\1/p' "$FORGE_LOG")
CODE=$(cast code "$PATCH_ADDR" --rpc-url "$LOCAL_RPC_URL")
# Overwrite the existing tracker's bytecode with the patch (same logic, new disburser immutable)
cast rpc anvil_setCode "[\"$TRACKER_ADDRESS\", \"$CODE\"]" --raw --rpc-url "$LOCAL_RPC_URL" >/dev/null
echo "Tracker bytecode patched on Anvil."

cd script/cca-disburse
export RPC_URL="$LOCAL_RPC_URL"
pnpm run claim-all-bids
pnpm run run
