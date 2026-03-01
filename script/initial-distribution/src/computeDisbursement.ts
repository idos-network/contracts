export const BPS_BASE = 100_00n; // 100.00%
export const WHALE_BONUS_BPS = 20_00n; // 20.00% bonus
const WHALE_BONUS_MULTIPLIER = BPS_BASE + WHALE_BONUS_BPS; // 120.00%

export interface BidderDisbursement {
  ccaWhaleImmediate: bigint;
  ccaWhaleVested: bigint;
  disbursableWhaleImmediate: bigint;
  disbursableWhaleVested: bigint;
  ccaNormal: bigint;
  disbursableNormal: bigint;
}

/**
 * Computes the disbursement breakdown for a single bidder given their
 * CCA token allocations from each phase.
 *
 * The tracker only sees pre-bonus CCA amounts. The actual token movements
 * include the 20% whale bonus, so tx amounts intentionally differ from
 * tracker record amounts. The 1/6 immediate + 5/6 vested split mirrors what
 * WhaleDisburser used to do on-chain.
 */
export function computeDisbursement(ccaWhale: bigint, ccaNormal: bigint): BidderDisbursement {
  const ccaWhaleImmediate = ccaWhale / 6n;
  const ccaWhaleVested = ccaWhale - ccaWhaleImmediate;

  const disbursableWhale = (ccaWhale * WHALE_BONUS_MULTIPLIER) / BPS_BASE;
  const disbursableWhaleImmediate = disbursableWhale / 6n;
  const disbursableWhaleVested = disbursableWhale - disbursableWhaleImmediate;

  return {
    ccaWhaleImmediate,
    ccaWhaleVested,
    ccaNormal,
    disbursableWhaleImmediate,
    disbursableWhaleVested,
    disbursableNormal: ccaNormal,
  };
}
