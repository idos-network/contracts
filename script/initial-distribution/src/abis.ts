import { assertAbisMatchArtifacts } from "./abiChecker.js";

export const trackerAbi = [
  {
    type: "event",
    name: "DisbursementCompleted",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
      { name: "txHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "recordDisbursement",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "txHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "missingDisbursementTo",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalMissingDisbursements",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "saleFullyClaimed",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "saleFullyDisbursed",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ccaContract",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "disburser",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

export const ccaAbi = [
  {
    type: "event",
    name: "BidSubmitted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
      { name: "amount", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokensClaimed",
    inputs: [
      { name: "bidId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "tokensFilled", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokensSwept",
    inputs: [
      { name: "tokensRecipient", type: "address", indexed: true },
      { name: "tokensAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "startBlock",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "endBlock",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claimBlock",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextBidId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bids",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "startBlock", type: "uint64" },
          { name: "startCumulativeMps", type: "uint24" },
          { name: "exitedBlock", type: "uint64" },
          { name: "maxPrice", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "amountQ96", type: "uint256" },
          { name: "tokensFilled", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "exitBid",
    inputs: [{ name: "_bidId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "exitPartiallyFilledBid",
    inputs: [
      { name: "_bidId", type: "uint256" },
      { name: "_lastFullyFilledCheckpointBlock", type: "uint64" },
      { name: "_outbidBlock", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimTokens",
    inputs: [{ name: "_bidId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimTokensBatch",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_bidIds", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sweepUnsoldTokensBlock",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokensRecipient",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sweepUnsoldTokens",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const tdeDisbursementAbi = [
  {
    type: "event",
    name: "Disbursed",
    inputs: [
      { name: "beneficiary", type: "address", indexed: true },
      { name: "transferTarget", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "modality", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "IDOS_TOKEN",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "disburse",
    inputs: [
      { name: "beneficiary", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "modality", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "vestingContracts",
    inputs: [
      { name: "beneficiary", type: "address" },
      { name: "modality", type: "uint8" },
    ],
    outputs: [{ name: "vestingWallet", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ensureVestingContractExists",
    inputs: [
      { name: "beneficiary", type: "address" },
      { name: "modality", type: "uint8" },
    ],
    outputs: [
      { name: "vestingContract", type: "address" },
      { name: "created", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

export const batchCallerAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const erc20Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

assertAbisMatchArtifacts({
  ccaAbi,
  trackerAbi,
  erc20Abi,
  tdeDisbursementAbi,
  batchCallerAbi,
} as Parameters<typeof assertAbisMatchArtifacts>[0]);
