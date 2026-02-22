export const BPS_BASE = 100_00n; // 100.00%
export const WHALE_BONUS_BPS = 20_00n; // 20.00% bonus

export interface BidderDisbursement {
  ccaWhale: bigint;
  ccaNormal: bigint;
  disbursableWhale: bigint;
  disbursableNormal: bigint;
}

/**
 * Computes the disbursement breakdown for a single bidder given their
 * CCA token allocations from each phase.
 *
 * The tracker only sees pre-bonus CCA amounts. The actual token movements
 * include the 20% whale bonus, so tx amounts intentionally differ from
 * tracker record amounts. The 1/6 immediate + 5/6 vested split is handled
 * on-chain by the WhaleDisburser contract.
 */
export function computeDisbursement(
  ccaWhale: bigint,
  ccaNormal: bigint,
): BidderDisbursement {
  const bonusMultiplier = BPS_BASE + WHALE_BONUS_BPS;

  return {
    ccaWhale,
    ccaNormal,
    disbursableWhale: (ccaWhale * bonusMultiplier) / BPS_BASE,
    disbursableNormal: ccaNormal,
  };
}
