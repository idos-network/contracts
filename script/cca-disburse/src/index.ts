import "dotenv/config";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	formatEther,
	type Hex,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { ccaAbi, disperseAbi, erc20Abi, trackerAbi } from "./abis";
import { computeDisbursement } from "./computeDisbursement";
import { findFirstBlockAtOrAfter } from "./findFirstBlockAtOrAfter";

// ── CLI ─────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN)
	console.log("*** DRY RUN — no transactions will be broadcast ***\n");

// ── Config ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

const RPC_URL = requireEnv("RPC_URL");
const DISBURSER_PRIVATE_KEY = requireEnv("DISBURSER_PRIVATE_KEY");
const TRACKER_ADDRESS = requireEnv("TRACKER_ADDRESS") as Address;
const CCA_ADDRESS = requireEnv("CCA_ADDRESS") as Address;
const TOKEN_ADDRESS = requireEnv("TOKEN_ADDRESS") as Address;
const DISPERSE_ADDRESS = requireEnv("DISPERSE_ADDRESS") as Address;
const TOKENOPS_ADDRESS = requireEnv("TOKENOPS_ADDRESS") as Address;
const NORMAL_PHASE_START = requireEnv("NORMAL_PHASE_START");

const ensureHex = (value: string): Hex => {
	if (value.startsWith("0x")) return value as Hex;
	return `0x${value}` as Hex;
};

const disburser = privateKeyToAccount(ensureHex(DISBURSER_PRIVATE_KEY));

const publicClient = createPublicClient({
	chain: arbitrumSepolia,
	transport: http(RPC_URL),
});

const walletClient = createWalletClient({
	chain: arbitrumSepolia,
	transport: http(RPC_URL),
	account: disburser,
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing event field: ${label}`);
	return value;
}

function splitBy<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
	const yes: T[] = [];
	const no: T[] = [];
	for (const item of items) {
		(predicate(item) ? yes : no).push(item);
	}
	return [yes, no];
}

function iso8601ToTimestamp(iso: string): bigint {
	const ms = new Date(iso).getTime();
	if (Number.isNaN(ms)) {
		throw new Error(
			`Invalid ISO 8601 timestamp: "${iso}". Use format like "2025-03-15T12:00:00Z".`,
		);
	}
	return BigInt(Math.floor(ms / 1000));
}

function sumOf(values: bigint[]): bigint {
	return values.reduce((a, b) => a + b, 0n);
}

interface DisbursementEntry {
	trackerRecipient: Address;
	transferTo: Address;
	ccaAmount: bigint;
	transferAmount: bigint;
	label: string;
}

// ── 1. Fetch CCA data, resolve phase boundary, compute filled bids ──────────

console.log("Fetching CCA data...");

const [ccaStartBlock, ccaEndBlock] = await Promise.all([
	publicClient.readContract({
		address: CCA_ADDRESS,
		abi: ccaAbi,
		functionName: "startBlock",
	}),
	publicClient.readContract({
		address: CCA_ADDRESS,
		abi: ccaAbi,
		functionName: "endBlock",
	}),
]);
const currentBlock = await publicClient.getBlockNumber();

console.log(`  CCA: blocks ${ccaStartBlock}–${ccaEndBlock}`);
console.log(`  Current block: ${currentBlock}`);

if (currentBlock < ccaEndBlock) {
	throw new Error(
		`CCA end block is in the future. We're at block ${currentBlock} and need to wait for block ${ccaEndBlock} to be mined.`,
	);
}

const normalPhaseStartTimestamp = iso8601ToTimestamp(NORMAL_PHASE_START);
const phaseBoundaryBlock = await findFirstBlockAtOrAfter(
	normalPhaseStartTimestamp,
	BigInt(ccaStartBlock),
	BigInt(ccaEndBlock),
	async (blockNumber: bigint) =>
		(await publicClient.getBlock({ blockNumber })).timestamp,
);

console.log(`  Phase boundary block: ${phaseBoundaryBlock}`);

const [bidLogs, claimLogs, sweepLogs] = await Promise.all([
	publicClient.getContractEvents({
		address: CCA_ADDRESS,
		abi: ccaAbi,
		eventName: "BidSubmitted",
		fromBlock: BigInt(ccaStartBlock),
		toBlock: BigInt(ccaEndBlock),
	}),
	publicClient.getContractEvents({
		address: CCA_ADDRESS,
		abi: ccaAbi,
		eventName: "TokensClaimed",
		fromBlock: BigInt(ccaStartBlock),
		toBlock: currentBlock,
	}),
	publicClient.getContractEvents({
		address: CCA_ADDRESS,
		abi: ccaAbi,
		eventName: "TokensSwept",
		fromBlock: BigInt(ccaStartBlock),
		toBlock: currentBlock,
	}),
]);

const bidSubmissions = bidLogs.map((l) => ({
	bidId: required(l.args.id, "BidSubmitted.id"),
	owner: required(l.args.owner, "BidSubmitted.owner"),
	blockNumber: l.blockNumber,
}));

// TokensClaimed is the only event that matters for token amounts. BidExited
// records the same tokensFilled value earlier (during exit), but the actual
// token transfer (and thus the tracker's MissingDisbursementRecorded) only
// happens at claim time.
const tokensClaims = claimLogs.map((l) => ({
	bidId: required(l.args.bidId, "TokensClaimed.bidId"),
	owner: required(l.args.owner, "TokensClaimed.owner"),
	tokensFilled: required(l.args.tokensFilled, "TokensClaimed.tokensFilled"),
}));

const bidSubmissionsIds = new Set(bidSubmissions.map((b) => b.bidId));
const tokensClaimBidIds = new Set(tokensClaims.map((o) => o.bidId));
const symDiff = bidSubmissionsIds.symmetricDifference(tokensClaimBidIds);
if (symDiff.size > 0) {
	throw new Error(
		`Bid IDs between BidSubmitted and TokensClaimed are not the same: ${Array.from(symDiff).join(", ")}`,
	);
}

const bidSubmissionById = new Map(bidSubmissions.map((o) => [o.bidId, o]));
const filledBids = tokensClaims.map((tc) => {
	// biome-ignore lint/style/noNonNullAssertion: We've checked symDiff above.
	const b = bidSubmissionById.get(tc.bidId)!;
	return {
		bidId: b.bidId,
		owner: b.owner,
		bidBlockNumber: b.blockNumber,
		tokensFilled: tc.tokensFilled,
	};
});

if (sweepLogs.length === 0) {
	throw new Error(
		"No TokensSwept event found. Call sweepUnsoldTokens on the CCA contract first.",
	);
}
const sweep = {
	recipient: required(
		sweepLogs[0].args.tokensRecipient,
		"TokensSwept.tokensRecipient",
	),
	amount: required(
		sweepLogs[0].args.tokensAmount,
		"TokensSwept.tokensAmount",
	),
};

console.log(`  Bids: ${bidSubmissions.length}, Claims: ${tokensClaims.length}`);
console.log(
	`  Sweep: ${formatEther(sweep.amount)} tokens to ${sweep.recipient}`,
);

// ── 2. Precondition checks ──────────────────────────────────────────────────

console.log("\nChecking preconditions...");

const saleFullyClaimed = await publicClient.readContract({
	address: TRACKER_ADDRESS,
	abi: trackerAbi,
	functionName: "saleFullyClaimed",
});
if (!saleFullyClaimed) {
	throw new Error(
		"Sale is not fully claimed yet. Wait for all claimTokens/sweepUnsoldTokens calls.",
	);
}

const onChainDisburser = await publicClient.readContract({
	address: TRACKER_ADDRESS,
	abi: trackerAbi,
	functionName: "disburser",
});
if (onChainDisburser.toLowerCase() !== disburser.address.toLowerCase()) {
	throw new Error(
		`${disburser.address} is not the disburser (expected ${onChainDisburser}).`,
	);
}

console.log("  All preconditions met.\n");

// ── 3. Compute the full expected entry list (Step 1 of the plan) ────────────
//
// The tracker only sees pre-bonus CCA amounts. The actual token movements
// include the bonus, so transferAmount intentionally differs from ccaAmount
// for whale entries.

console.log("Computing expected disbursement entries...");

const expectedEntries: DisbursementEntry[] = [];

const bidderAddresses = [
	...new Set(filledBids.map((b) => b.owner)),
].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

for (const addr of bidderAddresses) {
	const bids = filledBids.filter((b) => b.owner === addr);
	const [whaleBids, normalBids] = splitBy(
		bids,
		(b) => b.bidBlockNumber < phaseBoundaryBlock,
	);

	const r = computeDisbursement(
		sumOf(whaleBids.map((b) => b.tokensFilled)),
		sumOf(normalBids.map((b) => b.tokensFilled)),
	);

	if (r.ccaNormal > 0n) {
		expectedEntries.push({
			trackerRecipient: addr,
			transferTo: addr,
			ccaAmount: r.ccaNormal,
			transferAmount: r.disbursableNormalImmediately,
			label: "normal",
		});
	}

	if (r.ccaWhaleImmediate > 0n) {
		expectedEntries.push({
			trackerRecipient: addr,
			transferTo: addr,
			ccaAmount: r.ccaWhaleImmediate,
			transferAmount: r.disbursableWhaleImmediately,
			label: "whale immediate",
		});
	}

	if (r.ccaWhaleVested > 0n) {
		expectedEntries.push({
			trackerRecipient: addr,
			transferTo: TOKENOPS_ADDRESS,
			ccaAmount: r.ccaWhaleVested,
			transferAmount: r.disbursableWhaleVested,
			label: "whale vested",
		});
	}
}

if (sweep.amount > 0n) {
	expectedEntries.push({
		trackerRecipient: sweep.recipient,
		transferTo: sweep.recipient,
		ccaAmount: sweep.amount,
		transferAmount: sweep.amount,
		label: "sweep",
	});
}

console.log(`  ${expectedEntries.length} expected entries`);
console.log(
	`  Total CCA: ${formatEther(sumOf(expectedEntries.map((e) => e.ccaAmount)))}`,
);
console.log(
	`  Total transfer: ${formatEther(sumOf(expectedEntries.map((e) => e.transferAmount)))}`,
);

for (const e of expectedEntries) {
	console.log(
		`    ${e.label}: ${e.trackerRecipient} → ${e.transferTo} | CCA ${formatEther(e.ccaAmount)}, transfer ${formatEther(e.transferAmount)}`,
	);
}

// ── 4. Check idempotency: compare on-chain transfers to expected (Step 2) ───

console.log("\nChecking on-chain transfer state...");

const transferLogs = await publicClient.getContractEvents({
	address: TOKEN_ADDRESS,
	abi: erc20Abi,
	eventName: "Transfer",
	args: { from: disburser.address },
	fromBlock: BigInt(ccaEndBlock),
	toBlock: currentBlock,
});

// Filter to only transfers that happened in txs sent to the Disperse contract.
const uniqueTxHashes = [...new Set(transferLogs.map((l) => l.transactionHash))];
const txDetails = await Promise.all(
	uniqueTxHashes.map((hash) => publicClient.getTransaction({ hash })),
);
const disperseTxHashes = new Set(
	txDetails
		.filter(
			(tx) =>
				tx.to?.toLowerCase() === DISPERSE_ADDRESS.toLowerCase(),
		)
		.map((tx) => tx.hash),
);

const disperseTransferLogs = transferLogs.filter((l) =>
	disperseTxHashes.has(l.transactionHash),
);

// Group by txHash, preserving log order within each tx.
const onChainBatches: { txHash: Hex; transfers: { to: Address; amount: bigint }[] }[] = [];
const batchByTxHash = new Map<Hex, { to: Address; amount: bigint }[]>();
for (const log of disperseTransferLogs) {
	const to = required(log.args.to, "Transfer.to") as Address;
	const amount = required(log.args.value, "Transfer.value");
	let batch = batchByTxHash.get(log.transactionHash);
	if (!batch) {
		batch = [];
		batchByTxHash.set(log.transactionHash, batch);
		onChainBatches.push({ txHash: log.transactionHash, transfers: batch });
	}
	batch.push({ to, amount });
}

console.log(
	`  Found ${onChainBatches.length} existing Disperse batch(es) with ${disperseTransferLogs.length} transfer(s)`,
);

// Walk expected entries, consuming on-chain batches in order.
let expectedIdx = 0;
for (const batch of onChainBatches) {
	for (const transfer of batch.transfers) {
		if (expectedIdx >= expectedEntries.length) {
			throw new Error(
				`Idempotency broken: found on-chain transfer (to=${transfer.to}, amount=${transfer.amount}) beyond expected entry list.`,
			);
		}
		const expected = expectedEntries[expectedIdx];
		if (
			transfer.to.toLowerCase() !== expected.transferTo.toLowerCase() ||
			transfer.amount !== expected.transferAmount
		) {
			throw new Error(
				`Idempotency broken at entry ${expectedIdx} (${expected.label}):\n` +
					`  expected: to=${expected.transferTo}, amount=${expected.transferAmount}\n` +
					`  on-chain: to=${transfer.to}, amount=${transfer.amount}`,
			);
		}
		expectedIdx++;
	}
}

const completedEntries = expectedIdx;
const remainingEntries = expectedEntries.slice(completedEntries);

console.log(
	`  ${completedEntries} entries already on-chain, ${remainingEntries.length} remaining`,
);

if (remainingEntries.length === 0) {
	console.log("\nAll transfers already executed on-chain.");
}

// ── 5. Check tracker recording idempotency (Step 4 read/reconcile) ──────────

console.log("\nChecking tracker recording state...");

const disbursementLogs = await publicClient.getContractEvents({
	address: TRACKER_ADDRESS,
	abi: trackerAbi,
	eventName: "DisbursementCompleted",
	fromBlock: BigInt(ccaEndBlock),
	toBlock: currentBlock,
});

let trackerIdx = 0;
for (const log of disbursementLogs) {
	if (trackerIdx >= expectedEntries.length) {
		throw new Error(
			"Idempotency broken: more DisbursementCompleted events on-chain than expected entries.",
		);
	}
	const expected = expectedEntries[trackerIdx];
	const to = required(log.args.to, "DisbursementCompleted.to") as Address;
	const value = required(log.args.value, "DisbursementCompleted.value");
	if (
		to.toLowerCase() !== expected.trackerRecipient.toLowerCase() ||
		value !== expected.ccaAmount
	) {
		throw new Error(
			`Tracker idempotency broken at entry ${trackerIdx} (${expected.label}):\n` +
				`  expected: to=${expected.trackerRecipient}, ccaAmount=${expected.ccaAmount}\n` +
				`  on-chain: to=${to}, value=${value}`,
		);
	}
	trackerIdx++;
}

const trackerRecordedCount = trackerIdx;
console.log(
	`  ${trackerRecordedCount} entries already recorded on tracker, ${expectedEntries.length - trackerRecordedCount} remaining`,
);

// ── 6. Execute remaining Disperse batches and record on tracker (Steps 3&4) ─

if (remainingEntries.length > 0) {
	const remainingTransferTotal = sumOf(
		remainingEntries.map((e) => e.transferAmount),
	);

	const disburserBalance = await publicClient.readContract({
		address: TOKEN_ADDRESS,
		abi: erc20Abi,
		functionName: "balanceOf",
		args: [disburser.address],
	});

	if (disburserBalance < remainingTransferTotal) {
		throw new Error(
			`Insufficient token balance. Has ${formatEther(disburserBalance)}, needs ${formatEther(remainingTransferTotal)}.`,
		);
	}

	console.log(
		`\n  Disburser balance: ${formatEther(disburserBalance)}, needed: ${formatEther(remainingTransferTotal)}`,
	);

	// Approve Disperse to spend the remaining total.
	if (!DRY_RUN) {
		console.log(
			`  Approving Disperse contract for ${formatEther(remainingTransferTotal)} tokens...`,
		);
		const approveHash = await walletClient.writeContract({
			address: TOKEN_ADDRESS,
			abi: erc20Abi,
			functionName: "approve",
			args: [DISPERSE_ADDRESS, remainingTransferTotal],
		});
		await publicClient.waitForTransactionReceipt({ hash: approveHash });
		console.log(`    tx: ${approveHash}`);
	} else {
		console.log(
			`  [dry-run] Would approve Disperse for ${formatEther(remainingTransferTotal)} tokens`,
		);
	}

	// Chunk remaining entries into batches using gas estimation.
	const batches: DisbursementEntry[][] = [];
	let cursor = 0;
	while (cursor < remainingEntries.length) {
		let batchSize = remainingEntries.length - cursor;

		while (batchSize > 0) {
			const batch = remainingEntries.slice(cursor, cursor + batchSize);
			const disperseRecipients = batch.map((e) => e.transferTo);
			const disperseAmounts = batch.map((e) => e.transferAmount);
			const trackerRecipients = batch.map((e) => e.trackerRecipient);
			const trackerValues = batch.map((e) => e.ccaAmount);
			const dummyHashes = batch.map(
				() =>
					"0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
			);
			const dummyIndices = batch.map((_, i) => BigInt(i));

			try {
				const [disperseGas, trackerGas] = await Promise.all([
					publicClient.estimateContractGas({
						address: DISPERSE_ADDRESS,
						abi: disperseAbi,
						functionName: "disperseTokenSimple",
						args: [TOKEN_ADDRESS, disperseRecipients, disperseAmounts],
						account: disburser,
					}),
					publicClient.estimateContractGas({
						address: TRACKER_ADDRESS,
						abi: trackerAbi,
						functionName: "recordDisbursements",
						args: [
							trackerRecipients,
							trackerValues,
							dummyHashes,
							dummyIndices,
						],
						account: disburser,
					}),
				]);

				const maxGas = disperseGas > trackerGas ? disperseGas : trackerGas;
				// Arbitrum has high gas limits; use 80% of block gas as safety margin.
				const block = await publicClient.getBlock();
				if (maxGas < (block.gasLimit * 80n) / 100n) {
					break;
				}
			} catch {
				// Gas estimation failed (likely too large), reduce batch size.
			}

			batchSize = Math.floor(batchSize / 2);
			if (batchSize === 0) {
				throw new Error(
					"Cannot fit even a single entry in a batch. Gas estimation keeps failing.",
				);
			}
		}

		batches.push(remainingEntries.slice(cursor, cursor + batchSize));
		cursor += batchSize;
	}

	console.log(
		`\n  Split into ${batches.length} batch(es): [${batches.map((b) => b.length).join(", ")}]`,
	);

	// Execute each batch: Disperse, then immediately record on tracker.
	let globalEntryIdx = completedEntries;
	for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
		const batch = batches[batchIdx];
		const recipients = batch.map((e) => e.transferTo);
		const amounts = batch.map((e) => e.transferAmount);

		console.log(
			`\n  Batch ${batchIdx + 1}/${batches.length} (${batch.length} entries):`,
		);
		for (const e of batch) {
			console.log(
				`    ${e.label}: ${e.trackerRecipient} → ${e.transferTo} | ${formatEther(e.transferAmount)}`,
			);
		}

		let disperseTxHash: Hex;
		if (DRY_RUN) {
			console.log(
				`  [dry-run] Would call disperseTokenSimple(${TOKEN_ADDRESS}, [${recipients.join(", ")}], [${amounts.join(", ")}])`,
			);
			disperseTxHash =
				"0x0000000000000000000000000000000000000000000000000000000000000000";
		} else {
			console.log("  Executing disperseTokenSimple...");
			disperseTxHash = await walletClient.writeContract({
				address: DISPERSE_ADDRESS,
				abi: disperseAbi,
				functionName: "disperseTokenSimple",
				args: [TOKEN_ADDRESS, recipients, amounts],
			});
			await publicClient.waitForTransactionReceipt({
				hash: disperseTxHash,
			});
			console.log(`    tx: ${disperseTxHash}`);
		}

		// Check if this batch's tracker recording is already done (crash recovery).
		const batchTrackerEnd = globalEntryIdx + batch.length;
		const alreadyRecorded = batchTrackerEnd <= trackerRecordedCount;

		if (alreadyRecorded) {
			console.log(
				"  Tracker recording already done for this batch (crash recovery).",
			);
		} else {
			const trackerRecipients = batch.map((e) => e.trackerRecipient);
			const trackerValues = batch.map((e) => e.ccaAmount);
			const txHashes = batch.map(() => disperseTxHash as `0x${string}`);
			const txIndices = batch.map((_, i) => BigInt(i));

			if (DRY_RUN) {
				console.log(
					"  [dry-run] Would call recordDisbursements with:",
				);
				for (let i = 0; i < batch.length; i++) {
					console.log(
						`    ${trackerRecipients[i]}: CCA ${formatEther(trackerValues[i])}, txHash ${txHashes[i]}, txIndex ${txIndices[i]}`,
					);
				}
			} else {
				console.log("  Recording disbursements on tracker...");
				const recordHash = await walletClient.writeContract({
					address: TRACKER_ADDRESS,
					abi: trackerAbi,
					functionName: "recordDisbursements",
					args: [
						trackerRecipients,
						trackerValues,
						txHashes,
						txIndices,
					],
				});
				await publicClient.waitForTransactionReceipt({
					hash: recordHash,
				});
				console.log(`    tx: ${recordHash}`);
			}
		}

		globalEntryIdx = batchTrackerEnd;
	}
}

// ── Final state ─────────────────────────────────────────────────────────────

if (!DRY_RUN) {
	const fullyDisbursed = await publicClient.readContract({
		address: TRACKER_ADDRESS,
		abi: trackerAbi,
		functionName: "saleFullyDisbursed",
	});
	console.log(`\nSale fully disbursed: ${fullyDisbursed}`);
} else {
	console.log("\n*** Dry run complete. No transactions were broadcast. ***");
}
