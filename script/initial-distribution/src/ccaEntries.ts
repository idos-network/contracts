import type { Address } from "viem";
import { computeDisbursement } from "./computeDisbursement.js";
import { EVMModality } from "./modalities.js";
import { splitBy, sumOf } from "./lib.js";

export interface DisbursementEntry {
  kind: "tde" | "sweep";
  to: Address;
  transferAmount: bigint;
  ccaAmount: bigint;
  modality: EVMModality;
}

export interface FilledBid {
  owner: Address;
  bidBlockNumber: bigint;
  tokensFilled: bigint;
}

export interface Sweep {
  recipient: Address;
  amount: bigint;
}

export function buildExpectedEntries(
  filledBids: FilledBid[],
  phaseBoundaryBlock: bigint,
  sweep: Sweep | null,
): DisbursementEntry[] {
  const entries: DisbursementEntry[] = [];

  for (const addr of [...new Set(filledBids.map((b) => b.owner))].sort()) {
    const [whaleBids, normalBids] = splitBy(
      filledBids.filter((b) => b.owner === addr),
      (b) => b.bidBlockNumber < phaseBoundaryBlock,
    );

    const r = computeDisbursement(
      sumOf(whaleBids.map((b) => b.tokensFilled)),
      sumOf(normalBids.map((b) => b.tokensFilled)),
    );

    if (r.disbursableWhaleImmediate > 0n) {
      entries.push({
        kind: "tde",
        modality: EVMModality.DIRECT,
        to: addr,
        ccaAmount: r.ccaWhaleImmediate,
        transferAmount: r.disbursableWhaleImmediate,
      });
    }

    if (r.disbursableWhaleVested > 0n) {
      entries.push({
        kind: "tde",
        modality: EVMModality.VESTED_1_5,
        to: addr,
        ccaAmount: r.ccaWhaleVested,
        transferAmount: r.disbursableWhaleVested,
      });
    }

    if (r.ccaNormal > 0n) {
      entries.push({
        kind: "tde",
        modality: EVMModality.DIRECT,
        to: addr,
        ccaAmount: r.ccaNormal,
        transferAmount: r.disbursableNormal,
      });
    }
  }

  if (sweep && sweep.amount > 0n) {
    entries.push({
      kind: "sweep",
      modality: EVMModality.DIRECT,
      to: sweep.recipient,
      ccaAmount: sweep.amount,
      transferAmount: sweep.amount,
    });
  }

  return entries;
}
