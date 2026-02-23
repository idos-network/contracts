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
] as const;

export const whaleDisburserAbi = [
	{
		type: "event",
		name: "Disbursed",
		inputs: [
			{ name: "beneficiary", type: "address", indexed: true },
			{ name: "totalAmount", type: "uint256", indexed: false },
			{ name: "immediateAmount", type: "uint256", indexed: false },
			{ name: "vestingWallet", type: "address", indexed: false },
			{ name: "vestedAmount", type: "uint256", indexed: false },
		],
	},
	{
		type: "function",
		name: "disburse",
		inputs: [
			{ name: "token", type: "address" },
			{ name: "beneficiary", type: "address" },
			{ name: "totalAmount", type: "uint256" },
			{ name: "vestingStart", type: "uint64" },
		],
		outputs: [{ name: "", type: "address" }],
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
