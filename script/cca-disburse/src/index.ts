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
import { ccaAbi, erc20Abi, trackerAbi } from "./abis";
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

// ── 3. Reconcile on-chain transfers against expected entries ─────────────────

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
	const { to, value } = requiredArgs(l);
	return { txHash: l.transactionHash, to, amount: value };
});

if (observedTransfers.length > expectedEntries.length) {
	throw new Error(
		`Idempotency broken: found ${observedTransfers.length} on-chain transfers but only ${expectedEntries.length} expected entries.`,
	);
}

for (let i = 0; i < observedTransfers.length; i++) {
	const observed = observedTransfers[i];
	const expected = expectedEntries[i];
	if (
		observed.to.toLowerCase() !== expected.transferTo.toLowerCase() ||
		observed.amount !== expected.transferAmount
	) {
		throw new Error(
			`Idempotency broken at entry ${i} (${expected.label}):\n` +
				`  expected: to=${expected.transferTo}, amount=${expected.transferAmount}\n` +
				`  on-chain: to=${observed.to}, amount=${observed.amount}`,
		);
	}
}

const completedTransfers = observedTransfers.length;
const remainingEntries = expectedEntries.slice(completedTransfers);

console.log(
	`  ${completedTransfers} transfers already on-chain, ${remainingEntries.length} remaining`,
);

// ── 4. Reconcile tracker recordings against expected entries ────────────────

console.log("\nChecking tracker recording state...");

const disbursementLogs = await trackerContract.getEvents.DisbursementCompleted(
	{},
	{
		fromBlock: ccaEndBlock,
		toBlock: currentBlock,
	},
);

if (disbursementLogs.length > expectedEntries.length) {
	throw new Error(
		"Idempotency broken: more DisbursementCompleted events on-chain than expected entries.",
	);
}

for (let i = 0; i < disbursementLogs.length; i++) {
	const expected = expectedEntries[i];
	const { to, value } = requiredArgs(disbursementLogs[i]);
	if (
		to.toLowerCase() !== expected.to.toLowerCase() ||
		value !== expected.ccaAmount
	) {
		throw new Error(
			`Tracker idempotency broken at entry ${i} (${expected.label}):\n` +
				`  expected: to=${expected.to}, ccaAmount=${expected.ccaAmount}\n` +
				`  on-chain: to=${to}, value=${value}`,
		);
	}
}

const trackerRecordedCount = disbursementLogs.length;
console.log(
	`  ${trackerRecordedCount} entries already recorded on tracker, ${expectedEntries.length - trackerRecordedCount} remaining`,
);

// ── 5. Execute remaining transfers and record on tracker ────────────────────

if (remainingEntries.length === 0) {
	console.log("\nAll transfers already executed on-chain.");
} else {
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

	let globalEntryIdx = completedTransfers;
	for (const entry of remainingEntries) {
		console.log(
			`\n  ${entry.label}: ${entry.to} → ${entry.transferTo} | ${formatEther(entry.transferAmount)}`,
		);

		let txHash: Hex;
		if (DRY_RUN) {
			console.log(
				`    [dry-run] Would transfer ${formatEther(entry.transferAmount)} to ${entry.transferTo}`,
			);
			txHash =
				"0x0000000000000000000000000000000000000000000000000000000000000000";
		} else {
			txHash = await disburserClient.writeContract({
				address: SOLD_TOKEN_ADDRESS,
				abi: erc20Abi,
				functionName: "transfer",
				args: [entry.transferTo, entry.transferAmount],
			});
			await publicClient.waitForTransactionReceipt({ hash: txHash });
			console.log(`    transfer tx: ${txHash}`);
		}

		const alreadyRecorded = globalEntryIdx < trackerRecordedCount;
		if (alreadyRecorded) {
			console.log("    Tracker recording already present (crash recovery).");
		} else if (DRY_RUN) {
			console.log(
				`    [dry-run] Would record: ${entry.to} CCA ${formatEther(entry.ccaAmount)}, txHash ${txHash}, txIndex 0`,
			);
		} else {
			const recordHash = await disburserClient.writeContract({
				address: TRACKER_ADDRESS,
				abi: trackerAbi,
				functionName: "recordDisbursements",
				args: [[entry.to], [entry.ccaAmount], [txHash], [0n]],
			});
			await publicClient.waitForTransactionReceipt({ hash: recordHash });
			console.log(`    tracker tx: ${recordHash}`);
		}

		globalEntryIdx++;
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
