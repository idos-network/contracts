import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  getAddress,
  http,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import {
  type BatchCall,
  type BatchCallerConfig,
  clearDelegation,
  ensureDelegation,
  executeInGasFilledBatches,
} from "./batch.js";
import { type DisbursementRow, loadDisbursementCsv } from "./csv.js";

// --- Config ---

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

const _srcDir = dirname(fileURLToPath(import.meta.url));
const _repoRoot = join(_srcDir, "..", "..", "..");

const TDE_DISBURSEMENT_ADDRESS = getAddress(requireEnv("TDE_DISBURSEMENT_ADDRESS"));

const { abi: tdeDisbursementAbi } = JSON.parse(
  readFileSync(join(_repoRoot, "out/TDEDisbursement.sol/TDEDisbursement.json"), "utf8"),
);

const { abi: batchCallerAbi } = JSON.parse(
  readFileSync(join(_repoRoot, "out/BatchCaller.sol/BatchCaller.json"), "utf8"),
);

const BATCH_CALLER_ADDRESS = getAddress(requireEnv("BATCH_CALLER_ADDRESS"));

const disburser = privateKeyToAccount(requireEnv("PRIVATE_KEY") as `0x${string}`, {
  nonceManager,
});

const chain = arbitrumSepolia;
const transport = http(requireEnv("ARBITRUM_SEPOLIA_RPC_URL"));

const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({
  account: disburser,
  chain,
  transport,
});

const batchConfig: BatchCallerConfig = {
  publicClient,
  walletClient,
  batchCallerAbi,
  batchCallerAddress: BATCH_CALLER_ADDRESS,
};

const tokenAddress = (await publicClient.readContract({
  address: TDE_DISBURSEMENT_ADDRESS,
  abi: tdeDisbursementAbi,
  functionName: "IDOS_TOKEN",
})) as Address;

// --- Helpers ---

async function ensureAllowance(totalNeeded: bigint): Promise<void> {
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [disburser.address, TDE_DISBURSEMENT_ADDRESS],
  });

  if (allowance >= totalNeeded) {
    console.error(
      `Allowance sufficient (${formatEther(allowance)} >= ${formatEther(totalNeeded)}), skipping approval.`,
    );
    return;
  }

  console.error(`Approving TDEDisbursement to spend ${formatEther(totalNeeded)} tokens...`);
  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [TDE_DISBURSEMENT_ADDRESS, totalNeeded],
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`Approval reverted: ${hash}`);
  console.error(`Approval confirmed: ${hash}`);
}

function disbursementKey(beneficiary: Address, modality: number, amount: bigint): string {
  return `${beneficiary}-${modality}-${amount}`;
}

type DisbursedLog = { beneficiary: Address; modality: number; amount: bigint };

async function readDisbursedLogs(): Promise<DisbursedLog[]> {
  const logs = await publicClient.getContractEvents({
    address: TDE_DISBURSEMENT_ADDRESS,
    abi: tdeDisbursementAbi,
    eventName: "Disbursed",
    fromBlock: 0n,
  });
  return logs.map((log) => (log as unknown as { args: DisbursedLog }).args);
}

function findPendingRows(rows: DisbursementRow[], logs: DisbursedLog[]): DisbursementRow[] {
  const counts = new Map<string, number>();
  for (const log of logs) {
    const key = disbursementKey(log.beneficiary, log.modality, log.amount);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const pending: DisbursementRow[] = [];
  for (const row of rows) {
    const key = disbursementKey(row.address, row.modality, row.amount);
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) {
      counts.set(key, remaining - 1);
    } else {
      pending.push(row);
    }
  }
  return pending;
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
const logs = await readDisbursedLogs();
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
