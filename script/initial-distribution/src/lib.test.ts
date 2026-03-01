import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockWindows,
  ensureHex,
  iso8601ToTimestamp,
  paginatedGetEvents,
  requiredArgs,
  requireEnv,
  splitBy,
  zip,
} from "./lib.js";

describe("requireEnv", () => {
  it("returns the value when the env var is set", () => {
    const prev = process.env.TEST_REQUIRE_ENV;
    process.env.TEST_REQUIRE_ENV = "hello";
    try {
      assert.equal(requireEnv("TEST_REQUIRE_ENV"), "hello");
    } finally {
      if (prev === undefined) delete process.env.TEST_REQUIRE_ENV;
      else process.env.TEST_REQUIRE_ENV = prev;
    }
  });

  it("throws when the env var is not set", () => {
    delete process.env.TEST_REQUIRE_ENV_MISSING;
    assert.throws(() => requireEnv("TEST_REQUIRE_ENV_MISSING"), /Missing required env var/);
  });
});

describe("ensureHex", () => {
  it("passes through a valid 0x-prefixed hex string", () => {
    assert.equal(ensureHex("0xdeadbeef"), "0xdeadbeef");
  });

  it("adds 0x prefix when missing", () => {
    assert.equal(ensureHex("abcdef"), "0xabcdef");
  });

  it("normalizes uppercase 0X prefix", () => {
    assert.equal(ensureHex("0Xabc"), "0xabc");
  });

  it("accepts uppercase hex digits", () => {
    assert.equal(ensureHex("0xABCDEF"), "0xABCDEF");
  });

  it("throws on invalid characters", () => {
    assert.throws(() => ensureHex("0xZZZ"), /Invalid hex string/);
  });

  it("throws on empty string", () => {
    assert.throws(() => ensureHex(""), /Invalid hex string/);
  });

  it("throws on bare 0x prefix with no digits", () => {
    assert.throws(() => ensureHex("0x"), /Invalid hex string/);
  });
});

describe("requiredArgs", () => {
  it("returns all fields when none are undefined", () => {
    const result = requiredArgs({ args: { a: 1, b: "hello" } });
    assert.deepEqual(result, { a: 1, b: "hello" });
  });

  it("throws when a field is undefined", () => {
    assert.throws(() => requiredArgs({ args: { a: 1, b: undefined } }), /Missing event field/);
  });

  it("includes event name in error message", () => {
    assert.throws(
      () => requiredArgs({ args: { x: undefined }, eventName: "Transfer" }),
      /Transfer\.x/,
    );
  });
});

describe("splitBy", () => {
  it("splits mixed items", () => {
    const [evens, odds] = splitBy([1, 2, 3, 4, 5], (n) => n % 2 === 0);
    assert.deepEqual(evens, [2, 4]);
    assert.deepEqual(odds, [1, 3, 5]);
  });

  it("returns empty arrays for empty input", () => {
    const [yes, no] = splitBy([], () => true);
    assert.deepEqual(yes, []);
    assert.deepEqual(no, []);
  });

  it("puts everything in yes when all match", () => {
    const [yes, no] = splitBy([1, 2, 3], () => true);
    assert.deepEqual(yes, [1, 2, 3]);
    assert.deepEqual(no, []);
  });

  it("puts everything in no when none match", () => {
    const [yes, no] = splitBy([1, 2, 3], () => false);
    assert.deepEqual(yes, []);
    assert.deepEqual(no, [1, 2, 3]);
  });
});

describe("iso8601ToTimestamp", () => {
  it("parses a valid Zulu timestamp", () => {
    assert.equal(iso8601ToTimestamp("2026-02-05T15:00:00Z"), 1770303600n);
  });

  it("parses epoch", () => {
    assert.equal(iso8601ToTimestamp("1970-01-01T00:00:00Z"), 0n);
  });

  it("parses fractional seconds", () => {
    assert.equal(iso8601ToTimestamp("2026-02-05T15:00:00.500Z"), 1770303600n);
  });

  it("throws on missing Z suffix", () => {
    assert.throws(() => iso8601ToTimestamp("2026-02-05T15:00:00"), /Invalid ISO 8601/);
  });

  it("throws on non-Zulu timezone", () => {
    assert.throws(() => iso8601ToTimestamp("2026-02-05T15:00:00+01:00"), /Invalid ISO 8601/);
  });

  it("throws on malformed string", () => {
    assert.throws(() => iso8601ToTimestamp("not-a-date"), /Invalid ISO 8601/);
  });
});

describe("zip", () => {
  it("zips two equal-length arrays", () => {
    assert.deepEqual(zip([1, 2, 3], ["a", "b", "c"]), [
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
  });

  it("truncates to the shorter array", () => {
    assert.deepEqual(zip([1, 2], ["a", "b", "c"]), [
      [1, "a"],
      [2, "b"],
    ]);
    assert.deepEqual(zip([1, 2, 3], ["a"]), [[1, "a"]]);
  });

  it("returns empty array when either input is empty", () => {
    assert.deepEqual(zip([], [1, 2]), []);
    assert.deepEqual(zip([1, 2], []), []);
  });
});

describe("blockWindows", () => {
  it("returns a single window when from === to", () => {
    assert.deepEqual(blockWindows(100n, 100n, 10n), [{ fromBlock: 100n, toBlock: 100n }]);
  });

  it("returns a single window when range fits in one page", () => {
    assert.deepEqual(blockWindows(10n, 15n, 10n), [{ fromBlock: 10n, toBlock: 15n }]);
  });

  it("returns a single window when range equals page size", () => {
    assert.deepEqual(blockWindows(0n, 10n, 10n), [{ fromBlock: 0n, toBlock: 10n }]);
  });

  it("splits into multiple non-overlapping windows", () => {
    assert.deepEqual(blockWindows(0n, 21n, 10n), [
      { fromBlock: 0n, toBlock: 10n },
      { fromBlock: 11n, toBlock: 21n },
    ]);
  });

  it("handles range one more than a multiple of page size", () => {
    assert.deepEqual(blockWindows(0n, 22n, 10n), [
      { fromBlock: 0n, toBlock: 10n },
      { fromBlock: 11n, toBlock: 21n },
      { fromBlock: 22n, toBlock: 22n },
    ]);
  });
});

describe("paginatedGetEvents", () => {
  function mockFetcher(results: Map<string, string[]>) {
    return async (range: { fromBlock: bigint; toBlock: bigint }) => {
      const key = `${range.fromBlock}-${range.toBlock}`;
      return results.get(key) ?? [];
    };
  }

  it("returns all results in a single page", async () => {
    const results = new Map([["0-10000", ["a", "b"]]]);
    const out = await paginatedGetEvents(mockFetcher(results), 0n, 10000n);
    assert.deepEqual(out, ["a", "b"]);
  });

  it("concatenates results from multiple pages", async () => {
    const results = new Map([
      ["0-3", ["a"]],
      ["4-7", ["b"]],
      ["8-9", ["c"]],
    ]);
    const out = await paginatedGetEvents(mockFetcher(results), 0n, 9n, 3n);
    assert.deepEqual(out, ["a", "b", "c"]);
  });

  it("returns empty array when fetcher returns nothing", async () => {
    const out = await paginatedGetEvents(async () => [], 0n, 100n, 10n);
    assert.deepEqual(out, []);
  });

  it("handles single-block range", async () => {
    const results = new Map([["5-5", ["x"]]]);
    const out = await paginatedGetEvents(mockFetcher(results), 5n, 5n);
    assert.deepEqual(out, ["x"]);
  });

  it("limits concurrency to 5 concurrent fetches", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = async (range: { fromBlock: bigint; toBlock: bigint }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return [Number(range.fromBlock)];
    };

    const out = await paginatedGetEvents(fetcher, 0n, 6n, 0n);
    assert.equal(maxInFlight, 5);
    assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6]);
  });
});
