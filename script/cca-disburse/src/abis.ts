export const disperseAbi = [
	{
		constant: false,
		inputs: [
			{ name: "token", type: "address" },
			{ name: "recipients", type: "address[]" },
			{ name: "values", type: "uint256[]" },
		],
		name: "disperseTokenSimple",
		outputs: [],
		payable: false,
		stateMutability: "nonpayable",
		type: "function",
	},
] as const;

export const trackerAbi = [
	{
		type: "event",
		name: "MissingDisbursementRecorded",
		inputs: [
			{ name: "to", type: "address", indexed: true },
			{ name: "value", type: "uint256", indexed: false },
		],
	},
	{
		type: "event",
		name: "DisbursementCompleted",
		inputs: [
			{ name: "to", type: "address", indexed: true },
			{ name: "value", type: "uint256", indexed: false },
			{ name: "txHash", type: "bytes32", indexed: false },
			{ name: "txIndex", type: "uint256", indexed: false },
		],
	},
	{
		type: "function",
		name: "recordDisbursements",
		inputs: [
			{ name: "recipients", type: "address[]" },
			{ name: "values", type: "uint256[]" },
			{ name: "txHashes", type: "bytes32[]" },
			{ name: "txIndices", type: "uint256[]" },
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
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
		stateMutability: "nonpayable",
	},
	{
		type: "function",
		name: "approve",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
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
] as const;
