import { type Address, encodeFunctionData, getAddress, getContract, type PublicClient } from "viem";
import { erc20Abi, tdeDisbursementAbi } from "./abis.js";
import { type BatchCallerConfig, executeInGasFilledBatches } from "./batch.js";
import { chainSetup, makeWallet } from "./chains.js";
import type { DisbursementRow } from "./csv.js";
import {
  ensureHex,
  iso8601ToTimestamp,
  paginatedGetEvents,
  receiptFor,
  requiredArgs,
  requireEnv,
} from "./lib.js";

export async function setupTdeEnvironment() {
  const CHAIN_ID = requireEnv("CHAIN_ID");
  const tdeDisbursementAddress = getAddress(requireEnv("TDE_DISBURSEMENT_ADDRESS"));
  const tdeDisbursementDeploymentBlock = BigInt(requireEnv("TDE_DISBURSEMENT_DEPLOYMENT_BLOCK"));
  const BATCH_CALLER_ADDRESS = getAddress(requireEnv("BATCH_CALLER_ADDRESS"));
  const TDE_DISBURSER_PRIVATE_KEY = ensureHex(requireEnv("TDE_DISBURSER_PRIVATE_KEY"));
  const RPC_URL = requireEnv("RPC_URL");

  const tdeTimestamp = iso8601ToTimestamp(requireEnv("TDE_DATETIME"));
  const nowTimestamp = BigInt(Math.floor(Date.now() / 1000));

  const { chain, publicClient, transport } = await chainSetup(CHAIN_ID, RPC_URL);
  const tdeDisburser = makeWallet(chain, transport, TDE_DISBURSER_PRIVATE_KEY);

  const batchConfig: BatchCallerConfig = {
    publicClient,
    walletClient: tdeDisburser.walletClient,
    batchCallerAddress: BATCH_CALLER_ADDRESS,
  };

  const tdeDisbursementContract = getContract({
    address: tdeDisbursementAddress,
    abi: tdeDisbursementAbi,
    client: tdeDisburser.walletClient,
  });

  const tokenContract = getContract({
    address: await tdeDisbursementContract.read.IDOS_TOKEN(),
    abi: erc20Abi,
    client: tdeDisburser.walletClient,
  });

  return {
    tdeDisburser,
    publicClient,
    batchConfig,
    tokenContract,
    tdeDisbursementAddress,
    tdeDisbursementDeploymentBlock,
    tdeTimestamp,
    nowTimestamp,
  };
}

export async function ensureAllowance(
  tokenContract: Awaited<ReturnType<typeof setupTdeEnvironment>>["tokenContract"],
  accountAddress: Address,
  publicClient: PublicClient,
  tdeDisbursementAddress: Address,
  totalNeeded: bigint,
): Promise<void> {
  const allowance = await tokenContract.read.allowance([accountAddress, tdeDisbursementAddress]);

  if (allowance >= totalNeeded) return;

  await receiptFor(
    publicClient,
    await tokenContract.write.approve([tdeDisbursementAddress, totalNeeded]),
  );
}

export async function disburseAll(
  batchConfig: BatchCallerConfig,
  tdeDisbursementAddress: Address,
  pending: DisbursementRow[],
): Promise<void> {
  await executeInGasFilledBatches(
    batchConfig,
    pending.map(({ address, modality, amount }) => ({
      target: tdeDisbursementAddress,
      data: encodeFunctionData({
        abi: tdeDisbursementAbi,
        functionName: "disburse",
        args: [address, amount, modality],
      }),
    })),
    "disbursed",
  );
}

export async function fetchDisbursementLogs(
  publicClient: PublicClient,
  tdeDisbursementAddress: Address,
  tdeDisbursementDeploymentBlock: bigint,
) {
  return (
    await paginatedGetEvents(
      (r) =>
        publicClient.getContractEvents({
          address: tdeDisbursementAddress,
          abi: tdeDisbursementAbi,
          eventName: "Disbursed",
          ...r,
        }),
      tdeDisbursementDeploymentBlock,
      await publicClient.getBlockNumber(),
    )
  ).map((l) => requiredArgs(l));
}
