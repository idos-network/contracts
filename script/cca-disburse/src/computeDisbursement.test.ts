import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDisbursement } from "./computeDisbursement.js";

const e18 = 10n ** 18n;

describe("computeDisbursement", () => {
  describe("whale 400 + normal 100 (the canonical example)", () => {
    const r = computeDisbursement(400n * e18, 100n * e18);

    it("preserves input CCA totals", () => {
      assert.equal(r.ccaWhale, 400n * e18);
      assert.equal(r.ccaNormal, 100n * e18);
    });

    it("applies 20% bonus to whale disbursable amount", () => {
      assert.equal(r.disbursableWhale, 480n * e18);
    });

    it("normal disbursable equals CCA normal (no bonus)", () => {
      assert.equal(r.disbursableNormal, 100n * e18);
    });

    it("tracker record amounts sum to full CCA allocation", () => {
      const trackerTotal = r.ccaNormal + r.ccaWhale;
      assert.equal(trackerTotal, 500n * e18);
    });

    it("actual token amounts include the bonus", () => {
      const actualTotal = r.disbursableNormal + r.disbursableWhale;
      assert.equal(actualTotal, 580n * e18);
    });

    it("disbursable exceeds CCA amount for whale portion", () => {
      assert.notEqual(r.ccaWhale, r.disbursableWhale);
    });
  });

  describe("whale only (1000 tokens)", () => {
    const r = computeDisbursement(1000n * e18, 0n);

    it("has no normal portion", () => {
      assert.equal(r.ccaNormal, 0n);
      assert.equal(r.disbursableNormal, 0n);
    });

    it("applies 20% bonus", () => {
      assert.equal(r.disbursableWhale, 1200n * e18);
    });
  });

  describe("normal only (500 tokens)", () => {
    const r = computeDisbursement(0n, 500n * e18);

    it("has no whale portion", () => {
      assert.equal(r.ccaWhale, 0n);
      assert.equal(r.disbursableWhale, 0n);
    });

    it("normal tokens pass through 1:1 (no bonus, no vesting)", () => {
      assert.equal(r.disbursableNormal, 500n * e18);
    });
  });

  describe("zero tokens", () => {
    const r = computeDisbursement(0n, 0n);

    it("everything is zero", () => {
      assert.equal(r.ccaWhale, 0n);
      assert.equal(r.ccaNormal, 0n);
      assert.equal(r.disbursableWhale, 0n);
      assert.equal(r.disbursableNormal, 0n);
    });
  });

  describe("small amounts (dust-level precision)", () => {
    const r = computeDisbursement(3n, 0n);

    it("CCA whale is preserved", () => {
      assert.equal(r.ccaWhale, 3n);
    });

    it("bonus is truncated for dust amounts", () => {
      // 3 * 12000 / 10000 = 3 (integer division)
      assert.equal(r.disbursableWhale, 3n);
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

        assert.equal(r.ccaWhale, whale);
        assert.equal(r.ccaNormal, normal);

        assert.ok(r.disbursableWhale >= r.ccaWhale, "disbursable whale must be >= CCA whale");

        assert.equal(r.disbursableNormal, normal);
      });
    }
  });
});
