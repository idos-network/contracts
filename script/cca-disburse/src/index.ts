import { tqdm } from "@thesephist/tsqdm";
import "dotenv/config";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  getContract,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { ccaAbi, erc20Abi, trackerAbi, whaleDisburserAbi } from "./abis";
import { computeDisbursement } from "./computeDisbursement";
import { findFirstBlockAtOrAfter } from "./findFirstBlockAtOrAfter";
import {
  assertCondition,
  blockToTimestamp,
  contractHasCode,
  ensureHex,
  iso8601ToTimestamp,
  paginatedGetEvents,
  requiredArgs,
  requireEnv,
  splitBy,
  sumOf,
  zip,
} from "./lib";

const SUPPORTED_CHAINS = {
  [String(arbitrumSepolia.id)]: arbitrumSepolia,
  [String(arbitrum.id)]: arbitrum,
} as const;

// -- Configuration and sanity checks ──────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
if (DRY_RUN) console.log("[dry-run] Dry run enabled. No transactions will be broadcast.");

const CHAIN_ID = requireEnv("CHAIN_ID");
const RPC_URL = requireEnv("RPC_URL");
const DISBURSER_PRIVATE_KEY = ensureHex(requireEnv("DISBURSER_PRIVATE_KEY"));
const TRACKER_TOKEN_ADDRESS = getAddress(requireEnv("TRACKER_TOKEN_ADDRESS"));
const CCA_ADDRESS = getAddress(requireEnv("CCA_ADDRESS"));
const SOLD_TOKEN_ADDRESS = getAddress(requireEnv("SOLD_TOKEN_ADDRESS"));
const WHALE_DISBURSER_ADDRESS = getAddress(requireEnv("WHALE_DISBURSER_ADDRESS"));
const VESTING_START = iso8601ToTimestamp(requireEnv("VESTING_START"));
const NORMAL_PHASE_START = iso8601ToTimestamp(requireEnv("NORMAL_PHASE_START"));

const chain = SUPPORTED_CHAINS[CHAIN_ID];
assertCondition(
  chain !== undefined,
  `Unsupported CHAIN_ID: ${CHAIN_ID}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`,
);

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

const rpcChainId = await publicClient.getChainId();
assertCondition(
  rpcChainId === chain.id,
  `RPC_URL points to chain ${rpcChainId}, expected ${chain.id} (${chain.name}).`,
);
console.log(`✅ RPC connected to ${chain.name} (chain ${rpcChainId}).`);

const disburser = privateKeyToAccount(DISBURSER_PRIVATE_KEY);

const disburserClient = createWalletClient({
  chain,
  transport: http(RPC_URL),
  account: disburser,
});

const ccaContract = getContract({
  address: CCA_ADDRESS,
  abi: ccaAbi,
  client: publicClient,
});

const soldTokenContract = getContract({
  address: SOLD_TOKEN_ADDRESS,
  abi: erc20Abi,
  client: disburserClient,
});

const whaleDisburserContract = getContract({
  address: WHALE_DISBURSER_ADDRESS,
  abi: whaleDisburserAbi,
  client: disburserClient,
});

const trackerContract = getContract({
  address: TRACKER_TOKEN_ADDRESS,
  abi: trackerAbi,
  client: disburserClient,
});

for (const contract of [ccaContract, trackerContract, soldTokenContract, whaleDisburserContract]) {
  assertCondition(
    await contractHasCode(publicClient, contract),
    `No contract code on address ${contract.address} on chain ${chain.id}.`,
  );
}
console.log(`✅ All contracts addresses have deployed code.`);

const onChainDisburser = getAddress(await trackerContract.read.disburser());
assertCondition(
  onChainDisburser === getAddress(disburser.address),
  `${disburser.address} is not the disburser (expected ${onChainDisburser}).`,
);
console.log(`✅ Disburser address matches expected: ${onChainDisburser}`);

// ── 1. Fetch CCA data, resolve phase boundary, compute filled bids ──────────

const ccaStartBlock = await ccaContract.read.startBlock();
const ccaEndBlock = await ccaContract.read.endBlock();
const currentBlock = await publicClient.getBlockNumber();

assertCondition(
  currentBlock >= ccaEndBlock,
  `CCA end block is in the future. We're at block ${currentBlock} and need to wait for block ${ccaEndBlock} to be mined.`,
);
console.log(`✅ CCA sale has ended.`);

const phaseBoundaryBlock = await findFirstBlockAtOrAfter(
  NORMAL_PHASE_START,
  ccaStartBlock,
  ccaEndBlock,
  async (blockNumber) => blockToTimestamp(publicClient, blockNumber),
);
const phaseBoundaryTimestamp = await blockToTimestamp(publicClient, phaseBoundaryBlock);
assertCondition(
  ccaStartBlock <= phaseBoundaryBlock && phaseBoundaryBlock <= ccaEndBlock,
  `Phase boundary block is out of range: ${phaseBoundaryBlock} is not between ${ccaStartBlock} and ${ccaEndBlock}.`,
);
console.log(
  `✅ Normal phase boundary block found: ${phaseBoundaryBlock}, at ${new Date(Number(phaseBoundaryTimestamp) * 1000).toISOString()}`,
);

assertCondition(
  await trackerContract.read.saleFullyClaimed(),
  "Sale is not fully claimed yet. Wait for all claimTokens and sweepUnsoldTokens to be called.",
);
console.log(`✅ CCA sale has been fully claimed.`);

const [bidLogs, claimLogs, sweepLogs] = await Promise.all([
  paginatedGetEvents((r) => ccaContract.getEvents.BidSubmitted({}, r), ccaStartBlock, ccaEndBlock),
  paginatedGetEvents((r) => ccaContract.getEvents.TokensClaimed({}, r), ccaEndBlock, currentBlock),
  paginatedGetEvents((r) => ccaContract.getEvents.TokensSwept({}, r), ccaEndBlock, currentBlock),
]);

assertCondition(
  sweepLogs.length > 0,
  "No TokensSwept event found. This should never happen, since the tracker should have recorded the sweep.",
);
console.log(`✅ CCA sale has been swept.`);

const sweepLog = requiredArgs(sweepLogs[0]);
const sweep = {
  recipient: getAddress(sweepLog.tokensRecipient),
  amount: sweepLog.tokensAmount,
};

const bidSubmissions = bidLogs.map((l) => {
  const { id: bidId, owner } = requiredArgs(l);
  return { bidId, owner, blockNumber: l.blockNumber };
});

// TokensClaimed is the only event that matters for token amounts. BidExited
// records the same tokensFilled value earlier (during exit), but the actual
// token transfer (and thus the tracker's MissingDisbursementRecorded) only
// happens at claim time. Outbid bids may have tokensFilled = 0; we ignore those.
const tokensClaims = claimLogs.map((l) => requiredArgs(l)).filter((tc) => tc.tokensFilled > 0n);

const bidSubmissionById = new Map(bidSubmissions.map((o) => [o.bidId, o]));

const claimsWithoutSubmission = tokensClaims.filter((tc) => !bidSubmissionById.has(tc.bidId));
assertCondition(
  !claimsWithoutSubmission.length,
  `TokensClaimed events without matching BidSubmitted: ${claimsWithoutSubmission.map((tc) => tc.bidId).join(", ")}`,
);
console.log(`✅ All tokens claims have matching bid submissions.`);

const filledBids = tokensClaims.map((tc) => {
  // biome-ignore lint/style/noNonNullAssertion: asserted above that all claims have a submission.
  const b = bidSubmissionById.get(tc.bidId)!;
  return {
    bidId: b.bidId,
    owner: getAddress(b.owner),
    bidBlockNumber: b.blockNumber,
    tokensFilled: tc.tokensFilled,
  };
});

// -- Execution functions ─────────────────────────────────────────────────────

async function approveWhaleDisburser(amount: bigint): Promise<void> {
  const currentAllowance = await soldTokenContract.read.allowance([
    disburser.address,
    WHALE_DISBURSER_ADDRESS,
  ]);
  if (currentAllowance >= amount) return;

  if (DRY_RUN) {
    console.log(`[dry-run] approve WhaleDisburser for ${formatEther(amount)}`);
    return;
  }
  const hash = await soldTokenContract.write.approve([WHALE_DISBURSER_ADDRESS, amount]);
  await publicClient.waitForTransactionReceipt({ hash });
}

const ZERO_HASH: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function executeWhaleDisburse(to: Address, amount: bigint): Promise<Hex> {
  if (DRY_RUN) {
    console.log(`[dry-run] WhaleDisburser.disburse(${to}, ${formatEther(amount)})`);
    return ZERO_HASH;
  }
  const hash = await whaleDisburserContract.write.disburse([
    SOLD_TOKEN_ADDRESS,
    to,
    amount,
    VESTING_START,
  ]);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function executeTransfer(to: Address, amount: bigint): Promise<Hex> {
  if (DRY_RUN) {
    console.log(`[dry-run] transfer ${formatEther(amount)} to ${to}`);
    return ZERO_HASH;
  }
  const hash = await soldTokenContract.write.transfer([to, amount]);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function recordOnTracker(to: Address, ccaAmount: bigint, txHash: Hex): Promise<Hex> {
  if (DRY_RUN) {
    console.log(`[dry-run] record ${to} CCA ${formatEther(ccaAmount)}`);
    return ZERO_HASH;
  }
  const hash = await trackerContract.write.recordDisbursement([to, ccaAmount, txHash]);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function findUnrecordedTransfer(
  entry: DisbursementEntry,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Hex | null> {
  if (DRY_RUN) return null;

  if (entry.kind === "whale") {
    const logs = await whaleDisburserContract.getEvents.Disbursed(
      { beneficiary: entry.to },
      { fromBlock, toBlock },
    );
    const match = logs.find((l) => l.args.totalAmount === entry.transferAmount);
    if (!match) return null;
    return match.transactionHash;
  } else {
    const logs = await soldTokenContract.getEvents.Transfer(
      { from: disburser.address, to: entry.to },
      { fromBlock, toBlock },
    );
    const match = logs.find((l) => l.args.value === entry.transferAmount);
    if (!match) return null;
    return match.transactionHash;
  }
}

function executeEntry(entry: DisbursementEntry): Promise<Hex> {
  return entry.kind === "whale"
    ? executeWhaleDisburse(entry.to, entry.transferAmount)
    : executeTransfer(entry.to, entry.transferAmount);
}

// ── 2. Compute the full expected entry list ─────────────────────────────────
//
// The tracker only sees pre-bonus CCA amounts. The actual token movements
// include the bonus, so transferAmount intentionally differs from ccaAmount
// for whale entries.

interface DisbursementEntry {
  kind: "normal" | "whale" | "sweep";
  to: Address;
  transferAmount: bigint;
  ccaAmount: bigint;
}

const expectedEntries: DisbursementEntry[] = [];

for (const addr of [...new Set(filledBids.map((b) => b.owner))].sort()) {
  const [whaleBids, normalBids] = splitBy(
    filledBids.filter((b) => b.owner === addr),
    (b) => b.bidBlockNumber < phaseBoundaryBlock,
  );

  const r = computeDisbursement(
    sumOf(whaleBids.map((b) => b.tokensFilled)),
    sumOf(normalBids.map((b) => b.tokensFilled)),
  );

  if (r.ccaWhale > 0n) {
    expectedEntries.push({
      kind: "whale",
      to: addr,
      ccaAmount: r.ccaWhale,
      transferAmount: r.disbursableWhale,
    });
  }

  if (r.ccaNormal > 0n) {
    expectedEntries.push({
      kind: "normal",
      to: addr,
      ccaAmount: r.ccaNormal,
      transferAmount: r.disbursableNormal,
    });
  }
}

if (sweep.amount > 0n) {
  expectedEntries.push({
    kind: "sweep",
    to: sweep.recipient,
    ccaAmount: sweep.amount,
    transferAmount: sweep.amount,
  });
}

// ── 3. Reconcile on-chain tracker recordings against expected entries ────────
//
// DisbursementCompleted events are the single source of truth for progress.
// Each entry produces one transfer (or whale disburse) and one tracker recording,
// always in that order. If we crash between the two, we detect the unrecorded
// transfer on the next run and resume from the tracker recording step.

const disbursementLogs = await paginatedGetEvents(
  (r) => trackerContract.getEvents.DisbursementCompleted({}, r),
  ccaEndBlock,
  currentBlock,
);

assertCondition(
  disbursementLogs.length <= expectedEntries.length,
  `Idempotency broken: found ${disbursementLogs.length} DisbursementCompleted events but only ${expectedEntries.length} entries expected.`,
);
console.log(`✅ All already recorded disbursement logs have matching expected entries.`);

for (const [i, [expected, log]] of zip(expectedEntries, disbursementLogs).entries()) {
  const { to: rawTo, value } = requiredArgs(log);
  const to = getAddress(rawTo);

  assertCondition(
    to === expected.to && value === expected.ccaAmount,
    `Idempotency broken at entry ${i} (${expected.kind}):\n` +
      `  expected: to=${expected.to}, ccaAmount=${expected.ccaAmount}\n` +
      `  on-chain: to=${to}, value=${value}`,
  );
}
console.log(`✅ All already recorded disbursement logs match expected entries.`);

// ── 4. Execute remaining entries and record on tracker ──────────────────────-

const remainingEntries = expectedEntries.slice(disbursementLogs.length);

if (remainingEntries.length > 0) {
  // Crash recovery: the previous run may have executed the transfer for the
  // first remaining entry but crashed before recording it on the tracker.
  // Search from the last recorded event's block to minimize false positives.
  const recoveryFromBlock =
    disbursementLogs.length === 0
      ? ccaEndBlock
      : disbursementLogs[disbursementLogs.length - 1].blockNumber;
  const recoveredTxHash = await findUnrecordedTransfer(
    remainingEntries[0],
    recoveryFromBlock,
    currentBlock,
  );
  if (recoveredTxHash) {
    const entry = remainingEntries[0];
    remainingEntries.shift();
    await recordOnTracker(entry.to, entry.ccaAmount, recoveredTxHash);
  }

  const remainingTokenTotal = sumOf(remainingEntries.map((e) => e.transferAmount));
  const disburserBalance = await soldTokenContract.read.balanceOf([disburser.address]);
  assertCondition(
    disburserBalance >= remainingTokenTotal,
    `Insufficient token balance. Has ${formatEther(disburserBalance)}, needs ${formatEther(remainingTokenTotal)}.`,
  );

  const whaleTotal = sumOf(
    remainingEntries.filter((e) => e.kind === "whale").map((e) => e.transferAmount),
  );
  if (whaleTotal > 0n) await approveWhaleDisburser(whaleTotal);

  for await (const entry of tqdm(remainingEntries, { label: "Disbursing" })) {
    const txHash = await executeEntry(entry);
    await recordOnTracker(entry.to, entry.ccaAmount, txHash);
  }
  console.log(`✅ All remaining entries disbursed.`);
} else {
  console.log(`✅ No remaining entries to disburse.`);
}

// ── Final state ─────────────────────────────────────────────────────────────

assertCondition(
  DRY_RUN || (await trackerContract.read.saleFullyDisbursed()),
  "Sale is not fully disbursed. This should never happen.",
);
console.log(`✅ Run completed successfully.`);
