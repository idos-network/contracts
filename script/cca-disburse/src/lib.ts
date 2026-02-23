import type { Hex, PublicClient } from "viem";

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
export function ensureHex(value: string): Hex {
	const raw =
		value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
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
			throw new Error(
				`Missing event field: ${log.eventName ?? "unknown"}.${key}`,
			);
		out[key] = value;
	}
	return out as Defined<T>;
}

export function splitBy<T>(
	items: T[],
	predicate: (item: T) => boolean,
): [T[], T[]] {
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

export function assertCondition(
	condition: boolean,
	message: string,
): asserts condition {
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

export async function blockToTimestamp(
	publicClient: PublicClient,
	blockNumber: bigint,
): Promise<bigint> {
	return (await publicClient.getBlock({ blockNumber })).timestamp;
}
