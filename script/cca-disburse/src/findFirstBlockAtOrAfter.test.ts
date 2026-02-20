import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findFirstBlockAtOrAfter } from "./findFirstBlockAtOrAfter.js";

function mockGetTimestamp(timestamps: Record<string, bigint>) {
  return async (blockNumber: bigint) => {
    const ts = timestamps[blockNumber.toString()];
    if (ts === undefined) throw new Error(`No mock timestamp for block ${blockNumber}`);
    return ts;
  };
}

// Blocks 10..15 with timestamps 100, 110, 120, 130, 140, 150
const BLOCKS: Record<string, bigint> = {
  "10": 100n,
  "11": 110n,
  "12": 120n,
  "13": 130n,
  "14": 140n,
  "15": 150n,
};

describe("findFirstBlockAtOrAfter", () => {
  it("returns the exact block when target matches a block timestamp", async () => {
    const result = await findFirstBlockAtOrAfter(120n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 12n);
  });

  it("returns the next block when target falls between two timestamps", async () => {
    // target 115 is between block 11 (110) and block 12 (120)
    const result = await findFirstBlockAtOrAfter(115n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 12n);
  });

  it("returns lo when target is at or before the first block", async () => {
    const result = await findFirstBlockAtOrAfter(100n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 10n);
  });

  it("returns lo when target is before all blocks", async () => {
    const result = await findFirstBlockAtOrAfter(50n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 10n);
  });

  it("returns hi when target matches the last block", async () => {
    const result = await findFirstBlockAtOrAfter(150n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 15n);
  });

  it("returns hi when target is between second-to-last and last", async () => {
    // target 145 is between block 14 (140) and block 15 (150)
    const result = await findFirstBlockAtOrAfter(145n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 15n);
  });

  it("returns lo when lo == hi (single block range)", async () => {
    const result = await findFirstBlockAtOrAfter(120n, 12n, 12n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 12n);
  });

  it("works with a two-block range, target at first", async () => {
    const result = await findFirstBlockAtOrAfter(100n, 10n, 11n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 10n);
  });

  it("works with a two-block range, target at second", async () => {
    const result = await findFirstBlockAtOrAfter(110n, 10n, 11n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 11n);
  });

  it("works with a two-block range, target between them", async () => {
    const result = await findFirstBlockAtOrAfter(105n, 10n, 11n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 11n);
  });

  it("handles non-uniform timestamp gaps", async () => {
    const irregular: Record<string, bigint> = {
      "0": 10n,
      "1": 11n,
      "2": 12n,
      "3": 50n, // big jump
      "4": 51n,
      "5": 100n, // another big jump
    };
    // target 30 should land on block 3 (first with ts >= 30)
    const result = await findFirstBlockAtOrAfter(30n, 0n, 5n, mockGetTimestamp(irregular));
    assert.equal(result, 3n);
  });

  it("handles target past all blocks (returns hi)", async () => {
    // target 200 is past block 15 (150). Binary search converges to hi.
    // This is the edge case the caller must guard against.
    const result = await findFirstBlockAtOrAfter(200n, 10n, 15n, mockGetTimestamp(BLOCKS));
    assert.equal(result, 15n);
  });
});
