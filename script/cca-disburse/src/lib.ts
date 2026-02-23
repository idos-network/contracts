import type { Hex } from "viem";

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

export function ensureHex(value: string): Hex {
	if (value.startsWith("0x")) return value as Hex;
	return `0x${value}` as Hex;
};

type Defined<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

export function requiredArgs<T extends Record<string, unknown>>(
	log: { args: T; eventName?: string },
): Defined<T> {
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

export function splitBy<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
	const yes: T[] = [];
	const no: T[] = [];
	for (const item of items) {
		(predicate(item) ? yes : no).push(item);
	}
	return [yes, no];
}

export function iso8601ToTimestamp(iso: string): bigint {
	const ms = new Date(iso).getTime();
	if (Number.isNaN(ms)) {
		throw new Error(
			`Invalid ISO 8601 timestamp: "${iso}". Use format like "2025-03-15T12:00:00Z".`,
		);
	}
	return BigInt(Math.floor(ms / 1000));
}

export function sumOf(values: bigint[]): bigint {
	return values.reduce((a, b) => a + b, 0n);
}

export function assertCondition(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}
