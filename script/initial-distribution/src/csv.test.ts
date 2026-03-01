import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import { getAddress } from "viem";
import { loadDisbursementCsv } from "./csv.js";

const VALID_ADDRESS = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";

let tempDir: string;

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), "csv-test-"));
}

function writeCsv(content: string): string {
  const path = join(tempDir, "test.csv");
  writeFileSync(path, content, "utf8");
  return path;
}

describe("loadDisbursementCsv", () => {
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses a valid CSV row", () => {
    setup();
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${VALID_ADDRESS},1000,Masterlist\n`,
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].address, getAddress(VALID_ADDRESS));
    assert.equal(rows[0].modality, 0); // DIRECT
    assert.equal(rows[0].amount, 1000n);
  });

  it("maps modalities to correct EVM IDs", () => {
    setup();
    const path = writeCsv(
      [
        "Wallet address,Token amount 10e18,Modality",
        `${VALID_ADDRESS},100,SM - 0 - 12`,
        `${VALID_ADDRESS},200,SM - 6 - 24`,
      ].join("\n"),
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows[0].modality, 1); // VESTED_0_12
    assert.equal(rows[1].modality, 7); // VESTED_6_24
  });

  it("throws on unknown modality", () => {
    setup();
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${VALID_ADDRESS},100,BogusModality\n`,
    );
    assert.throws(() => loadDisbursementCsv(path), /Unknown modalities/);
  });

  it("throws on invalid bigint in amount column", () => {
    setup();
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${VALID_ADDRESS},not_a_number,Masterlist\n`,
    );
    assert.throws(() => loadDisbursementCsv(path), /Invalid BigInt/);
  });

  it("returns empty array for header-only CSV", () => {
    setup();
    const path = writeCsv("Wallet address,Token amount 10e18,Modality\n");
    assert.deepEqual(loadDisbursementCsv(path), []);
  });

  it("trims whitespace from values", () => {
    setup();
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n  ${VALID_ADDRESS}  ,  500  ,  Masterlist  \n`,
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 500n);
  });

  it("checksums addresses", () => {
    setup();
    const lowercase = VALID_ADDRESS.toLowerCase();
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${lowercase},100,Masterlist\n`,
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows[0].address, getAddress(lowercase));
  });
});
