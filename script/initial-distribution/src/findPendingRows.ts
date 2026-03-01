import type { Address } from "viem";
import type { DisbursementRow } from "./csv.js";

function disbursementKey(beneficiary: Address, modality: number, amount: bigint): string {
  return `${beneficiary}-${modality}-${amount}`;
}

export function findPendingRows(
  rows: DisbursementRow[],
  logs: { beneficiary: Address; modality: number; amount: bigint }[],
): DisbursementRow[] {
  const logCountsByKey = new Map<string, number>();
  for (const log of logs) {
    const key = disbursementKey(log.beneficiary, log.modality, log.amount);

    logCountsByKey.set(key, (logCountsByKey.get(key) ?? 0) + 1);
  }

  const pendingRows: DisbursementRow[] = [];
  for (const row of rows) {
    const key = disbursementKey(row.address, row.modality, row.amount);

    const remaining = logCountsByKey.get(key) ?? 0;
    if (remaining > 0) {
      logCountsByKey.set(key, remaining - 1);
    } else {
      pendingRows.push(row);
    }
  }
  return pendingRows;
}
