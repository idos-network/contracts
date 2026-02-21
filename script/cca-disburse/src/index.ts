import "dotenv/config";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	formatEther,
	getContract,
	type Hex,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { ccaAbi, disperseAbi, erc20Abi, trackerAbi } from "./abis";
import { computeDisbursement } from "./computeDisbursement";
import { findFirstBlockAtOrAfter } from "./findFirstBlockAtOrAfter";
import {
	assertCondition,
	ensureHex,
	iso8601ToTimestamp,
	requiredArgs,
	requireEnv,
	splitBy,
	sumOf,
} from "./lib";

const DRY_RUN = process.argv.includes("--dry-run");
if (DRY_RUN)
	console.log("*** DRY RUN — no transactions will be broadcast ***\n");

const RPC_URL = requireEnv("RPC_URL");
const DISBURSER_PRIVATE_KEY = requireEnv("DISBURSER_PRIVATE_KEY");
const TRACKER_ADDRESS = requireEnv("TRACKER_ADDRESS") as Address;
const CCA_ADDRESS = requireEnv("CCA_ADDRESS") as Address;
const SOLD_TOKEN_ADDRESS = requireEnv("SOLD_TOKEN_ADDRESS") as Address;
const DISPERSE_ADDRESS = requireEnv("DISPERSE_ADDRESS") as Address;
const TOKENOPS_ADDRESS = requireEnv("TOKENOPS_ADDRESS") as Address;
const NORMAL_PHASE_START = requireEnv("NORMAL_PHASE_START");

const disburser = privateKeyToAccount(ensureHex(DISBURSER_PRIVATE_KEY));

const publicClient = createPublicClient({
	chain: arbitrumSepolia,
	transport: http(RPC_URL),
});

const disburserClient = createWalletClient({
	chain: arbitrumSepolia,
	transport: http(RPC_URL),
	account: disburser,
});

const ccaContract = getContract({
	address: CCA_ADDRESS,
	abi: ccaAbi,
	client: publicClient,
});

const trackerContract = getContract({
	address: TRACKER_ADDRESS,
	abi: trackerAbi,
	client: disburserClient,
});

const soldTokenContract = getContract({
	address: SOLD_TOKEN_ADDRESS,
	abi: erc20Abi,
	client: disburserClient,
});

interface DisbursementEntry {
	to: Address;
	transferTo: Address;
	ccaAmount: bigint;
	transferAmount: bigint;
	label: string;
}

// ── 1. Fetch CCA data, resolve phase boundary, compute filled bids ──────────

const ccaStartBlock = await ccaContract.read.startBlock();
const ccaEndBlock = await ccaContract.read.endBlock();
const currentBlock = await publicClient.getBlockNumber();

assertCondition(
	currentBlock >= ccaEndBlock,
	`CCA end block is in the future. We're at block ${currentBlock} and need to wait for block ${ccaEndBlock} to be mined.`,
);

const phaseBoundaryBlock = await findFirstBlockAtOrAfter(
	iso8601ToTimestamp(NORMAL_PHASE_START),
	ccaStartBlock,
	ccaEndBlock,
	async (blockNumber) =>
		(await publicClient.getBlock({ blockNumber })).timestamp,
);

const [bidLogs, claimLogs, sweepLogs] = await Promise.all([
	ccaContract.getEvents.BidSubmitted(
		{},
		{
			fromBlock: ccaStartBlock,
			toBlock: ccaEndBlock,
		},
	),
	ccaContract.getEvents.TokensClaimed(
		{},
		{
			fromBlock: ccaStartBlock,
			toBlock: currentBlock,
		},
	),
	ccaContract.getEvents.TokensSwept(
		{},
		{
			fromBlock: ccaStartBlock,
			toBlock: currentBlock,
		},
	),
]);

const bidSubmissions = bidLogs.map((l) => {
	const { id: bidId, owner } = requiredArgs(l);
	return { bidId, owner, blockNumber: l.blockNumber };
});

// TokensClaimed is the only event that matters for token amounts. BidExited
// records the same tokensFilled value earlier (during exit), but the actual
// token transfer (and thus the tracker's MissingDisbursementRecorded) only
// happens at claim time.
const tokensClaims = claimLogs.map((l) => requiredArgs(l));

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

assertCondition(
	sweepLogs.length > 0,
	"No TokensSwept event found. Call sweepUnsoldTokens on the CCA contract first.",
);
const sweepLog = requiredArgs(sweepLogs[0]);
const sweep = {
	recipient: sweepLog.tokensRecipient,
	amount: sweepLog.tokensAmount,
};

assertCondition(
	await trackerContract.read.saleFullyClaimed(),
	"Sale is not fully claimed yet. Wait for all claimTokens/sweepUnsoldTokens calls.",
);

const onChainDisburser = await trackerContract.read.disburser();
assertCondition(
	onChainDisburser.toLowerCase() === disburser.address.toLowerCase(),
	`${disburser.address} is not the disburser (expected ${onChainDisburser}).`,
);

// ── 2. Compute the full expected entry list ─────────────────────────────────
//
// The tracker only sees pre-bonus CCA amounts. The actual token movements
// include the bonus, so transferAmount intentionally differs from ccaAmount
// for whale entries.

const expectedEntries: DisbursementEntry[] = [];

const bidderAddresses = [
	...new Set(filledBids.map((b) => b.owner.toLowerCase() as Address)),
].sort();

for (const addr of bidderAddresses) {
	const [whaleBids, normalBids] = splitBy(
		filledBids.filter((b) => b.owner.toLowerCase() === addr.toLowerCase()),
		(b) => b.bidBlockNumber < phaseBoundaryBlock,
	);

	const r = computeDisbursement(
		sumOf(whaleBids.map((b) => b.tokensFilled)),
		sumOf(normalBids.map((b) => b.tokensFilled)),
	);

	if (r.ccaNormal > 0n) {
		expectedEntries.push({
			to: addr,
			ccaAmount: r.ccaNormal,
			transferTo: addr,
			transferAmount: r.disbursableNormalImmediately,
			label: "normal",
		});
	}

	if (r.ccaWhaleImmediate > 0n) {
		expectedEntries.push({
			to: addr,
			ccaAmount: r.ccaWhaleImmediate,
			transferTo: addr,
			transferAmount: r.disbursableWhaleImmediately,
			label: "whale immediate",
		});
	}

	if (r.ccaWhaleVested > 0n) {
		expectedEntries.push({
			to: addr,
			ccaAmount: r.ccaWhaleVested,
			transferTo: TOKENOPS_ADDRESS,
			transferAmount: r.disbursableWhaleVested,
			label: "whale vested",
		});
	}
}

if (sweep.amount > 0n) {
	expectedEntries.push({
		to: sweep.recipient,
		ccaAmount: sweep.amount,
		transferTo: sweep.recipient,
		transferAmount: sweep.amount,
		label: "sweep",
	});
}

// ── 3. Discover what Disperse batches have already been executed on-chain ───

const transferLogs = await soldTokenContract.getEvents.Transfer(
	{
		from: disburser.address,
	},
	{
		fromBlock: ccaEndBlock,
		toBlock: currentBlock,
	},
);
const observedTransfers = transferLogs.map((l) => {
	const { to: transferTo, value: transferAmount } = requiredArgs(l);
	return { txHash: l.transactionHash, transferTo, transferAmount };
});

const disbursementLogs = await trackerContract.getEvents.DisbursementCompleted(
	{},
	{
		fromBlock: ccaEndBlock,
		toBlock: currentBlock,
	},
);
const observedDisbursements = disbursementLogs.map((l) => requiredArgs(l));

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

const disbursementLogs_ = await publicClient.getContractEvents({
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
	const { to, value } = requiredArgs(log);
	if (
		to.toLowerCase() !== expected.to.toLowerCase() ||
		value !== expected.ccaAmount
	) {
		throw new Error(
			`Tracker idempotency broken at entry ${trackerIdx} (${expected.label}):\n` +
				`  expected: to=${expected.to}, ccaAmount=${expected.ccaAmount}\n` +
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
		address: SOLD_TOKEN_ADDRESS,
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
		const approveHash = await disburserClient.writeContract({
			address: SOLD_TOKEN_ADDRESS,
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
			const trackerRecipients = batch.map((e) => e.to);
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
						args: [SOLD_TOKEN_ADDRESS, disperseRecipients, disperseAmounts],
						account: disburser,
					}),
					publicClient.estimateContractGas({
						address: TRACKER_ADDRESS,
						abi: trackerAbi,
						functionName: "recordDisbursements",
						args: [trackerRecipients, trackerValues, dummyHashes, dummyIndices],
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
				`    ${e.label}: ${e.to} → ${e.transferTo} | ${formatEther(e.transferAmount)}`,
			);
		}

		let disperseTxHash: Hex;
		if (DRY_RUN) {
			console.log(
				`  [dry-run] Would call disperseTokenSimple(${SOLD_TOKEN_ADDRESS}, [${recipients.join(", ")}], [${amounts.join(", ")}])`,
			);
			disperseTxHash =
				"0x0000000000000000000000000000000000000000000000000000000000000000";
		} else {
			console.log("  Executing disperseTokenSimple...");
			disperseTxHash = await disburserClient.writeContract({
				address: DISPERSE_ADDRESS,
				abi: disperseAbi,
				functionName: "disperseTokenSimple",
				args: [SOLD_TOKEN_ADDRESS, recipients, amounts],
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
			const trackerRecipients = batch.map((e) => e.to);
			const trackerValues = batch.map((e) => e.ccaAmount);
			const txHashes = batch.map(() => disperseTxHash as `0x${string}`);
			const txIndices = batch.map((_, i) => BigInt(i));

			if (DRY_RUN) {
				console.log("  [dry-run] Would call recordDisbursements with:");
				for (let i = 0; i < batch.length; i++) {
					console.log(
						`    ${trackerRecipients[i]}: CCA ${formatEther(trackerValues[i])}, txHash ${txHashes[i]}, txIndex ${txIndices[i]}`,
					);
				}
			} else {
				console.log("  Recording disbursements on tracker...");
				const recordHash = await disburserClient.writeContract({
					address: TRACKER_ADDRESS,
					abi: trackerAbi,
					functionName: "recordDisbursements",
					args: [trackerRecipients, trackerValues, txHashes, txIndices],
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
