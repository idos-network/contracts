/**
 * Binary search for the first block whose timestamp >= targetTimestamp.
 * Searches within [lo, hi] (inclusive). Returns the block number.
 *
 * @param targetTimestamp - Unix timestamp to search for.
 * @param lo - Lower bound block number (inclusive).
 * @param hi - Upper bound block number (inclusive).
 * @param getTimestamp - Async function that returns the timestamp of a block.
 */
export async function findFirstBlockAtOrAfter(
  targetTimestamp: bigint,
  lo: bigint,
  hi: bigint,
  getTimestamp: (blockNumber: bigint) => Promise<bigint>,
): Promise<bigint> {
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const ts = await getTimestamp(mid);
    if (ts >= targetTimestamp) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}
