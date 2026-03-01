import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abiItemSignature, checkAbiAgainstArtifact } from "./abiChecker.js";

describe("abiItemSignature", () => {
  it("returns function signature for function items", () => {
    const item = {
      type: "function",
      name: "transfer",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    };
    assert.equal(abiItemSignature(item), "transfer(address,uint256)");
  });

  it("returns event signature for event items", () => {
    const item = {
      type: "event",
      name: "Transfer",
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ],
    };
    assert.equal(abiItemSignature(item), "Transfer(address,address,uint256)");
  });

  it("returns JSON for other types", () => {
    const item = { type: "error", name: "Unauthorized" };
    assert.equal(abiItemSignature(item), JSON.stringify(item));
  });
});

describe("checkAbiAgainstArtifact", () => {
  const transferFn = {
    type: "function" as const,
    name: "transfer" as const,
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  };

  const approvalEvent = {
    type: "event" as const,
    name: "Approval" as const,
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  };

  it("passes when static ABI is a subset of artifact", () => {
    const staticAbi = [transferFn];
    const artifact = { abi: [transferFn, approvalEvent] };
    assert.doesNotThrow(() => checkAbiAgainstArtifact(staticAbi, artifact));
  });

  it("passes when both sides match exactly", () => {
    const staticAbi = [transferFn, approvalEvent];
    const artifact = { abi: [transferFn, approvalEvent] };
    assert.doesNotThrow(() => checkAbiAgainstArtifact(staticAbi, artifact));
  });

  it("throws when a name is missing from artifact", () => {
    const staticAbi = [transferFn];
    const artifact = { abi: [approvalEvent] };
    assert.throws(
      () => checkAbiAgainstArtifact(staticAbi, artifact),
      /artifact missing function:transfer/,
    );
  });

  it("throws when signatures differ (same name, different params)", () => {
    const staticAbi = [transferFn];
    const differentTransfer = {
      ...transferFn,
      inputs: [{ name: "to", type: "address" }],
    };
    const artifact = { abi: [differentTransfer] };
    assert.throws(
      () => checkAbiAgainstArtifact(staticAbi, artifact),
      /signature differs/,
    );
  });

  it("skips entries without a name", () => {
    const staticAbi = [{ type: "constructor" as const }];
    const artifact = { abi: [] };
    assert.doesNotThrow(() => checkAbiAgainstArtifact(staticAbi, artifact));
  });
});
