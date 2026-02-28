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
import { readVestingContracts } from "./vesting.js";

// --- Config ---

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

const MULTICALL_CHUNK_SIZE = 200;

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

async function resolveTransferTargets(rows: DisbursementRow[]): Promise<Address[]> {
  const vestingAddresses = await readVestingContracts(
    publicClient,
    TDE_DISBURSEMENT_ADDRESS,
    tdeDisbursementAbi,
    rows,
    MULTICALL_CHUNK_SIZE,
  );

  return rows.map((row, i) => (row.modality !== 0 ? vestingAddresses[i] : row.address));
}

async function readBalances(addresses: Address[]): Promise<bigint[]> {
  const chunks = Array.from(
    { length: Math.ceil(addresses.length / MULTICALL_CHUNK_SIZE) },
    (_, i) => addresses.slice(i * MULTICALL_CHUNK_SIZE, (i + 1) * MULTICALL_CHUNK_SIZE),
  );

  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      publicClient.multicall({
        contracts: chunk.map((addr) => ({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [addr] as const,
        })),
      }),
    ),
  );

  return chunkResults.flatMap((results) =>
    results.map((r) => {
      if (r.status === "failure") throw r.error;
      return r.result as bigint;
    }),
  );
}

// `balances` is indexed against resolved `targets` (vesting contract addresses),
// but `pending` is filtered from `rows` (beneficiary addresses). This is correct:
// `disburse()` takes the beneficiary address, not the vesting contract.
async function disburseAll(rows: DisbursementRow[]): Promise<void> {
  const targets = await resolveTransferTargets(rows);
  const balances = await readBalances(targets);

  const pending = rows.filter((row, i) => balances[i] < row.amount);

  if (pending.length === 0) {
    console.error(`All ${rows.length} destinations already funded, nothing to do.`);
    return;
  }

  console.error(`${rows.length - pending.length} already funded, disbursing ${pending.length}...`);

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

const disbursementRows = loadDisbursementCsv("disbursement.csv");

await ensureDelegation(batchConfig);
await ensureAllowance(disbursementRows.reduce((sum, row) => sum + row.amount, 0n));
await disburseAll(disbursementRows);
await clearDelegation(batchConfig);
