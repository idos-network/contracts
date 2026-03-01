import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iso8601ToTimestamp } from "./lib.js";
import { EVMModality, isKnownModality, MODALITIES, MODALITIES_TS_TO_EVM } from "./modalities.js";

describe("isKnownModality", () => {
  for (const name of Object.keys(MODALITIES)) {
    it(`returns true for "${name}"`, () => {
      assert.equal(isKnownModality(name), true);
    });
  }

  for (const unknown of ["Unknown", "", "masterlist", "DIRECT", "SM-0-12"]) {
    it(`returns false for "${unknown}"`, () => {
      assert.equal(isKnownModality(unknown), false);
    });
  }
});

describe("EVMModality matches Solidity enum Modality in TDEDisbursement.sol", () => {
  const solidityEnum = [
    "DIRECT",
    "VESTED_0_12",
    "VESTED_0_120",
    "VESTED_1_5",
    "VESTED_1_6",
    "VESTED_1_60",
    "VESTED_6_12",
    "VESTED_6_24",
    "VESTED_12_24",
    "VESTED_12_36",
  ] as const;

  it("has the same number of variants", () => {
    assert.equal(Object.keys(EVMModality).length, solidityEnum.length);
  });

  for (const [ordinal, name] of solidityEnum.entries()) {
    it(`${name} = ${ordinal}`, () => {
      assert.equal(
        EVMModality[name],
        ordinal,
        `EVMModality.${name} should be ${ordinal}`,
      );
    });
  }
});

describe("MODALITIES timestamps match VESTING_PARAMS_FOR_MODALITY in TDEDisbursement.sol", () => {
  // Hardcoded from TDEDisbursement.sol VESTING_PARAMS_FOR_MODALITY.
  // These params live in function logic, not in the ABI, so we can't
  // read them from Forge artifacts the way abiChecker.ts does. If the
  // Solidity params change, this table must be updated manually.
  // Each entry: [startTimestamp, durationSeconds, cliffSeconds]
  const solidityParams: Record<string, [bigint, bigint, bigint]> = {
    VESTED_0_12: [1770303600n, 31536000n, 2419200n],
    VESTED_0_120: [1770303600n, 315532800n, 2419200n],
    VESTED_1_5: [1772722800n, 13219200n, 2678400n],
    VESTED_1_6: [1772722800n, 15897600n, 2678400n],
    VESTED_1_60: [1772722800n, 157766400n, 2678400n],
    VESTED_6_12: [1785942000n, 31536000n, 2678400n],
    VESTED_6_24: [1785942000n, 63158400n, 2678400n],
    VESTED_12_24: [1801839600n, 63158400n, 2419200n],
    VESTED_12_36: [1801839600n, 94694400n, 2419200n],
  };

  const evmModalityNames = Object.fromEntries(
    Object.entries(EVMModality).map(([name, id]) => [id, name]),
  );

  for (const [tsModality, timestamps] of Object.entries(MODALITIES)) {
    if (timestamps === null) continue;

    const evmId = MODALITIES_TS_TO_EVM[tsModality as keyof typeof MODALITIES_TS_TO_EVM];
    const evmName = evmModalityNames[evmId];

    if (evmName === "DIRECT") continue;

    const params = solidityParams[evmName];
    if (!params) throw new Error(`Missing Solidity params for ${evmName}`);

    const [startTimestamp, durationSeconds, cliffSeconds] = params;
    const [vestingStartIso, cliffEndIso, vestingEndIso] = timestamps;

    it(`"${tsModality}" (${evmName}): vestingStart matches startTimestamp`, () => {
      assert.equal(
        iso8601ToTimestamp(vestingStartIso),
        startTimestamp,
      );
    });

    it(`"${tsModality}" (${evmName}): cliffEnd matches startTimestamp + cliffSeconds`, () => {
      assert.equal(
        iso8601ToTimestamp(cliffEndIso),
        startTimestamp + cliffSeconds,
      );
    });

    it(`"${tsModality}" (${evmName}): vestingEnd matches startTimestamp + durationSeconds`, () => {
      assert.equal(
        iso8601ToTimestamp(vestingEndIso),
        startTimestamp + durationSeconds,
      );
    });
  }
});
