import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { type Address, getAddress } from "viem";
import {
  type EVMModality,
  isKnownModality,
  MODALITIES_TS_TO_EVM,
  type Modality,
} from "./modalities.js";

export type DisbursementRow = {
  address: Address;
  modality: EVMModality;
  amount: bigint;
};

type DisbursementCsvRow = {
  "Wallet address": string;
  "Token amount 10e18": string;
  Modality: string;
};

function parseBigInt(value: string): bigint {
  try {
    return BigInt(value.trim());
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid BigInt: "${value}"`);
    }
    throw error;
  }
}

export function loadDisbursementCsv(csvPath: string): DisbursementRow[] {
  const rows = parse(readFileSync(csvPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as DisbursementCsvRow[];

  const unknownModalities = rows
    .map((row) => row.Modality)
    .filter((modality) => !isKnownModality(modality));
  if (unknownModalities.length) {
    throw new Error(
      `Unknown modalities:\n${[...new Set(unknownModalities)].map((m) => `- "${m}"`).join("\n")}`,
    );
  }

  return rows.map((row) => ({
    address: getAddress(row["Wallet address"]),
    modality: MODALITIES_TS_TO_EVM[row.Modality as Modality],
    amount: parseBigInt(row["Token amount 10e18"]),
  }));
}
