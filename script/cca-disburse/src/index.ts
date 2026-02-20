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
import { ccaAbi, erc20Abi, trackerAbi } from "./abis";
import {
	type BidderDisbursement,
	BPS_BASE,
	computeDisbursement,
	WHALE_IMMEDIATE_BPS,
} from "./computeDisbursement";
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

// ── Phase constants ─────────────────────────────────────────────────────────

const VESTING_SCHEDULE = {
	cliffSeconds: 0,
	trancheCount: 4,
	intervalMonths: 1,
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing event field: ${label}`);
	return value;
}

function ccaWhaleSplit(ccaWhale: bigint) {
	const immediate = (ccaWhale * WHALE_IMMEDIATE_BPS) / BPS_BASE;
	return { immediate, vested: ccaWhale - immediate };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
	const map = new Map<K, T[]>();
	for (const item of items) {
		const k = key(item);
		let group = map.get(k);
		if (!group) {
			group = [];
			map.set(k, group);
		}
		group.push(item);
	}
	return map;
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

interface BidSubmitted {
	bidId: bigint;
	owner: Address;
	blockNumber: bigint;
}

interface TokensClaimed {
	bidId: bigint;
	owner: Address;
	tokensFilled: bigint;
}

interface FilledBid {
	bidId: bigint;
	owner: Address;
	bidBlockNumber: bigint;
	tokensFilled: bigint;
}

// ── 1. Resolve phase boundary, fetch events, compute filled bids, and ensure preconditions.

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

const bidSubmissions: BidSubmitted[] = bidLogs.map((l) => ({
	bidId: required(l.args.id, "BidSubmitted.id"),
	owner: required(l.args.owner, "BidSubmitted.owner"),
	blockNumber: l.blockNumber,
}));

// We're not looking at TokenExited events. That's on purpose.
// TokensClaimed is the only event that matters for token amounts. BidExited
// records the same tokensFilled value earlier (during exit), but the actual
// token transfer (and thus the tracker's MissingDisbursementRecorded) only
// happens at claim time.

const tokensClaims: TokensClaimed[] = claimLogs.map((l) => ({
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
const filledBids: FilledBid[] = tokensClaims.map((tc) => {
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
	throw new Error("No TokensSwept event found. Call sweepUnsoldTokens on the CCA contract first.");
}
const sweep = {
	recipient: required(sweepLogs[0].args.tokensRecipient, "TokensSwept.tokensRecipient"),
	amount: required(sweepLogs[0].args.tokensAmount, "TokensSwept.tokensAmount"),
};

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

const disburserBalance = await publicClient.readContract({
	address: TOKEN_ADDRESS,
	abi: erc20Abi,
	functionName: "balanceOf",
	args: [disburser.address],
});
const totalNeeded = filledBids.reduce((acc, bid) => acc + bid.tokensFilled, 0n) + sweep.amount;
if (disburserBalance < totalNeeded) {
	throw new Error(
		`Insufficient token balance. Has ${formatEther(disburserBalance)}, needs ${formatEther(totalNeeded)}.`,
	);
}

// ── 5. Execute (or dry-run) ─────────────────────────────────────────────────
//
// Each bidder produces up to 3 tracker record entries, each tied to its own tx:
//   1. Normal phase: tracker records ccaNormal, tx sends disbursableNormalImmediately
//   2. Whale immediate: tracker records ccaWhale*25%, tx sends disbursableWhaleImmediately
//   3. Whale vested: tracker records ccaWhale*75%, tx sends disbursableWhaleVested to TokenOps

const ZERO_HASH: Hex =
	"0x0000000000000000000000000000000000000000000000000000000000000000";

const recordRecipients: Address[] = [];
const recordValues: bigint[] = [];
const recordTxHashes: Hex[] = [];

async function transfer(
	to: Address,
	amount: bigint,
	label: string,
): Promise<Hex> {
	if (DRY_RUN) {
		console.log(
			`  [dry-run] ${label}: would transfer ${formatEther(amount)} tokens to ${to}`,
		);
		console.log(`    → token.transfer(${to}, ${amount})`);
		return ZERO_HASH;
	}
	console.log(
		`  ${label}: transferring ${formatEther(amount)} tokens to ${to}...`,
	);
	const hash = await walletClient.writeContract({
		address: TOKEN_ADDRESS,
		abi: erc20Abi,
		functionName: "transfer",
		args: [to, amount],
	});
	await publicClient.waitForTransactionReceipt({ hash });
	console.log(`    tx: ${hash}`);
	return hash;
}

// TODO: find the right place for this comment.
// The tracker only sees pre-bonus CCA amounts. The actual token movements
// include the bonus, so the tx amounts intentionally differ from the tracker
// record amounts.

for (const [addr, fbs] of groupBy(filledBids, (b) => b.owner)) {
	const onChainMissing = await publicClient.readContract({
		address: TRACKER_ADDRESS,
		abi: trackerAbi,
		functionName: "missingDisbursementTo",
		args: [addr],
	});

	if (onChainMissing === 0n) {
		console.log(`[SKIP] ${addr}: already fully disbursed on tracker`);
		continue;
	}

	console.log(`[DISBURSE] ${addr}:`);

	let remainingToRecord = onChainMissing;

	const [whaleFilledBids, normalFilledBids] = splitBy(
		fbs,
		(b) => b.bidBlockNumber < phaseBoundaryBlock,
	);

	const r = computeDisbursement(
		whaleFilledBids.map((fb) => fb.tokensFilled).reduce((acc, b) => acc + b, 0n),
		normalFilledBids.map((fb) => fb.tokensFilled).reduce((acc, b) => acc + b, 0n),
	)

	const { immediate: ccaWhaleImmediate, vested: ccaWhaleVested } =
		ccaWhaleSplit(r.ccaWhale);

	// Entry 1: Normal phase — transfer disbursableNormalImmediately directly to bidder
	if (r.ccaNormal > 0n && remainingToRecord > 0n) {
		const ccaAmount =
			r.ccaNormal < remainingToRecord ? r.ccaNormal : remainingToRecord;
		const txHash = await transfer(
			addr,
			r.disbursableNormalImmediately,
			"normal",
		);
		recordRecipients.push(addr);
		recordValues.push(ccaAmount);
		recordTxHashes.push(txHash);
		remainingToRecord -= ccaAmount;
	}

	// Entry 2: Whale immediate — transfer disbursableWhaleImmediately (bonus-adjusted) to bidder,
	//          but record ccaWhale*25% (pre-bonus) on tracker
	if (ccaWhaleImmediate > 0n && remainingToRecord > 0n) {
		const ccaAmount =
			ccaWhaleImmediate < remainingToRecord
				? ccaWhaleImmediate
				: remainingToRecord;
		const txHash = await transfer(
			addr,
			r.disbursableWhaleImmediately,
			"whale immediate",
		);
		recordRecipients.push(addr);
		recordValues.push(ccaAmount);
		recordTxHashes.push(txHash);
		remainingToRecord -= ccaAmount;
	}

	// Entry 3: Whale vested — transfer disbursableWhaleVested (bonus-adjusted) to TokenOps,
	//          but record ccaWhale*75% (pre-bonus) on tracker
	if (ccaWhaleVested > 0n && remainingToRecord > 0n) {
		const ccaAmount =
			ccaWhaleVested < remainingToRecord ? ccaWhaleVested : remainingToRecord;

		if (DRY_RUN) {
			console.log(
				`  [dry-run] whale vested: would send ${formatEther(r.disbursableWhaleVested)} tokens to TokenOps for ${addr}`,
			);
			console.log(
				`    → TokenOps: beneficiary=${addr}, amount=${r.disbursableWhaleVested}, cliff=${VESTING_SCHEDULE.cliffSeconds}s, ${VESTING_SCHEDULE.trancheCount} tranches over ${VESTING_SCHEDULE.trancheCount * VESTING_SCHEDULE.intervalMonths}mo`,
			);
		} else {
			// TODO: Replace with actual TokenOps contract call and use its tx hash.
			console.log(
				`  [TokenOps placeholder] whale vested: would send ${formatEther(r.disbursableWhaleVested)} tokens to TokenOps for ${addr}`,
			);
			console.log(
				`    Schedule: ${VESTING_SCHEDULE.trancheCount} tranches, ${VESTING_SCHEDULE.intervalMonths}mo interval, ${VESTING_SCHEDULE.cliffSeconds}s cliff`,
			);
		}

		recordRecipients.push(addr);
		recordValues.push(ccaAmount);
		recordTxHashes.push(ZERO_HASH);
		remainingToRecord -= ccaAmount;
	}
}

// Sweep: return unsold tokens to tokensRecipient (no bonus, no vesting)
if (sweep.amount > 0n) {
	const sweepMissing = await publicClient.readContract({
		address: TRACKER_ADDRESS,
		abi: trackerAbi,
		functionName: "missingDisbursementTo",
		args: [sweep.recipient],
	});

	if (sweepMissing === 0n) {
		console.log(
			`[SKIP] ${sweep.recipient} (sweep): already disbursed on tracker`,
		);
	} else {
		console.log(
			`[SWEEP] ${sweep.recipient}: ${formatEther(sweep.amount)} unsold tokens`,
		);
		const txHash = await transfer(sweep.recipient, sweep.amount, "sweep");
		const recordAmount =
			sweepMissing < sweep.amount ? sweepMissing : sweep.amount;
		recordRecipients.push(sweep.recipient);
		recordValues.push(recordAmount);
		recordTxHashes.push(txHash);
	}
}

// Batch recordDisbursements
if (recordRecipients.length > 0) {
	console.log(
		`\nRecording ${recordRecipients.length} disbursement(s) on tracker...`,
	);

	if (DRY_RUN) {
		console.log(`  [dry-run] Would call tracker.recordDisbursements with:`);
		for (let i = 0; i < recordRecipients.length; i++) {
			console.log(
				`    ${recordRecipients[i]}: CCA amount ${formatEther(recordValues[i])}, txHash ${recordTxHashes[i]}`,
			);
		}
	} else {
		const hash = await walletClient.writeContract({
			address: TRACKER_ADDRESS,
			abi: trackerAbi,
			functionName: "recordDisbursements",
			args: [recordRecipients, recordValues, recordTxHashes],
		});
		const receipt = await publicClient.waitForTransactionReceipt({ hash });
		console.log(`  Tx: ${hash} (status: ${receipt.status})`);
	}
} else {
	console.log("\nNo disbursements to record (all already processed).");
}

// Final state
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
