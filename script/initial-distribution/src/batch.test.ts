import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { isDelegatedTo, isExecutionRevert } from "./batch.js";

describe("isDelegatedTo", () => {
  const TARGET = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
  const DELEGATED_CODE = `0xef0100${TARGET.slice(2).toLowerCase()}`;

  it("returns true for correctly formatted delegation code", () => {
    assert.equal(isDelegatedTo(DELEGATED_CODE, TARGET), true);
  });

  it("returns false for undefined code", () => {
    assert.equal(isDelegatedTo(undefined, TARGET), false);
  });

  it("returns false for empty code", () => {
    assert.equal(isDelegatedTo("0x", TARGET), false);
  });

  it("returns false when code has wrong prefix", () => {
    assert.equal(isDelegatedTo(`0xdeadbeef${TARGET.slice(2)}`, TARGET), false);
  });

  it("returns false when address does not match", () => {
    const OTHER = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as Address;
    assert.equal(isDelegatedTo(DELEGATED_CODE, OTHER), false);
  });

  it("handles checksummed address (code is lowercase)", () => {
    const checksummed = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
    const code = `0xef0100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    assert.equal(isDelegatedTo(code, checksummed), true);
  });
});

describe("isExecutionRevert", () => {
  it('matches "execution reverted"', () => {
    assert.equal(isExecutionRevert(new Error("execution reverted")), true);
  });

  it('matches "reverted"', () => {
    assert.equal(isExecutionRevert(new Error("Transaction reverted without a reason")), true);
  });

  it('matches "exceeds block gas limit"', () => {
    assert.equal(isExecutionRevert(new Error("exceeds block gas limit")), true);
  });

  it("matches ContractFunctionRevertedError by constructor name", () => {
    class ContractFunctionRevertedError extends Error {}
    assert.equal(isExecutionRevert(new ContractFunctionRevertedError("fail")), true);
  });

  it("returns false for non-Error values", () => {
    assert.equal(isExecutionRevert("string error"), false);
    assert.equal(isExecutionRevert(42), false);
    assert.equal(isExecutionRevert(null), false);
  });

  it("returns false for unrelated error messages", () => {
    assert.equal(isExecutionRevert(new Error("network timeout")), false);
    assert.equal(isExecutionRevert(new Error("rate limited")), false);
  });
});
