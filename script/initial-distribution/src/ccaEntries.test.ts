import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { EVMModality } from "./modalities.js";
import { buildExpectedEntries, type FilledBid, type Sweep } from "./ccaEntries.js";

const ADDR_A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
const ADDR_B = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as Address;
const ADDR_SWEEP = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" as Address;

const BOUNDARY = 100n;

function whaleBid(owner: Address, tokensFilled: bigint): FilledBid {
  return { owner, bidBlockNumber: BOUNDARY - 1n, tokensFilled };
}

function normalBid(owner: Address, tokensFilled: bigint): FilledBid {
  return { owner, bidBlockNumber: BOUNDARY + 1n, tokensFilled };
}

describe("buildExpectedEntries", () => {
  it("single owner, whale-only bids produce immediate + vested entries", () => {
    const entries = buildExpectedEntries([whaleBid(ADDR_A, 600n)], BOUNDARY, null);

    assert.equal(entries.length, 2);

    assert.equal(entries[0].kind, "tde");
    assert.equal(entries[0].modality, EVMModality.DIRECT);
    assert.equal(entries[0].to, ADDR_A);

    assert.equal(entries[1].kind, "tde");
    assert.equal(entries[1].modality, EVMModality.VESTED_1_5);
    assert.equal(entries[1].to, ADDR_A);

    assert.equal(
      entries[0].transferAmount + entries[1].transferAmount,
      720n, // 600 * 1.2 = 720
    );
  });

  it("single owner, normal-only bids produce one DIRECT entry", () => {
    const entries = buildExpectedEntries([normalBid(ADDR_A, 500n)], BOUNDARY, null);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, "tde");
    assert.equal(entries[0].modality, EVMModality.DIRECT);
    assert.equal(entries[0].to, ADDR_A);
    assert.equal(entries[0].transferAmount, 500n);
    assert.equal(entries[0].ccaAmount, 500n);
  });

  it("single owner, mixed whale + normal produces three entries", () => {
    const entries = buildExpectedEntries(
      [whaleBid(ADDR_A, 600n), normalBid(ADDR_A, 300n)],
      BOUNDARY,
      null,
    );

    assert.equal(entries.length, 3);
    assert.equal(entries[0].modality, EVMModality.DIRECT); // whale immediate
    assert.equal(entries[1].modality, EVMModality.VESTED_1_5); // whale vested
    assert.equal(entries[2].modality, EVMModality.DIRECT); // normal
    assert.equal(entries[2].transferAmount, 300n);
  });

  it("multiple owners produce entries sorted by address", () => {
    const entries = buildExpectedEntries(
      [normalBid(ADDR_B, 100n), normalBid(ADDR_A, 200n)],
      BOUNDARY,
      null,
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0].to, ADDR_A);
    assert.equal(entries[1].to, ADDR_B);
  });

  it("skips entries with zero amounts (dust whale with 0 immediate)", () => {
    // ccaWhale=3 -> disbursableWhale = 3*12000/10000 = 3, immediate = 3/6 = 0
    const entries = buildExpectedEntries([whaleBid(ADDR_A, 3n)], BOUNDARY, null);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].modality, EVMModality.VESTED_1_5);
  });

  it("appends sweep entry when sweep amount > 0", () => {
    const sweep: Sweep = { recipient: ADDR_SWEEP, amount: 1000n };
    const entries = buildExpectedEntries([normalBid(ADDR_A, 100n)], BOUNDARY, sweep);

    assert.equal(entries.length, 2);
    assert.equal(entries[1].kind, "sweep");
    assert.equal(entries[1].to, ADDR_SWEEP);
    assert.equal(entries[1].transferAmount, 1000n);
    assert.equal(entries[1].ccaAmount, 1000n);
  });

  it("empty filledBids with sweep produces only the sweep entry", () => {
    const sweep: Sweep = { recipient: ADDR_SWEEP, amount: 500n };
    const entries = buildExpectedEntries([], BOUNDARY, sweep);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, "sweep");
  });

  it("empty filledBids with no sweep produces empty array", () => {
    assert.deepEqual(buildExpectedEntries([], BOUNDARY, null), []);
  });

  it("skips sweep when amount is 0", () => {
    const sweep: Sweep = { recipient: ADDR_SWEEP, amount: 0n };
    const entries = buildExpectedEntries([], BOUNDARY, sweep);
    assert.deepEqual(entries, []);
  });

  it("ccaAmount tracks pre-bonus amounts for whale entries", () => {
    const entries = buildExpectedEntries([whaleBid(ADDR_A, 600n)], BOUNDARY, null);

    const totalCca = entries.reduce((s, e) => s + e.ccaAmount, 0n);
    assert.equal(totalCca, 600n);

    const totalTransfer = entries.reduce((s, e) => s + e.transferAmount, 0n);
    assert.equal(totalTransfer, 720n); // 600 * 1.2
  });
});
