import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import type { DisbursementRow } from "./csv.js";
import { findPendingRows } from "./findPendingRows.js";
import { EVMModality } from "./modalities.js";

const ADDR_A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
const ADDR_B = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as Address;

function row(address: Address, modality: EVMModality, amount: bigint): DisbursementRow {
  return { address, modality, amount };
}

function log(beneficiary: Address, modality: number, amount: bigint) {
  return { beneficiary, modality, amount };
}

describe("findPendingRows", () => {
  it("returns all rows when logs are empty", () => {
    const rows = [
      row(ADDR_A, EVMModality.DIRECT, 100n),
      row(ADDR_B, EVMModality.VESTED_0_12, 200n),
    ];
    assert.deepEqual(findPendingRows(rows, []), rows);
  });

  it("returns empty when every row has a matching log", () => {
    const rows = [
      row(ADDR_A, EVMModality.DIRECT, 100n),
      row(ADDR_B, EVMModality.VESTED_0_12, 200n),
    ];
    const logs = [
      log(ADDR_A, EVMModality.DIRECT, 100n),
      log(ADDR_B, EVMModality.VESTED_0_12, 200n),
    ];
    assert.deepEqual(findPendingRows(rows, logs), []);
  });

  it("returns only unmatched rows for partial match", () => {
    const rows = [
      row(ADDR_A, EVMModality.DIRECT, 100n),
      row(ADDR_B, EVMModality.VESTED_0_12, 200n),
    ];
    const logs = [log(ADDR_A, EVMModality.DIRECT, 100n)];
    assert.deepEqual(findPendingRows(rows, logs), [row(ADDR_B, EVMModality.VESTED_0_12, 200n)]);
  });

  it("handles duplicate rows with count-based matching", () => {
    const rows = [
      row(ADDR_A, EVMModality.DIRECT, 100n),
      row(ADDR_A, EVMModality.DIRECT, 100n),
      row(ADDR_A, EVMModality.DIRECT, 100n),
    ];
    const logs = [log(ADDR_A, EVMModality.DIRECT, 100n), log(ADDR_A, EVMModality.DIRECT, 100n)];
    assert.deepEqual(findPendingRows(rows, logs), [row(ADDR_A, EVMModality.DIRECT, 100n)]);
  });

  it("ignores extra logs with no matching row", () => {
    const rows = [row(ADDR_A, EVMModality.DIRECT, 100n)];
    const logs = [
      log(ADDR_A, EVMModality.DIRECT, 100n),
      log(ADDR_B, EVMModality.VESTED_0_12, 999n),
    ];
    assert.deepEqual(findPendingRows(rows, logs), []);
  });

  it("returns empty for empty rows input", () => {
    assert.deepEqual(findPendingRows([], [log(ADDR_A, EVMModality.DIRECT, 100n)]), []);
  });

  it("distinguishes by modality", () => {
    const rows = [
      row(ADDR_A, EVMModality.DIRECT, 100n),
      row(ADDR_A, EVMModality.VESTED_0_12, 100n),
    ];
    const logs = [log(ADDR_A, EVMModality.DIRECT, 100n)];
    assert.deepEqual(findPendingRows(rows, logs), [row(ADDR_A, EVMModality.VESTED_0_12, 100n)]);
  });

  it("distinguishes by amount", () => {
    const rows = [row(ADDR_A, EVMModality.DIRECT, 100n), row(ADDR_A, EVMModality.DIRECT, 200n)];
    const logs = [log(ADDR_A, EVMModality.DIRECT, 100n)];
    assert.deepEqual(findPendingRows(rows, logs), [row(ADDR_A, EVMModality.DIRECT, 200n)]);
  });
});
