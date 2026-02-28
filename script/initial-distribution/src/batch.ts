import {
  type Account,
  type Address,
  type Chain,
  encodeFunctionData,
  type PublicClient,
  type Transport,
  type WalletClient,
  zeroAddress,
} from "viem";
import { batchCallerAbi } from "./abis.js";

const BLOCK_GAS_LIMIT = 32_000_000n;
const GAS_BUFFER_FACTOR = 6n; // estimate + estimate/6 ≈ 17% buffer
const GAS_TARGET = (BLOCK_GAS_LIMIT * GAS_BUFFER_FACTOR) / (GAS_BUFFER_FACTOR + 1n);

// RPC proxy rejects eth_sendRawTransaction somewhere between 45–95 KB of
// calldata. 65 KB balances batch size against the proxy's limit.
const MAX_CALLDATA_BYTES = 65_000;
const MAX_ESTIMATE_RETRIES = 3;

const NOOP_ADDRESS = "0x0000000000000000000000000000000000000001" as Address;

export type BatchCall = { target: Address; data: `0x${string}` };

function isExecutionRevert(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("execution reverted") ||
    msg.includes("reverted") ||
    msg.includes("exceeds block gas limit") ||
    error.constructor.name === "ContractFunctionRevertedError"
  );
}

export type BatchCallerConfig = {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  batchCallerAddress: Address;
};

const EIP_7702_PREFIX = "0xef0100";

function isDelegatedTo(code: string | undefined, address: Address): boolean {
  return (
    code?.startsWith(EIP_7702_PREFIX) === true &&
    code.slice(EIP_7702_PREFIX.length) === address.slice(2).toLowerCase()
  );
}

function calldataSize(calls: BatchCall[]): number {
  return (
    encodeFunctionData({
      abi: batchCallerAbi,
      functionName: "execute",
      args: [calls],
    }).length /
      2 -
    1
  );
}

async function estimateBatchGas(config: BatchCallerConfig, calls: BatchCall[]): Promise<bigint> {
  const signer = config.walletClient.account.address;
  return config.publicClient.estimateContractGas({
    address: signer,
    abi: batchCallerAbi,
    functionName: "execute",
    args: [calls],
    account: signer,
  });
}

async function estimateWithRetry(config: BatchCallerConfig, batch: BatchCall[]): Promise<bigint> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await estimateBatchGas(config, batch);
    } catch (error) {
      if (isExecutionRevert(error)) throw error;
      if (attempt >= MAX_ESTIMATE_RETRIES) throw error;
      console.error(
        `Unexpected error estimating gas (attempt ${attempt + 1}/${MAX_ESTIMATE_RETRIES}), retrying...`,
        error,
      );
    }
  }
}

async function findMaxBatchSize(
  config: BatchCallerConfig,
  allCalls: BatchCall[],
  startIndex: number,
): Promise<number> {
  const remaining = allCalls.length - startIndex;
  if (remaining === 0) return 0;

  const singleCall = allCalls.slice(startIndex, startIndex + 1);
  if (calldataSize(singleCall) > MAX_CALLDATA_BYTES) {
    throw new Error(
      `Call at index ${startIndex} exceeds MAX_CALLDATA_BYTES (${MAX_CALLDATA_BYTES}) on its own`,
    );
  }
  const singleGas = await estimateWithRetry(config, singleCall);
  if (singleGas > GAS_TARGET) {
    throw new Error(
      `Call at index ${startIndex} exceeds GAS_TARGET (${singleGas} > ${GAS_TARGET}) on its own`,
    );
  }

  let lo = 1;
  let hi = remaining;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const batch = allCalls.slice(startIndex, startIndex + mid);
    if (calldataSize(batch) > MAX_CALLDATA_BYTES) {
      hi = mid - 1;
      continue;
    }
    try {
      const gas = await estimateWithRetry(config, batch);
      if (gas <= GAS_TARGET) lo = mid;
      else hi = mid - 1;
    } catch {
      hi = mid - 1;
    }
  }

  return lo;
}

async function executeBatch(config: BatchCallerConfig, calls: BatchCall[]): Promise<void> {
  const estimate = await estimateBatchGas(config, calls);
  const gas = estimate + estimate / GAS_BUFFER_FACTOR;

  const hash = await config.walletClient.writeContract({
    address: config.walletClient.account.address,
    abi: batchCallerAbi,
    functionName: "execute",
    args: [calls],
    gas,
  });

  const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`Batch transaction reverted: ${hash}`);
}

export async function executeInGasFilledBatches(
  config: BatchCallerConfig,
  allCalls: BatchCall[],
  label: string,
): Promise<void> {
  let i = 0;
  while (i < allCalls.length) {
    const size = await findMaxBatchSize(config, allCalls, i);
    const batch = allCalls.slice(i, i + size);
    await executeBatch(config, batch);
    i += size;
    console.error(`  ${i}/${allCalls.length} ${label}`);
  }
}

export async function ensureDelegation(config: BatchCallerConfig): Promise<void> {
  const signer = config.walletClient.account.address;
  const code = await config.publicClient.getCode({ address: signer });
  if (isDelegatedTo(code, config.batchCallerAddress)) {
    console.error("EIP-7702 delegation already set, skipping.");
    return;
  }

  console.error("Setting EIP-7702 delegation to BatchCaller...");
  const authorization = await config.walletClient.signAuthorization({
    contractAddress: config.batchCallerAddress,
    executor: "self",
  });

  const hash = await config.walletClient.sendTransaction({
    to: NOOP_ADDRESS,
    authorizationList: [authorization],
    gas: 100_000n,
  });

  const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`Delegation transaction reverted: ${hash}`);

  const postCode = await config.publicClient.getCode({ address: signer });
  if (!isDelegatedTo(postCode, config.batchCallerAddress)) {
    throw new Error(`Delegation not set after transaction (code: ${postCode})`);
  }
  console.error(`Delegation confirmed: ${hash}`);
}

export async function clearDelegation(config: BatchCallerConfig): Promise<void> {
  const signer = config.walletClient.account.address;
  const code = await config.publicClient.getCode({ address: signer });
  if (!code || code === "0x") {
    console.error("No EIP-7702 delegation set, nothing to clear.");
    return;
  }

  console.error("Clearing EIP-7702 delegation...");
  const authorization = await config.walletClient.signAuthorization({
    contractAddress: zeroAddress,
    executor: "self",
  });

  const hash = await config.walletClient.sendTransaction({
    to: NOOP_ADDRESS,
    authorizationList: [authorization],
    gas: 100_000n,
  });

  const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`Clear delegation reverted: ${hash}`);

  const postCode = await config.publicClient.getCode({ address: signer });
  if (postCode && postCode !== "0x") {
    throw new Error(`Delegation still set after clearing (code: ${postCode})`);
  }
  console.error(`Delegation cleared: ${hash}`);
}
