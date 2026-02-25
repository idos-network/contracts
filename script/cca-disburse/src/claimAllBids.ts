/**
 * Claim all unclaimed CCA bids: exit any unexited bids, then claim tokens (batch per owner).
 *
 * Uses the same .env as the main cca-disburse script: CHAIN_ID, RPC_URL, CCA_ADDRESS,
 * and PRIVATE_KEY (or DISBURSER_PRIVATE_KEY) for sending transactions. Anyone can call
 * exit/claim; tokens are sent to the bid owner.
 *
 * Usage: pnpm exec tsx src/claimAllBids.ts
 */

import "dotenv/config";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	getAddress,
	getContract,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia, sepolia } from "viem/chains";
import { ccaAbi } from "./abis";
import {
	assertCondition,
	contractHasCode,
	ensureHex,
	paginatedGetEvents,
	requiredArgs,
	requireEnv,
} from "./lib";

const SUPPORTED_CHAINS = {
	[String(arbitrumSepolia.id)]: arbitrumSepolia,
	[String(arbitrum.id)]: arbitrum,
	[String(sepolia.id)]: sepolia,
} as const;

const CHAIN_ID = requireEnv("CHAIN_ID");
const RPC_URL = requireEnv("RPC_URL");
const CCA_ADDRESS = getAddress(requireEnv("CCA_ADDRESS"));
const PRIVATE_KEY = ensureHex(
	process.env.PRIVATE_KEY ?? requireEnv("DISBURSER_PRIVATE_KEY"),
);

const chain = SUPPORTED_CHAINS[CHAIN_ID];
assertCondition(
	chain !== undefined,
	`Unsupported CHAIN_ID: ${CHAIN_ID}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`,
);

const publicClient = createPublicClient({
	chain,
	transport: http(RPC_URL),
});

const walletClient = createWalletClient({
	chain,
	transport: http(RPC_URL),
	account: privateKeyToAccount(PRIVATE_KEY),
});

const ccaContract = getContract({
	address: CCA_ADDRESS,
	abi: ccaAbi,
	client: { public: publicClient, wallet: walletClient },
});

async function main() {
	const rpcChainId = await publicClient.getChainId();
	assertCondition(
		rpcChainId === chain.id,
		`RPC_URL points to chain ${rpcChainId}, expected ${chain.id} (${chain.name}).`,
	);
	console.log(`✅ RPC connected to ${chain.name} (chain ${rpcChainId}).`);

	assertCondition(
		await contractHasCode(publicClient, ccaContract),
		`No contract at ${CCA_ADDRESS} on chain ${chain.id}.`,
	);

	const [ccaStartBlock, ccaEndBlock, claimBlock, currentBlock] =
		await Promise.all([
			ccaContract.read.startBlock(),
			ccaContract.read.endBlock(),
			ccaContract.read.claimBlock(),
			publicClient.getBlockNumber(),
		]);

	assertCondition(
		currentBlock >= ccaEndBlock,
		`Auction not ended. Current block ${currentBlock}, end block ${ccaEndBlock}.`,
	);
	assertCondition(
		currentBlock >= claimBlock,
		`Claim block not reached. Current block ${currentBlock}, claim block ${claimBlock}.`,
	);

	console.log(`CCA: ${CCA_ADDRESS}`);
	console.log(
		`Blocks: start ${ccaStartBlock}, end ${ccaEndBlock}, claim ${claimBlock}, current ${currentBlock}\n`,
	);

	const [bidLogs, claimLogs] = await Promise.all([
		paginatedGetEvents(
			(r) => ccaContract.getEvents.BidSubmitted({}, r),
			ccaStartBlock,
			ccaEndBlock,
		),
		paginatedGetEvents(
			(r) => ccaContract.getEvents.TokensClaimed({}, r),
			ccaEndBlock,
			currentBlock,
		),
	]);

	const claimedIds = new Set(claimLogs.map((l) => requiredArgs(l).bidId));
	const submissions = bidLogs.map((l) => {
		const { id: bidId, owner } = requiredArgs(l);
		return { bidId, owner: getAddress(owner) };
	});

	const unclaimed = submissions.filter((s) => !claimedIds.has(s.bidId));
	if (unclaimed.length > 0) {
		console.log(`Unclaimed bids: ${unclaimed.length}\n`);
	} else {
		console.log("No unclaimed bids.");
	}

	const startBlock = ccaStartBlock;

	for (const { bidId } of unclaimed) {
		const bid = await ccaContract.read.bids([bidId]);
		const exited = bid.exitedBlock !== 0n;

		if (!exited) {
			try {
				const hash = await ccaContract.write.exitBid([bidId]);
				await publicClient.waitForTransactionReceipt({ hash });
				console.log(`Exited bid ${bidId}`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const isCannotExitBid =
					msg.includes("CannotExitBid") || msg.includes("0x0ba98457"); // CannotExitBid() selector
				if (!isCannotExitBid) throw e;
				// Partially filled: try exit at end (outbidBlock = 0) then outbid (outbidBlock = endBlock - 1)
				try {
					const hash = await ccaContract.write.exitPartiallyFilledBid([
						bidId,
						startBlock,
						0n,
					]);
					await publicClient.waitForTransactionReceipt({ hash });
					console.log(`Exited bid ${bidId} (partially filled at end)`);
				} catch {
					const outbidBlock = ccaEndBlock > 0n ? ccaEndBlock - 1n : 0n;
					const hash = await ccaContract.write.exitPartiallyFilledBid([
						bidId,
						startBlock,
						outbidBlock,
					]);
					await publicClient.waitForTransactionReceipt({ hash });
					console.log(`Exited bid ${bidId} (outbid)`);
				}
			}
		}
	}

	const byOwner = new Map<Address, bigint[]>();
	for (const { bidId, owner } of unclaimed) {
		const list = byOwner.get(owner) ?? [];
		list.push(bidId);
		byOwner.set(owner, list);
	}

	for (const [owner, bidIds] of byOwner) {
		if (bidIds.length === 1) {
			const singleId = bidIds[0];
			if (singleId === undefined) continue;
			const hash = await ccaContract.write.claimTokens([singleId]);
			await publicClient.waitForTransactionReceipt({ hash });
			console.log(`Claimed bid ${singleId} for ${owner}`);
		} else {
			const hash = await ccaContract.write.claimTokensBatch([owner, bidIds]);
			await publicClient.waitForTransactionReceipt({ hash });
			console.log(`Claimed ${bidIds.length} bids for ${owner}`);
		}
	}

	// Sweep unsold tokens if not already done (required for tracker to consider sale fully claimed)
	const sweepBlock = await ccaContract.read.sweepUnsoldTokensBlock();
	if (sweepBlock === 0n) {
		const hash = await ccaContract.write.sweepUnsoldTokens();
		await publicClient.waitForTransactionReceipt({ hash });
		console.log("Swept unsold tokens.");
	} else {
		console.log("Tokens already swept (sweepUnsoldTokensBlock != 0).");
	}

	console.log("\nDone.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
