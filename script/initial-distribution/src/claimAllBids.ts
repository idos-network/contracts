/**
 * Claim all unclaimed CCA bids: exit any unexited bids, then claim tokens (batch per owner).
 *
 * Uses the same .env as the main initial-distribution script: CHAIN_ID, RPC_URL, CCA_ADDRESS,
 * and DISBURSER_PRIVATE_KEY for sending transactions. Anyone can call
 * exit/claim; tokens are sent to the bid owner.
 *
 * Usage: pnpm exec tsx src/claimAllBids.ts
 */

import "dotenv/config";
import { type Address, getAddress, getContract } from "viem";
import { ccaAbi } from "./abis.js";
import { chainSetup } from "./chains.js";
import {
  assertCondition,
  contractHasCode,
  ensureHex,
  paginatedGetEvents,
  requiredArgs,
  requireEnv,
} from "./lib.js";

const CCA_ADDRESS = getAddress(requireEnv("CCA_ADDRESS"));
const CHAIN_ID = requireEnv("CHAIN_ID");
const DISBURSER_PRIVATE_KEY = ensureHex(requireEnv("DISBURSER_PRIVATE_KEY"));
const RPC_URL = requireEnv("RPC_URL");

const { chain, publicClient, walletClient } = await chainSetup(
  CHAIN_ID,
  RPC_URL,
  DISBURSER_PRIVATE_KEY,
);

const ccaContract = getContract({
  address: CCA_ADDRESS,
  abi: ccaAbi,
  client: { public: publicClient, wallet: walletClient },
});

type BidState = Awaited<ReturnType<typeof ccaContract.read.bids>>;

async function main() {
  assertCondition(
    await contractHasCode(publicClient, ccaContract),
    `No contract at ${CCA_ADDRESS} on chain ${chain.id}.`,
  );

  const [ccaStartBlock, ccaEndBlock, ccaClaimBlock, currentBlock] = await Promise.all([
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
    currentBlock >= ccaClaimBlock,
    `Claim block not reached. Current block ${currentBlock}, claim block ${ccaClaimBlock}.`,
  );

  console.log(`CCA: ${CCA_ADDRESS}`);
  console.log(
    `Blocks: start ${ccaStartBlock}, end ${ccaEndBlock}, claim ${ccaClaimBlock}, current ${currentBlock}\n`,
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

  const bidStates = (await publicClient.multicall({
    contracts: unclaimed.map(({ bidId }) => ({
      address: CCA_ADDRESS,
      abi: ccaAbi,
      functionName: "bids",
      args: [bidId],
    })),
    allowFailure: false,
  })) as unknown as BidState[];
  const bidByBidId = new Map(unclaimed.map((u, i) => [u.bidId, bidStates[i]]));

  for (const { bidId } of unclaimed) {
    // biome-ignore lint/style/noNonNullAssertion: We just fetched the bid states, so it must exist
    const bid = bidByBidId.get(bidId)!;
    const exited = bid.exitedBlock !== 0n;

    if (!exited) {
      try {
        const hash = await ccaContract.write.exitBid([bidId]);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`Exited bid ${bidId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isCannotExitBid = msg.includes("CannotExitBid") || msg.includes("0x0ba98457"); // CannotExitBid() selector
        if (!isCannotExitBid) throw e;
        // Partially filled: try exit at end (outbidBlock = 0) then outbid (outbidBlock = endBlock - 1)
        try {
          const hash = await ccaContract.write.exitPartiallyFilledBid([bidId, ccaStartBlock, 0n]);
          await publicClient.waitForTransactionReceipt({ hash });
          console.log(`Exited bid ${bidId} (partially filled at end)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isPartiallyFilledAtEndRevert =
            msg.includes("CannotExitBid") ||
            msg.includes("InvalidLastFullyFilledCheckpointHint") ||
            msg.includes("CannotPartiallyExitBidBeforeEndBlock");
          if (!isPartiallyFilledAtEndRevert) throw err;
          const outbidBlock = ccaEndBlock > 0n ? ccaEndBlock - 1n : 0n;
          const hash = await ccaContract.write.exitPartiallyFilledBid([
            bidId,
            ccaStartBlock,
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
      const singleId = bidIds[0] as bigint;
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
