import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getAddress } from "viem";
import { loadDisbursementCsv } from "./csv.js";
import { EVMModality } from "./modalities.js";

const VALID_ADDRESS = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";

let tempDir: string;

function writeCsv(content: string): string {
  const path = join(tempDir, "test.csv");
  writeFileSync(path, content, "utf8");
  return path;
}

describe("loadDisbursementCsv", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "csv-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses a valid CSV row", () => {
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${VALID_ADDRESS},1000,Masterlist\n`,
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].address, getAddress(VALID_ADDRESS));
    assert.equal(rows[0].modality, EVMModality.DIRECT);
    assert.equal(rows[0].amount, 1000n);
  });

  it("maps modalities to correct EVM IDs", () => {
    const path = writeCsv(
      [
        "Wallet address,Token amount 10e18,Modality",
        `${VALID_ADDRESS},100,SM - 0 - 12`,
        `${VALID_ADDRESS},200,SM - 6 - 24`,
      ].join("\n"),
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows[0].modality, EVMModality.VESTED_0_12);
    assert.equal(rows[1].modality, EVMModality.VESTED_6_24);
  });

  it("throws on unknown modality", () => {
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${VALID_ADDRESS},100,BogusModality\n`,
    );
    assert.throws(() => loadDisbursementCsv(path), /Unknown modalities/);
  });

  it("throws on invalid bigint in amount column", () => {
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${VALID_ADDRESS},not_a_number,Masterlist\n`,
    );
    assert.throws(() => loadDisbursementCsv(path), /Invalid BigInt/);
  });

  it("returns empty array for header-only CSV", () => {
    const path = writeCsv("Wallet address,Token amount 10e18,Modality\n");
    assert.deepEqual(loadDisbursementCsv(path), []);
  });

  it("trims whitespace from values", () => {
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n  ${VALID_ADDRESS}  ,  500  ,  Masterlist  \n`,
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 500n);
  });

  it("checksums addresses", () => {
    const lowercase = VALID_ADDRESS.toLowerCase();
    const path = writeCsv(
      `Wallet address,Token amount 10e18,Modality\n${lowercase},100,Masterlist\n`,
    );
    const rows = loadDisbursementCsv(path);
    assert.equal(rows[0].address, getAddress(lowercase));
  });
});
