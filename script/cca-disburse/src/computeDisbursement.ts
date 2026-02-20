export const BPS_BASE = 100_00n; // 100.00%
export const WHALE_BONUS_BPS = 20_00n; // 20.00% bonus
export const WHALE_IMMEDIATE_BPS = 25_00n; // 25.00% of bonus-adjusted total

export interface BidderDisbursement {
  ccaWhale: bigint;
  ccaNormal: bigint;
  disbursableWhaleImmediately: bigint;
  disbursableWhaleVested: bigint;
  disbursableNormalImmediately: bigint;
}

/**
 * Computes the disbursement breakdown for a single bidder given their
 * CCA token allocations from each phase.
 *
 * The tracker only sees pre-bonus CCA amounts. The actual token movements
 * include the 20% whale bonus, so tx amounts intentionally differ from
 * tracker record amounts.
 */
export function computeDisbursement(
  ccaWhale: bigint,
  ccaNormal: bigint,
): BidderDisbursement {
  const ccaWhaleImmediate = (ccaWhale * WHALE_IMMEDIATE_BPS) / BPS_BASE;
  const ccaWhaleVested = ccaWhale - ccaWhaleImmediate;

  const bonusMultiplier = BPS_BASE + WHALE_BONUS_BPS;

  return {
    ccaWhale,
    ccaNormal,
    disbursableWhaleImmediately: (ccaWhaleImmediate * bonusMultiplier) / BPS_BASE,
    disbursableWhaleVested: (ccaWhaleVested * bonusMultiplier) / BPS_BASE,
    disbursableNormalImmediately: ccaNormal,
  };
}
