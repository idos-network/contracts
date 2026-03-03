#!/usr/bin/env bash
#
# Starts an Anvil fork of Arbitrum One, funds both disbursers with ETH and
# IDOS tokens, then runs claim-all-bids followed by cca.
#
# Private keys are read from the .env file as usual (TDE_DISBURSER_PRIVATE_KEY,
# TRACKER_DISBURSER_PRIVATE_KEY). This script only overrides RPC_URL to point
# at the local fork.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_RPC="http://127.0.0.1:${ANVIL_PORT}"

ARB1_RPC="https://arb1.arbitrum.io/rpc"
TDE_DISBURSEMENT=0xdf24F4Ca9984807577d13f5ef24eD26e5AFc7083
CCA_TRACKER=0xb628B89067E8f7Dfc2cB528a72BcfF7d5cEDcE29
CCA=0xc27F8a94Df88C4f57B09067e07EA6bC11CA47e11
IDOS_TOKEN=0x68731d6F14B827bBCfFbEBb62b19Daa18de1d79c

# ── Start Anvil ──────────────────────────────────────────────────────────────

echo "Starting Anvil fork of Arbitrum One..."
anvil --fork-url "$ARB1_RPC" --port "$ANVIL_PORT" &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT

ANVIL_WAIT_TIMEOUT=30
echo "Waiting for Anvil (port $ANVIL_PORT, timeout ${ANVIL_WAIT_TIMEOUT}s)..."
WAIT_START=$SECONDS
until cast block-number --rpc-url "$ANVIL_RPC" &>/dev/null; do
  if ! kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo "Error: Anvil (pid $ANVIL_PID) died before becoming ready on port $ANVIL_PORT."
    exit 1
  fi
  if (( SECONDS - WAIT_START >= ANVIL_WAIT_TIMEOUT )); then
    echo "Error: Anvil (pid $ANVIL_PID) not ready after ${ANVIL_WAIT_TIMEOUT}s on port $ANVIL_PORT."
    exit 1
  fi
  sleep 0.5
done
echo "Anvil ready (pid $ANVIL_PID)."

# ── Mock ArbSys and patch CCA so the auction appears ended ────────────────────
# Anvil doesn't emulate Arbitrum's ArbSys precompile at 0x64, so
# _getBlockNumberish() (used by CCA internally) would revert. We deploy a tiny
# mock that returns a uint256 from storage slot 0, then set that slot to a value
# past claimBlock. We also patch the CCA bytecode to lower its immutable
# endBlock/claimBlock so the TS-side eth_blockNumber check passes too.

ARBSYS=0x0000000000000000000000000000000000000064

CCA_END_BLOCK=$(cast call "$CCA" "endBlock()(uint256)" --rpc-url "$ANVIL_RPC" | awk '{print $1}')
CCA_CLAIM_BLOCK=$(cast call "$CCA" "claimBlock()(uint256)" --rpc-url "$ANVIL_RPC" | awk '{print $1}')
CURRENT_BLOCK=$(cast block-number --rpc-url "$ANVIL_RPC")

if [ "$CURRENT_BLOCK" -lt "$CCA_CLAIM_BLOCK" ]; then
  # Mock ArbSys: PUSH1_0 SLOAD PUSH1_0 MSTORE PUSH1_32 PUSH1_0 RETURN
  cast rpc anvil_setCode "$ARBSYS" 0x60005460005260206000f3 --rpc-url "$ANVIL_RPC" >/dev/null
  ARBSYS_BLOCK=$((CCA_CLAIM_BLOCK + 1000))
  cast rpc anvil_setStorageAt "$ARBSYS" 0x0 "$(cast abi-encode 'f(uint256)' $ARBSYS_BLOCK)" --rpc-url "$ANVIL_RPC" >/dev/null
  echo "ArbSys mock deployed (arbBlockNumber -> $ARBSYS_BLOCK)."

  PAST_BLOCK=$((CURRENT_BLOCK - 100))
  END_HEX=$(printf '%064x' "$CCA_END_BLOCK")
  CLAIM_HEX=$(printf '%064x' "$CCA_CLAIM_BLOCK")
  PAST_HEX=$(printf '%064x' "$PAST_BLOCK")

  echo "Patching CCA bytecode: endBlock $CCA_END_BLOCK -> $PAST_BLOCK, claimBlock $CCA_CLAIM_BLOCK -> $PAST_BLOCK"
  PATCHED_CODE=$(cast code "$CCA" --rpc-url "$ANVIL_RPC" | sed "s/$CLAIM_HEX/$PAST_HEX/g; s/$END_HEX/$PAST_HEX/g")
  cast rpc anvil_setCode "$CCA" "$PATCHED_CODE" --rpc-url "$ANVIL_RPC" >/dev/null

  echo "Verified endBlock: $(cast call "$CCA" "endBlock()(uint256)" --rpc-url "$ANVIL_RPC" | awk '{print $1}')"
  echo "Verified claimBlock: $(cast call "$CCA" "claimBlock()(uint256)" --rpc-url "$ANVIL_RPC" | awk '{print $1}')"
else
  echo "Already past CCA claimBlock ($CCA_CLAIM_BLOCK)."
fi

# ── Discover and fund disbursers ─────────────────────────────────────────────

TDE_DISBURSER=$(cast call "$TDE_DISBURSEMENT" "DISBURSER()(address)" --rpc-url "$ANVIL_RPC")
TRACKER_DISBURSER=$(cast call "$CCA_TRACKER" "disburser()(address)" --rpc-url "$ANVIL_RPC")
echo "TDE disburser:     $TDE_DISBURSER"
echo "Tracker disburser: $TRACKER_DISBURSER"

for addr in "$TDE_DISBURSER" "$TRACKER_DISBURSER"; do
  # 1000 ETH
  cast rpc anvil_setBalance "$addr" 0x3635C9ADC5DEA00000 --rpc-url "$ANVIL_RPC" >/dev/null
done
echo "Both disbursers funded with ETH."

# Fund TDE disburser with IDOS tokens (OZ ERC20: _balances mapping at slot 0)
BALANCE_SLOT=$(cast index address "$TDE_DISBURSER" 0)
EXPECTED_TOKEN_AMOUNT=$(cast to-wei 100000000)
TOKEN_AMOUNT_HEX=$(cast abi-encode "f(uint256)" "$EXPECTED_TOKEN_AMOUNT")
cast rpc anvil_setStorageAt "$IDOS_TOKEN" "$BALANCE_SLOT" "$TOKEN_AMOUNT_HEX" --rpc-url "$ANVIL_RPC" >/dev/null

ACTUAL_BALANCE=$(cast call "$IDOS_TOKEN" "balanceOf(address)(uint256)" "$TDE_DISBURSER" --rpc-url "$ANVIL_RPC" | awk '{print $1}')
if [ "$ACTUAL_BALANCE" != "$EXPECTED_TOKEN_AMOUNT" ]; then
  echo "Error: IDOS token funding failed (storage-layout drift?)."
  echo "  IDOS_TOKEN:    $IDOS_TOKEN"
  echo "  TDE_DISBURSER: $TDE_DISBURSER"
  echo "  Expected:      $EXPECTED_TOKEN_AMOUNT"
  echo "  Actual:        $ACTUAL_BALANCE"
  exit 1
fi
echo "TDE disburser IDOS balance: $ACTUAL_BALANCE"

# ── Run scripts ──────────────────────────────────────────────────────────────

cd "$SCRIPT_DIR"

: "${TDE_DISBURSER_PRIVATE_KEY:?must be set to the tde_disburser private key}"
if [ "$(cast wallet address --private-key "$TDE_DISBURSER_PRIVATE_KEY")" != "$TDE_DISBURSER" ]; then
  echo "Error: TDE disburser private key does not have the expected address $TDE_DISBURSER"
  echo "Expected: $TDE_DISBURSER"
  echo "Actual: $(cast wallet address --private-key "$TDE_DISBURSER_PRIVATE_KEY")"
  exit 1
fi

: "${TRACKER_DISBURSER_PRIVATE_KEY:?must be set to the tracker_disburser private key}"
if [ "$(cast wallet address --private-key "$TRACKER_DISBURSER_PRIVATE_KEY")" != "$TRACKER_DISBURSER" ]; then
  echo "Error: Tracker disburser private key does not have the expected address $TRACKER_DISBURSER"
  echo "Expected: $TRACKER_DISBURSER"
  echo "Actual: $(cast wallet address --private-key "$TRACKER_DISBURSER_PRIVATE_KEY")"
  exit 1
fi

echo "TDE and tracker disbursers private keys set successfully."

echo "=== claim-all-bids ==="
RPC_URL="$ANVIL_RPC" pnpm run claim-all-bids

echo ""
echo "=== cca ==="
RPC_URL="$ANVIL_RPC" pnpm run cca

echo ""
echo "=== Fork run completed ==="
