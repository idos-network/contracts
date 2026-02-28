import { type Address, type PublicClient, encodeFunctionData, zeroAddress } from "viem";
import { tdeDisbursementAbi } from "./abis.js";
import { type BatchCall, type BatchCallerConfig, executeInGasFilledBatches } from "./batch.js";
import type { EVMModality } from "./modalities.js";

export type VestingEntry = { address: Address; modality: EVMModality };

export async function readVestingContracts(
  publicClient: PublicClient,
  tdeDisbursementAddress: Address,
  entries: VestingEntry[],
  chunkSize: number,
): Promise<Address[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, got ${chunkSize}`);
  }

  const chunks = Array.from({ length: Math.ceil(entries.length / chunkSize) }, (_, i) =>
    entries.slice(i * chunkSize, (i + 1) * chunkSize),
  );

  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      publicClient.multicall({
        contracts: chunk.map(({ address, modality }) => ({
          address: tdeDisbursementAddress,
          abi: tdeDisbursementAbi,
          functionName: "vestingContracts" as const,
          args: [address, modality] as const,
        })),
      }),
    ),
  );

  return chunkResults.flatMap((results, chunkIndex) =>
    results.map((r, i) => {
      if (r.status === "failure") {
        const entry = entries[chunkIndex * chunkSize + i];
        throw new Error(
          `Multicall failed for address ${entry.address} modality ${entry.modality}: ${r.error.message}`,
          { cause: r.error },
        );
      }
      return r.result as Address;
    }),
  );
}

export async function ensureVestingContracts(
  batchConfig: BatchCallerConfig,
  tdeDisbursementAddress: Address,
  entries: VestingEntry[],
  chunkSize: number,
): Promise<void> {
  const existing = await readVestingContracts(
    batchConfig.publicClient,
    tdeDisbursementAddress,
    entries,
    chunkSize,
  );
  const missing = entries.filter((_, i) => existing[i] === zeroAddress);

  if (missing.length === 0) {
    console.error(`All ${entries.length} vesting contracts already exist, nothing to do.`);
    return;
  }

  console.error(`${existing.length - missing.length} already exist, creating ${missing.length}...`);

  const calls: BatchCall[] = missing.map(({ address, modality }) => ({
    target: tdeDisbursementAddress,
    data: encodeFunctionData({
      abi: tdeDisbursementAbi,
      functionName: "ensureVestingContractExists",
      args: [address, modality],
    }),
  }));

  await executeInGasFilledBatches(batchConfig, calls, "created");
}
