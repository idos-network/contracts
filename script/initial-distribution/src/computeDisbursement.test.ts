import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDisbursement } from "./computeDisbursement.js";

const e18 = 10n ** 18n;

describe("computeDisbursement", () => {
  describe("whale 400 + normal 100 (the canonical example)", () => {
    const r = computeDisbursement(400n * e18, 100n * e18);

    it("preserves input CCA totals", () => {
      assert.equal(r.ccaWhaleImmediate + r.ccaWhaleVested, 400n * e18);
      assert.equal(r.ccaNormal, 100n * e18);
    });

    it("applies 20% bonus and splits whale into 1/6 immediate and 5/6 vested", () => {
      assert.equal(r.disbursableWhaleImmediate, 80n * e18);
      assert.equal(r.disbursableWhaleVested, 400n * e18);
      assert.equal(r.disbursableWhaleImmediate + r.disbursableWhaleVested, 480n * e18);
    });

    it("splits CCA whale proportionally for tracker recording", () => {
      assert.equal(r.ccaWhaleImmediate, 66666666666666666666n);
      assert.equal(r.ccaWhaleVested, 400n * e18 - 66666666666666666666n);
    });

    it("normal disbursable equals CCA normal (no bonus)", () => {
      assert.equal(r.disbursableNormal, 100n * e18);
    });

    it("tracker record amounts sum to full CCA allocation", () => {
      const trackerTotal = r.ccaNormal + r.ccaWhaleImmediate + r.ccaWhaleVested;
      assert.equal(trackerTotal, 500n * e18);
    });

    it("actual token amounts include the bonus", () => {
      const actualTotal =
        r.disbursableNormal + r.disbursableWhaleImmediate + r.disbursableWhaleVested;
      assert.equal(actualTotal, 580n * e18);
    });
  });

  describe("whale only (1000 tokens)", () => {
    const r = computeDisbursement(1000n * e18, 0n);

    it("has no normal portion", () => {
      assert.equal(r.ccaNormal, 0n);
      assert.equal(r.disbursableNormal, 0n);
    });

    it("applies 20% bonus and splits into 1/6 immediate and 5/6 vested", () => {
      assert.equal(r.disbursableWhaleImmediate, 200n * e18);
      assert.equal(r.disbursableWhaleVested, 1000n * e18);
      assert.equal(r.disbursableWhaleImmediate + r.disbursableWhaleVested, 1200n * e18);
    });
  });

  describe("normal only (500 tokens)", () => {
    const r = computeDisbursement(0n, 500n * e18);

    it("has no whale portion", () => {
      assert.equal(r.ccaWhaleImmediate + r.ccaWhaleVested, 0n);
      assert.equal(r.disbursableWhaleImmediate, 0n);
      assert.equal(r.disbursableWhaleVested, 0n);
    });

    it("normal tokens pass through 1:1 (no bonus, no vesting)", () => {
      assert.equal(r.disbursableNormal, 500n * e18);
    });
  });

  it("everything is zero", () => {
    const r = computeDisbursement(0n, 0n);
    assert.equal(r.ccaWhaleImmediate, 0n);
    assert.equal(r.ccaWhaleVested, 0n);
    assert.equal(r.ccaNormal, 0n);
    assert.equal(r.disbursableWhaleImmediate, 0n);
    assert.equal(r.disbursableWhaleVested, 0n);
    assert.equal(r.disbursableNormal, 0n);
  });

  describe("small amounts", () => {
    [
      // under bonus impact of 1, makes everything vested
      {
        givenCcaWhale: 3n,
        expectedCcaWhaleImmediate: 0n,
        expectedCcaWhaleVested: 3n,
        expectedDisbursableWhaleBonus: 0n,
        expectedDisbursableWhaleImmediate: 0n,
        expectedDisbursableWhaleVested: 3n,
      },
      // at bonus impact of 1, bonus becomes immediate
      {
        givenCcaWhale: 5n,
        expectedCcaWhaleImmediate: 0n,
        expectedCcaWhaleVested: 5n,
        expectedDisbursableWhaleBonus: 1n,
        expectedDisbursableWhaleImmediate: 1n,
        expectedDisbursableWhaleVested: 5n,
      },
      {
        // over bonus impact boundary of 1, bonus becomes vested
        givenCcaWhale: 6n,
        expectedCcaWhaleImmediate: 1n,
        expectedCcaWhaleVested: 5n,
        expectedDisbursableWhaleBonus: 1n,
        expectedDisbursableWhaleImmediate: 1n,
        expectedDisbursableWhaleVested: 6n,
      },
      // under bonus impact of 2, makes everything vested
      {
        givenCcaWhale: 9n,
        expectedCcaWhaleImmediate: 1n,
        expectedCcaWhaleVested: 8n,
        expectedDisbursableWhaleBonus: 1n,
        expectedDisbursableWhaleImmediate: 1n,
        expectedDisbursableWhaleVested: 9n,
      },
      // at bonus impact of 2, bonus becomes immediate
      {
        givenCcaWhale: 10n,
        expectedCcaWhaleImmediate: 1n,
        expectedCcaWhaleVested: 9n,
        expectedDisbursableWhaleBonus: 2n,
        expectedDisbursableWhaleImmediate: 2n,
        expectedDisbursableWhaleVested: 10n,
      },
      {
        // over bonus impact boundary of 2, bonus becomes vested
        givenCcaWhale: 11n,
        expectedCcaWhaleImmediate: 1n,
        expectedCcaWhaleVested: 10n,
        expectedDisbursableWhaleBonus: 2n,
        expectedDisbursableWhaleImmediate: 2n,
        expectedDisbursableWhaleVested: 11n,
      },
    ].forEach(
      ({
        givenCcaWhale,
        expectedCcaWhaleImmediate,
        expectedCcaWhaleVested,
        expectedDisbursableWhaleBonus,
        expectedDisbursableWhaleImmediate,
        expectedDisbursableWhaleVested,
      }) => {
        it(`givenCcaWhale=${givenCcaWhale}, expectedCcaWhaleImmediate=${expectedCcaWhaleImmediate}, expectedCcaWhaleVested=${expectedCcaWhaleVested}, expectedDisbursableWhaleImmediate=${expectedDisbursableWhaleImmediate}, expectedDisbursableWhaleVested=${expectedDisbursableWhaleVested}`, () => {
          const r = computeDisbursement(givenCcaWhale, 0n);

          assert.equal(
            givenCcaWhale,
            expectedCcaWhaleImmediate + expectedCcaWhaleVested,
            "malformed expects on CCA split",
          );
          assert.equal(r.ccaWhaleImmediate, expectedCcaWhaleImmediate);
          assert.equal(r.ccaWhaleVested, expectedCcaWhaleVested);

          assert.equal(
            r.disbursableWhaleImmediate + r.disbursableWhaleVested - givenCcaWhale,
            expectedDisbursableWhaleBonus,
            "expectedDisbursableWhaleBonus mismatch",
          );
          assert.equal(
            expectedDisbursableWhaleImmediate + expectedDisbursableWhaleVested - givenCcaWhale,
            expectedDisbursableWhaleBonus,
            "malformed expects on disbursable whale bonus",
          );

          assert.equal(r.disbursableWhaleImmediate, expectedDisbursableWhaleImmediate);
          assert.equal(r.disbursableWhaleVested, expectedDisbursableWhaleVested);
        });
      },
    );
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

        assert.equal(r.ccaNormal, normal);
        assert.equal(r.disbursableNormal, normal);

        assert.equal(r.ccaWhaleImmediate + r.ccaWhaleVested, whale);
        assert.ok(
          r.disbursableWhaleImmediate + r.disbursableWhaleVested >=
            r.ccaWhaleImmediate + r.ccaWhaleVested,
          "disbursable whale must be larger than CCA whale",
        );
      });
    }
  });
});
