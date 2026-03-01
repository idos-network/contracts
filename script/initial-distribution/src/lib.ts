import type { Address, Hex, PublicClient, TransactionReceipt } from "viem";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
export function ensureHex(value: string): Hex {
  const raw = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!HEX_PATTERN.test(raw)) {
    throw new Error(`Invalid hex string: "${value}"`);
  }
  return `0x${raw}` as Hex;
}

type Defined<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

export function requiredArgs<T extends Record<string, unknown>>(log: {
  args: T;
  eventName?: string;
}): Defined<T> {
  const out = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(log.args)) {
    if (value === undefined)
      throw new Error(`Missing event field: ${log.eventName ?? "unknown"}.${key}`);
    out[key] = value;
  }
  return out as Defined<T>;
}

export function splitBy<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) {
    (predicate(item) ? yes : no).push(item);
  }
  return [yes, no];
}

const ISO8601_ZULU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function iso8601ToTimestamp(iso: string): bigint {
  if (!ISO8601_ZULU.test(iso)) {
    throw new Error(
      `Invalid ISO 8601 timestamp: "${iso}". Use format "YYYY-MM-DDTHH:mm:ssZ" (Zulu time zone required).`,
    );
  }
  return BigInt(Math.floor(new Date(iso).getTime() / 1000));
}

export function sumOf(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

export function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function zip<A, B>(a: A[], b: B[]): [A, B][] {
  const len = Math.min(a.length, b.length);
  const result: [A, B][] = [];
  for (let i = 0; i < len; i++) {
    result.push([a[i], b[i]]);
  }
  return result;
}

export async function receiptFor(
  publicClient: PublicClient,
  hash: Hex,
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

export async function blockToTimestamp(
  publicClient: PublicClient,
  blockNumber: bigint,
): Promise<bigint> {
  return (await publicClient.getBlock({ blockNumber })).timestamp;
}

export async function contractHasCode(
  publicClient: PublicClient,
  contract: { address: Address },
): Promise<boolean> {
  const code = await publicClient.getCode({ address: contract.address });
  return !!code && code !== "0x";
}

function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

const DEFAULT_PAGE_SIZE = 10_000n;

export function blockWindows(
  fromBlock: bigint,
  toBlock: bigint,
  pageSize: bigint = DEFAULT_PAGE_SIZE,
): { fromBlock: bigint; toBlock: bigint }[] {
  const windows: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += pageSize + 1n) {
    windows.push({
      fromBlock: start,
      toBlock: bigintMin(toBlock, start + pageSize),
    });
  }
  return windows;
}

const DEFAULT_CONCURRENCY = 5;

export async function paginatedGetEvents<T>(
  fetcher: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  pageSize: bigint = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const windows = blockWindows(fromBlock, toBlock, pageSize);
  const results: T[] = [];
  for (let i = 0; i < windows.length; i += DEFAULT_CONCURRENCY) {
    const batch = windows.slice(i, i + DEFAULT_CONCURRENCY);
    const pages = await Promise.all(batch.map(fetcher));
    results.push(...pages.flat());
  }
  return results;
}
