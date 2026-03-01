import "dotenv/config";
import { encodeFunctionData, getAddress, getContract } from "viem";
import { nonceManager } from "viem/accounts";
import { erc20Abi, tdeDisbursementAbi } from "./abis.js";
import {
  type BatchCall,
  type BatchCallerConfig,
  clearDelegation,
  ensureDelegation,
  executeInGasFilledBatches,
} from "./batch.js";
import { chainSetup } from "./chains.js";
import { type DisbursementRow, loadDisbursementCsv } from "./csv.js";
import { ensureHex, paginatedGetEvents, receiptFor, requiredArgs, requireEnv } from "./lib.js";
import { findPendingRows } from "./findPendingRows.js";

// --- Config ---

const CHAIN_ID = requireEnv("CHAIN_ID");
const TDE_DISBURSEMENT_ADDRESS = getAddress(requireEnv("TDE_DISBURSEMENT_ADDRESS"));
const TDE_DISBURSEMENT_DEPLOYMENT_BLOCK = BigInt(requireEnv("TDE_DISBURSEMENT_DEPLOYMENT_BLOCK"));
const BATCH_CALLER_ADDRESS = getAddress(requireEnv("BATCH_CALLER_ADDRESS"));
const DISBURSER_PRIVATE_KEY = ensureHex(requireEnv("DISBURSER_PRIVATE_KEY"));
const RPC_URL = requireEnv("RPC_URL");

const { account, publicClient, walletClient } = await chainSetup(
  CHAIN_ID,
  RPC_URL,
  DISBURSER_PRIVATE_KEY,
  { nonceManager },
);

const batchConfig: BatchCallerConfig = {
  publicClient,
  walletClient,
  batchCallerAddress: BATCH_CALLER_ADDRESS,
};

const tdeDisbursementContract = getContract({
  address: TDE_DISBURSEMENT_ADDRESS,
  abi: tdeDisbursementAbi,
  client: walletClient,
});

const tokenContract = getContract({
  address: await tdeDisbursementContract.read.IDOS_TOKEN(),
  abi: erc20Abi,
  client: walletClient,
});

// --- Helpers ---

async function ensureAllowance(totalNeeded: bigint): Promise<void> {
  const allowance = await tokenContract.read.allowance([account.address, TDE_DISBURSEMENT_ADDRESS]);

  if (allowance >= totalNeeded) return;

  await receiptFor(
    publicClient,
    await tokenContract.write.approve([TDE_DISBURSEMENT_ADDRESS, totalNeeded]),
  );
}

async function disburseAll(pending: DisbursementRow[]): Promise<void> {
  const calls: BatchCall[] = pending.map(({ address, modality, amount }) => ({
    target: TDE_DISBURSEMENT_ADDRESS,
    data: encodeFunctionData({
      abi: tdeDisbursementAbi,
      functionName: "disburse",
      args: [address, amount, modality],
    }),
  }));

  await executeInGasFilledBatches(batchConfig, calls, "disbursed");
}

// --- Main ---

const allRows = loadDisbursementCsv("disbursement.csv");
const latestBlock = await publicClient.getBlockNumber();
const logs = (
  await paginatedGetEvents(
    (r) =>
      publicClient.getContractEvents({
        address: TDE_DISBURSEMENT_ADDRESS,
        abi: tdeDisbursementAbi,
        eventName: "Disbursed",
        ...r,
      }),
    TDE_DISBURSEMENT_DEPLOYMENT_BLOCK,
    latestBlock,
  )
).map((l) => requiredArgs(l));
const pendingRows = findPendingRows(allRows, logs);

if (pendingRows.length === 0) {
  console.error(`All ${allRows.length} disbursements already recorded on-chain, nothing to do.`);
} else {
  console.error(
    `${allRows.length - pendingRows.length} already disbursed (by event logs), disbursing ${pendingRows.length}...`,
  );

  await ensureDelegation(batchConfig);
  await ensureAllowance(pendingRows.reduce((sum, row) => sum + row.amount, 0n));
  await disburseAll(pendingRows);
  await clearDelegation(batchConfig);
}
