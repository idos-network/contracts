import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  const byKey = new Map<string, (typeof builtAbi)[number][]>();
  for (const item of builtAbi) {
    if (item.name != null) {
      const key = `${item.type}:${item.name}`;
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
  }
  for (const entry of staticAbi) {
    const name = "name" in entry ? entry.name : undefined;
    if (name == null) continue;
    const key = `${entry.type}:${name}`;
    const builtCandidates = byKey.get(key);
    if (builtCandidates == null || builtCandidates.length === 0) {
      throw new Error(`artifact missing ${key}`);
    }
    const expected = abiItemSignature(entry as Parameters<typeof abiItemSignature>[0]);
    const built = builtCandidates.find((candidate) => abiItemSignature(candidate) === expected);
    if (!built) {
      throw new Error(
        [
          `${key} signature differs:`,
          `  expected (abis.ts): ${expected}`,
          `  observed candidates (artifact): ${builtCandidates.map((candidate) => abiItemSignature(candidate)).join(", ")}`,
        ].join("\n"),
      );
    }
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
  ["TDEDisbursement.sol/TDEDisbursement.json", "TDEDisbursement"] as const,
  ["BatchCaller.sol/BatchCaller.json", "BatchCaller"] as const,
] as const;

// Forge may produce `Contract.json` or versioned `Contract.0.8.26.json`.
// Try the exact path first, then fall back to any versioned variant.
function resolveArtifactPath(exactPath: string): string | null {
  if (existsSync(exactPath)) return exactPath;
  const dir = dirname(exactPath);
  if (!existsSync(dir)) return null;
  const base = basename(exactPath, ".json");
  const candidate = readdirSync(dir).find((f) => f.startsWith(`${base}.`) && f.endsWith(".json"));
  return candidate ? join(dir, candidate) : null;
}

const ABI_DRIFT_SUFFIX = "Update script/initial-distribution/src/abis.ts to match the contract.";

export function assertAbisMatchArtifacts(abis: {
  ccaAbi: AbiEntry;
  trackerAbi: AbiEntry;
  whaleDisburserAbi: AbiEntry;
  erc20Abi: AbiEntry;
  tdeDisbursementAbi: AbiEntry;
  batchCallerAbi: AbiEntry;
}): void {
  const out = (path: string) => join(_repoRoot, "out", path);
  const resolved = ARTIFACTS.map(([path, label]) => ({
    fullPath: resolveArtifactPath(out(path)),
    label,
  }));
  const [present, missing] = splitBy(resolved, (e) => e.fullPath !== null);
  if (missing.length > 0)
    throw new Error(
      [
        "Missing artifact(s). Run `forge build` from the repo root.",
        "",
        "Missing:",
        ...missing.map((e) => `- ${e.label}`),
      ].join("\n"),
    );

  const abiByLabel = {
    CCA: abis.ccaAbi,
    Tracker: abis.trackerAbi,
    WhaleDisburser: abis.whaleDisburserAbi,
    ERC20: abis.erc20Abi,
    TDEDisbursement: abis.tdeDisbursementAbi,
    BatchCaller: abis.batchCallerAbi,
  };
  for (const entry of present) {
    const { label } = entry;
    // biome-ignore lint/style/noNonNullAssertion: It's checked above.
    const fullPath = entry.fullPath!;
    const artifact = JSON.parse(readFileSync(fullPath, "utf-8"));
    try {
      checkAbiAgainstArtifact(abiByLabel[label], artifact);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${label} ABI drift (${fullPath}): ${msg}. ${ABI_DRIFT_SUFFIX}`);
    }
  }
}
