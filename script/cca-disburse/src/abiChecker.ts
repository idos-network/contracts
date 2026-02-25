import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbiEvent, AbiFunction } from "viem";
import { toEventSignature, toFunctionSignature } from "viem";
import { splitBy } from "./lib.js";

const _srcDir = dirname(fileURLToPath(import.meta.url));
const _repoRoot = join(_srcDir, "..", "..", "..");

type AbiEntry = ReadonlyArray<{
  readonly type: string;
  readonly name?: string;
  readonly inputs?: ReadonlyArray<unknown>;
  readonly outputs?: ReadonlyArray<unknown>;
}>;

function abiItemSignature(item: {
  type: string;
  name?: string;
  inputs?: unknown[];
  outputs?: unknown[];
}): string {
  if (item.type === "function") return toFunctionSignature(item as unknown as AbiFunction);
  if (item.type === "event") return toEventSignature(item as unknown as AbiEvent);
  return JSON.stringify(item);
}

function checkAbiAgainstArtifact(
  staticAbi: AbiEntry,
  artifact: {
    abi: readonly { type: string; name?: string; inputs?: unknown[]; outputs?: unknown[] }[];
  },
): void {
  const builtAbi = artifact.abi;
  const byKey = new Map<string, (typeof builtAbi)[number]>();
  for (const item of builtAbi) {
    if (item.name != null) byKey.set(`${item.type}:${item.name}`, item);
  }
  for (const entry of staticAbi) {
    const name = "name" in entry ? entry.name : undefined;
    if (name == null) continue;
    const key = `${entry.type}:${name}`;
    const built = byKey.get(key);
    if (!built) throw new Error(`artifact missing ${key}`);
    const expected = abiItemSignature(entry as Parameters<typeof abiItemSignature>[0]);
    const observed = abiItemSignature(built);
    if (expected !== observed)
      throw new Error(
        [
          `${key} signature differs:`,
          `  expected (abis.ts): ${expected}`,
          `  observed (artifact): ${observed}`,
        ].join("\n"),
      );
  }
}

const ARTIFACTS = [
  ["ContinuousClearingAuction.sol/ContinuousClearingAuction.json", "CCA"] as const,
  ["CCADisbursementTracker.sol/CCADisbursementTracker.json", "Tracker"] as const,
  ["WhaleDisburser.sol/WhaleDisburser.json", "WhaleDisburser"] as const,
  ["ERC20.sol/ERC20.json", "ERC20"] as const,
] as const;

const ABI_DRIFT_SUFFIX = "Update script/cca-disburse/src/abis.ts to match the contract.";

export function assertAbisMatchArtifacts(abis: {
  ccaAbi: AbiEntry;
  trackerAbi: AbiEntry;
  whaleDisburserAbi: AbiEntry;
  erc20Abi: AbiEntry;
}): void {
  const out = (path: string) => join(_repoRoot, "out", path);
  type Label = (typeof ARTIFACTS)[number][1];
  const abiByLabel: Record<Label, AbiEntry> = {
    CCA: abis.ccaAbi,
    Tracker: abis.trackerAbi,
    WhaleDisburser: abis.whaleDisburserAbi,
    ERC20: abis.erc20Abi,
  };
  const withFullPath = ARTIFACTS.map(([path, label]) => ({ fullPath: out(path), label }));
  const [present, missing] = splitBy(withFullPath, (e) => existsSync(e.fullPath));
  if (missing.length > 0)
    throw new Error(
      [
        "Missing artifact(s). Run `forge build` from the repo root.",
        "",
        "Missing:",
        ...missing.map((e) => `- ${e.fullPath}`),
      ].join("\n"),
    );
  for (const { fullPath, label } of present) {
    const artifact = JSON.parse(readFileSync(fullPath, "utf-8"));
    try {
      checkAbiAgainstArtifact(abiByLabel[label], artifact);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${label} ABI drift (${fullPath}): ${msg}. ${ABI_DRIFT_SUFFIX}`);
    }
  }
}
