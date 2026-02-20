import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDisbursement, BPS_BASE, WHALE_IMMEDIATE_BPS } from "./computeDisbursement.js";

const e18 = 10n ** 18n;

function ccaWhaleSplit(ccaWhale: bigint) {
  const immediate = (ccaWhale * WHALE_IMMEDIATE_BPS) / BPS_BASE;
  return { immediate, vested: ccaWhale - immediate };
}

describe("computeDisbursement", () => {
  describe("whale 400 + normal 100 (the canonical example)", () => {
    const r = computeDisbursement(400n * e18, 100n * e18);

    it("preserves input CCA totals", () => {
      assert.equal(r.ccaWhale, 400n * e18);
      assert.equal(r.ccaNormal, 100n * e18);
    });

    it("applies 20% bonus to whale disbursable amounts", () => {
      assert.equal(r.disbursableWhaleImmediately, 120n * e18);
      assert.equal(r.disbursableWhaleVested, 360n * e18);
    });

    it("normal disbursable equals CCA normal (no bonus)", () => {
      assert.equal(r.disbursableNormalImmediately, 100n * e18);
    });

    it("tracker record amounts sum to full CCA allocation", () => {
      const { immediate, vested } = ccaWhaleSplit(r.ccaWhale);
      const trackerTotal = r.ccaNormal + immediate + vested;
      assert.equal(trackerTotal, 500n * e18);
    });

    it("actual token amounts include the bonus", () => {
      const actualTotal = r.disbursableNormalImmediately + r.disbursableWhaleImmediately + r.disbursableWhaleVested;
      assert.equal(actualTotal, 580n * e18);
    });

    it("disbursable amounts exceed CCA amounts for whale portions", () => {
      const { immediate, vested } = ccaWhaleSplit(r.ccaWhale);
      assert.notEqual(immediate, r.disbursableWhaleImmediately);
      assert.notEqual(vested, r.disbursableWhaleVested);
    });
  });

  describe("whale only (1000 tokens)", () => {
    const r = computeDisbursement(1000n * e18, 0n);

    it("has no normal portion", () => {
      assert.equal(r.ccaNormal, 0n);
      assert.equal(r.disbursableNormalImmediately, 0n);
    });

    it("applies 20% bonus", () => {
      assert.equal(r.disbursableWhaleImmediately, 300n * e18);
      assert.equal(r.disbursableWhaleVested, 900n * e18);
    });

    it("CCA whale split sums to original", () => {
      const { immediate, vested } = ccaWhaleSplit(r.ccaWhale);
      assert.equal(immediate + vested, 1000n * e18);
    });

    it("actual tokens are 120% of CCA amount", () => {
      assert.equal(r.disbursableWhaleImmediately + r.disbursableWhaleVested, 1200n * e18);
    });
  });

  describe("normal only (500 tokens)", () => {
    const r = computeDisbursement(0n, 500n * e18);

    it("has no whale portion", () => {
      assert.equal(r.ccaWhale, 0n);
      assert.equal(r.disbursableWhaleImmediately, 0n);
      assert.equal(r.disbursableWhaleVested, 0n);
    });

    it("normal tokens pass through 1:1 (no bonus, no vesting)", () => {
      assert.equal(r.disbursableNormalImmediately, 500n * e18);
    });
  });

  describe("zero tokens", () => {
    const r = computeDisbursement(0n, 0n);

    it("everything is zero", () => {
      assert.equal(r.ccaWhale, 0n);
      assert.equal(r.ccaNormal, 0n);
      assert.equal(r.disbursableWhaleImmediately, 0n);
      assert.equal(r.disbursableWhaleVested, 0n);
      assert.equal(r.disbursableNormalImmediately, 0n);
    });
  });

  describe("small amounts (dust-level precision)", () => {
    const r = computeDisbursement(3n, 0n);

    it("CCA whale split still sums to original", () => {
      const { immediate, vested } = ccaWhaleSplit(r.ccaWhale);
      assert.equal(immediate + vested, 3n);
    });

    it("no tokens are lost to rounding in CCA split", () => {
      const { immediate, vested } = ccaWhaleSplit(r.ccaWhale);
      assert.equal(immediate, 0n);
      assert.equal(vested, 3n);
    });
  });

  describe("invariants hold for arbitrary values", () => {
    const cases = [
      { whale: 1n, normal: 0n },
      { whale: 0n, normal: 1n },
      { whale: 7n, normal: 13n },
      { whale: 123_456_789n * e18, normal: 987_654_321n * e18 },
      { whale: e18 - 1n, normal: e18 + 1n },
    ];

    for (const { whale, normal } of cases) {
      it(`whale=${whale}, normal=${normal}`, () => {
        const r = computeDisbursement(whale, normal);

        const { immediate, vested } = ccaWhaleSplit(r.ccaWhale);
        assert.equal(
          immediate + vested, whale,
          "CCA immediate + vested must equal whale input",
        );

        assert.ok(
          r.disbursableWhaleImmediately >= immediate,
          "disbursable immediate must be >= CCA immediate",
        );
        assert.ok(
          r.disbursableWhaleVested >= vested,
          "disbursable vested must be >= CCA vested",
        );

        assert.equal(r.disbursableNormalImmediately, normal);
      });
    }
  });
});
